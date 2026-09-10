import "server-only";

// Alta de una convocatoria. Nace `BORRADOR`, que es el unico estado inicial de
// la maquina de `proyecto.md` 5.1.
//
// Se rige por la regla 4: la mutacion y su evento viajan en la misma
// `TransactWriteItems` o no ocurre ninguna de las dos.

import { AMBITOS_DE_IDENTIFICADOR, clave, gsi2 } from "@/lib/data/claves";
import { putDeCentinelaDeIdentificador } from "@/lib/data/centinelasDeIdentificador";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { validarDatosConvocatoria } from "@/lib/domain/convocatorias";
import { ESTATUS_INICIAL_CONVOCATORIA } from "@/lib/domain/transiciones";
import type { ActorUsuario } from "@/types/auditoria";
import type { DatosConvocatoria } from "@/types/convocatoria";
import { exito, fallo, type Resultado } from "@/types/resultado";

export type EntradaCrearConvocatoria = {
  datos: DatosConvocatoria;
  actor: ActorUsuario;
};

export const crearConvocatoria = async (
  entrada: EntradaCrearConvocatoria,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ convocatoriaId: string }>> => {
  const { cliente, ahora, nuevoId } = resolver(deps);

  const validacion = validarDatosConvocatoria(entrada.datos);
  if (!validacion.ok) {
    return fallo("validation_failed", validacion.errores);
  }

  const convocatoriaId = nuevoId();
  const momento = ahora.toISOString();

  const item = {
    ...clave.convocatoria(convocatoriaId),
    ...validacion.datos,
    convocatoriaId,
    estatus: ESTATUS_INICIAL_CONVOCATORIA,
    creadoEn: momento,
    creadoPor: entrada.actor.id,
    actualizadoEn: momento,
    actualizadoPor: entrada.actor.id,
    // PA-05. La fecha del indice es la de **creacion**: asi el listado de un
    // estatus conserva un orden estable y una correccion de horario no
    // reordena la pantalla del aprobador.
    ...gsi2.porEstatus(
      "CONV",
      ESTATUS_INICIAL_CONVOCATORIA,
      momento,
      convocatoriaId,
    ),
  };

  const resultado = await ejecutarTransaccion(
    [
      // El centinela **primero**: `ejecutarTransaccion` devuelve el indice del
      // item que cancelo, y con el al frente ese indice no se mueve al agregar
      // items despues.
      putDeCentinelaDeIdentificador(
        AMBITOS_DE_IDENTIFICADOR.folioDeConvocatoria,
        item.folio,
        { convocatoriaId },
      ),
      {
        item: {
          Put: {
            TableName: nombreDeTabla(),
            Item: item,
            // El identificador es un ULID recien generado, asi que chocar es
            // practicamente imposible. La condicion cuesta cero y evita que un
            // `nuevoId` inyectado por error sobrescriba una convocatoria entera.
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: `convocatoria ${convocatoriaId}`,
      },
      eventoParaTransaccion({
        tipo: "CONVOCATORIA_CREADA",
        agregado: "CONVOCATORIA",
        agregadoId: convocatoriaId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId,
        estadoNuevo: ESTATUS_INICIAL_CONVOCATORIA,
        datos: {
          tipo: item.tipo,
          inicioVenta: item.inicioVenta,
          finVenta: item.finVenta,
        },
      }),
    ],
    { cliente },
  );

  if (!resultado.ok) {
    // El centinela es el item 0: si fue el que cancelo, el folio ya estaba
    // tomado. Decirlo por campo es lo que permite a la pantalla senalarlo, en
    // vez de un "revisa los datos" que no dice cual.
    if (resultado.indice === 0) {
      return fallo("validation_failed", { folio: "duplicado" });
    }
    return fallo(resultado.error);
  }
  return exito({ convocatoriaId });
};
