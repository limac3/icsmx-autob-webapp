import "server-only";

// Inclusion de un vehiculo en una convocatoria: nace el **lote**.
//
// Cuatro escrituras en una sola `TransactWriteItems`, porque un estado
// intermedio de esta operacion seria incoherente en los cuatro sentidos: un
// lote sin centinela permitiria incluir el mismo vehiculo dos veces, un
// centinela sin lote inmovilizaria el vehiculo para siempre, un vehiculo que
// no cambia de estatus seguiria apareciendo como `DISPONIBLE`, y sin evento la
// bitacora no podria decir quien lo incluyo (regla 4).

import { clave, gsi2 } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  CONDICION_CENTINELA_NUEVO,
  ejecutarTransaccion,
} from "@/lib/data/transacciones";
import { revisarPrecio } from "@/lib/domain/convocatorias";
import { ESTATUS_INICIAL_LOTE, transicion } from "@/lib/domain/transiciones";
import type { ActorUsuario } from "@/types/auditoria";
import type { Convocatoria } from "@/types/convocatoria";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { Vehiculo } from "@/types/vehiculo";

/**
 * Posicion del centinela de R-10 dentro de la transaccion.
 *
 * `ejecutarTransaccion` informa **que item** cancelo, y esa posicion es lo unico
 * que distingue "el vehiculo ya esta en otra convocatoria" de las otras dos
 * condiciones que tambien devuelven `invalid_state`. Si el centinela deja de ir
 * primero hay que mover esta constante; hay prueba que lo comprueba.
 */
const INDICE_DEL_CENTINELA = 0;

export type EntradaIncluirVehiculo = {
  /** La convocatoria tal como se leyo para decidir el permiso. */
  convocatoria: Convocatoria;
  /** El vehiculo tal como se leyo para decidir el permiso. */
  vehiculo: Vehiculo;
  precio: number;
  actor: ActorUsuario;
};

export const incluirVehiculo = async (
  entrada: EntradaIncluirVehiculo,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ loteId: string }>> => {
  const { cliente, ahora, nuevoId } = resolver(deps);
  const { convocatoria, vehiculo } = entrada;

  const motivoDelPrecio = revisarPrecio(entrada.precio);
  if (motivoDelPrecio) {
    return fallo("validation_failed", { precio: motivoDelPrecio });
  }

  // La maquina de estados es la unica autoridad sobre a donde puede ir el
  // vehiculo. Que la guarda de `convocatoria:incluir-vehiculo` ya exija
  // `DISPONIBLE` no la hace redundante: una es politica de permisos y esta es
  // la maquina.
  const estatusDelVehiculo = transicion(
    "vehiculo",
    vehiculo.estatus,
    "INCLUIR_EN_CONVOCATORIA",
  );
  if (!estatusDelVehiculo) return fallo("invalid_state");

  const loteId = nuevoId();
  const momento = ahora.toISOString();

  const lote = {
    ...clave.lote(convocatoria.convocatoriaId, loteId),
    loteId,
    convocatoriaId: convocatoria.convocatoriaId,
    vehiculoId: vehiculo.vehiculoId,
    precio: entrada.precio,
    estatus: ESTATUS_INICIAL_LOTE,
    // El contador nace en cero y solo crece. Es el blanco del `ADD` atomico que
    // reparte turnos en la Etapa 8; escribirlo aqui evita que el primer `ADD`
    // tenga que crear el atributo.
    contadorTurnos: 0,
    // Los ocho desnormalizados de la convocatoria, para que el paso 1 de T1
    // condicione sobre un solo item y para que T2 tenga el cupo como literal de
    // su condicion. Se copian con el estatus **de hoy** —`BORRADOR`—, y T8 los
    // propaga al publicar.
    inicioVenta: convocatoria.inicioVenta,
    finVenta: convocatoria.finVenta,
    tipoConvocatoria: convocatoria.tipo,
    estatusConvocatoria: convocatoria.estatus,
    horasLiquidacion: convocatoria.horasLiquidacion,
    limiteAdjudicaciones: convocatoria.limiteAdjudicaciones,
    limiteSolicitudes: convocatoria.limiteSolicitudes,
    modalidadAdjudicacion: convocatoria.modalidadAdjudicacion,
    creadoEn: momento,
    creadoPor: entrada.actor.id,
  };

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          // R-10 convertido en garantia atomica. Sin este centinela, "un
          // vehiculo en una sola convocatoria activa" seria una lectura seguida
          // de una decision, que es justo lo que prohibe la regla 6.
          Put: {
            TableName: nombreDeTabla(),
            Item: {
              ...clave.centinelaVehiculoActivo(vehiculo.vehiculoId),
              vehiculoId: vehiculo.vehiculoId,
              convocatoriaId: convocatoria.convocatoriaId,
              loteId,
              creadoEn: momento,
            },
            ConditionExpression: CONDICION_CENTINELA_NUEVO,
          },
        },
        // No es error de quien captura: el vehiculo ya esta en otra
        // convocatoria activa. La interfaz relee y lo dice con esas palabras.
        siFalla: "invalid_state",
        descripcion: `centinela de ${vehiculo.vehiculoId}`,
      },
      {
        item: {
          Put: {
            TableName: nombreDeTabla(),
            Item: lote,
            ConditionExpression: "attribute_not_exists(SK)",
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: `lote ${loteId}`,
      },
      {
        item: {
          // La convocatoria vuelve a comprobarse en el commit: entre la lectura
          // que decidio el permiso y esta escritura pudo mandarse a aprobacion.
          // Aqui el `ConditionCheck` si es viable —lo retiene un administrador
          // incluyendo vehiculos de uno en uno, no N participantes a la vez,
          // que es lo que lo hizo inviable en T1.
          ConditionCheck: {
            TableName: nombreDeTabla(),
            Key: clave.convocatoria(convocatoria.convocatoriaId),
            ConditionExpression: "#estatus = :borrador",
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: { ":borrador": "BORRADOR" },
          },
        },
        siFalla: "invalid_state",
        descripcion: `convocatoria ${convocatoria.convocatoriaId} en BORRADOR`,
      },
      {
        item: {
          Update: {
            TableName: nombreDeTabla(),
            Key: clave.vehiculo(vehiculo.vehiculoId),
            UpdateExpression:
              "SET #estatus = :destino, #convocatoriaId = :convocatoriaId," +
              " #actualizadoEn = :momento, #actualizadoPor = :actor," +
              " #gsi2pk = :gsi2pk, #gsi2sk = :gsi2sk",
            ConditionExpression:
              "attribute_exists(PK) AND #estatus = :estatusEsperado",
            ExpressionAttributeNames: {
              "#estatus": "estatus",
              "#convocatoriaId": "convocatoriaId",
              "#actualizadoEn": "actualizadoEn",
              "#actualizadoPor": "actualizadoPor",
              "#gsi2pk": "GSI2PK",
              "#gsi2sk": "GSI2SK",
            },
            ExpressionAttributeValues: {
              ":destino": estatusDelVehiculo,
              ":estatusEsperado": vehiculo.estatus,
              ":convocatoriaId": convocatoria.convocatoriaId,
              ":momento": momento,
              ":actor": entrada.actor.id,
              // El cambio de estatus mueve el item de particion en GSI2: sin
              // reescribir estas claves, el vehiculo seguiria listado como
              // `DISPONIBLE` (PA-03) para siempre.
              ...(() => {
                const claves = gsi2.porEstatus(
                  "VEH",
                  estatusDelVehiculo,
                  vehiculo.creadoEn,
                  vehiculo.vehiculoId,
                );
                return { ":gsi2pk": claves.GSI2PK, ":gsi2sk": claves.GSI2SK };
              })(),
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `vehiculo ${vehiculo.vehiculoId} en ${vehiculo.estatus}`,
      },
      eventoParaTransaccion({
        tipo: "VEHICULO_INCLUIDO",
        agregado: "CONVOCATORIA",
        agregadoId: convocatoria.convocatoriaId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: convocatoria.convocatoriaId,
        vehiculoId: vehiculo.vehiculoId,
        loteId,
        estadoAnterior: vehiculo.estatus,
        estadoNuevo: estatusDelVehiculo,
        datos: { precio: entrada.precio },
      }),
    ],
    { cliente },
  );

  if (!resultado.ok) {
    // El centinela es el **primer** item, y que sea el que cancela tiene una
    // causa concreta que la pantalla puede explicar: el vehiculo entro en otra
    // convocatoria activa entre que se pinto la lista y se envio el formulario.
    // Sin este detalle, quien captura recibe el mismo `invalid_state` generico
    // que produciria una convocatoria que dejo de estar en borrador, y no tiene
    // como saber cual de las dos cosas paso.
    if (resultado.indice === INDICE_DEL_CENTINELA) {
      return fallo("invalid_state", { vehiculo: "en_otra_convocatoria" });
    }
    return fallo(resultado.error);
  }
  return exito({ loteId });
};
