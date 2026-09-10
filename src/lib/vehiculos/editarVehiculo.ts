import "server-only";

// Edicion de los atributos de un vehiculo.

import { AMBITOS_DE_IDENTIFICADOR, clave } from "@/lib/data/claves";
import {
  deleteDeCentinelaDeIdentificador,
  putDeCentinelaDeIdentificador,
} from "@/lib/data/centinelasDeIdentificador";
import { nombreDeTabla } from "@/lib/data/cliente";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { validarDatosVehiculo } from "@/lib/domain/vehiculos";
import { exito, fallo, type Resultado } from "@/types/resultado";
import {
  CAMPOS_VEHICULO,
  type DatosVehiculo,
  type Vehiculo,
} from "@/types/vehiculo";
import { resolver, type ActorUsuario, type DepsDeVehiculos } from "./deps";

export type EntradaEditarVehiculo = {
  /**
   * El vehiculo tal como se leyo para decidir el permiso.
   *
   * Se recibe en vez de releerlo: quien invoca ya tuvo que leerlo para armar el
   * contexto de `puedeEjecutar` —la guarda de `vehiculo:editar` necesita el
   * estatus— y una segunda lectura solo abriria una ventana entre las dos. La
   * condicion de la escritura cierra el hueco que queda.
   */
  actual: Vehiculo;
  cambios: Partial<DatosVehiculo>;
  actor: ActorUsuario;
};

/** Campos cuyo valor cambia realmente, para que el evento no mienta. */
export const camposModificados = (
  actual: DatosVehiculo,
  propuesto: DatosVehiculo,
): (keyof DatosVehiculo)[] =>
  CAMPOS_VEHICULO.filter((campo) => actual[campo] !== propuesto[campo]);

export const editarVehiculo = async (
  entrada: EntradaEditarVehiculo,
  deps: DepsDeVehiculos = {},
): Promise<Resultado<{ vehiculoId: string }>> => {
  const { cliente, ahora } = resolver(deps);
  const { actual, cambios } = entrada;

  // Se valida el vehiculo **completo** resultante y no solo los campos que
  // llegaron: una edicion parcial puede dejar un registro invalido en conjunto,
  // y validar el fragmento no lo detectaria.
  const validacion = validarDatosVehiculo({ ...actual, ...cambios }, ahora);
  if (!validacion.ok) return validacion;

  const modificados = camposModificados(actual, validacion.data);
  if (modificados.length === 0) {
    // Nada que escribir. Se devuelve exito y **no** se escribe evento: una
    // bitacora con "editado" sin cambios entrena a quien la lee a ignorarla.
    return exito({ vehiculoId: actual.vehiculoId });
  }

  const momento = ahora.toISOString();
  const nombres: Record<string, string> = {
    "#estatus": "estatus",
    "#actualizadoEn": "actualizadoEn",
    "#actualizadoPor": "actualizadoPor",
  };
  const valores: Record<string, unknown> = {
    ":estatusEsperado": actual.estatus,
    ":actualizadoEn": momento,
    ":actualizadoPor": entrada.actor.id,
  };
  const asignaciones = [
    "#actualizadoEn = :actualizadoEn",
    "#actualizadoPor = :actualizadoPor",
  ];
  const eliminaciones: string[] = [];

  for (const campo of modificados) {
    // Todo nombre de atributo viaja como marcador. `version` es palabra
    // reservada de DynamoDB y una expresion que la nombre directamente falla
    // con ValidationException; hacerlo siempre evita tener que recordar cual de
    // los ocho campos lo es.
    nombres[`#${campo}`] = campo;
    const valor = validacion.data[campo];
    if (valor === undefined) {
      // Vaciar un opcional lo **elimina**, no lo deja como cadena vacia: es la
      // misma distincion que hace `normalizarDatosVehiculo`.
      eliminaciones.push(`#${campo}`);
      continue;
    }
    valores[`:${campo}`] = valor;
    asignaciones.push(`#${campo} = :${campo}`);
  }

  const expresion =
    `SET ${asignaciones.join(", ")}` +
    (eliminaciones.length > 0 ? ` REMOVE ${eliminaciones.join(", ")}` : "");

  // Renombrar un identificador de negocio es **una sola transaccion**: reservar
  // el valor nuevo, liberar el viejo y actualizar la entidad. Partirlo en dos
  // pasos dejaria, si el segundo falla, o un valor reservado que nadie puede
  // volver a usar, o dos vehiculos con el mismo numero.
  //
  // Es justo lo que hace corregible un typo, y la razon de que el identificador
  // interno —no este— sea el ancla de la bitacora: la historia no se mueve.
  const renombrados: ItemDeTransaccion[] = [];
  const campoPorIndice = new Map<number, string>();

  for (const { campo, ambito } of [
    {
      campo: "numeroEconomico",
      ambito: AMBITOS_DE_IDENTIFICADOR.numeroEconomicoDeVehiculo,
    },
    {
      campo: "numeroDeSerie",
      ambito: AMBITOS_DE_IDENTIFICADOR.numeroDeSerieDeVehiculo,
    },
  ] as const) {
    if (!modificados.includes(campo)) continue;
    // El indice del `Put` es lo que despues traduce el fallo al campo concreto.
    campoPorIndice.set(renombrados.length, campo);
    renombrados.push(
      putDeCentinelaDeIdentificador(ambito, validacion.data[campo], {
        vehiculoId: actual.vehiculoId,
      }),
      deleteDeCentinelaDeIdentificador(ambito, actual[campo]),
    );
  }

  const resultado = await ejecutarTransaccion(
    [
      ...renombrados,
      {
        item: {
          Update: {
            TableName: nombreDeTabla(),
            Key: clave.vehiculo(actual.vehiculoId),
            UpdateExpression: expresion,
            // El estatus leido sigue siendo el estatus: si entre la lectura y
            // esta escritura el vehiculo entro a una convocatoria o se vendio,
            // la edicion se cancela en vez de aplicarse sobre una decision de
            // permiso que ya caduco.
            ConditionExpression:
              "attribute_exists(PK) AND #estatus = :estatusEsperado",
            ExpressionAttributeNames: nombres,
            ExpressionAttributeValues: valores,
          },
        },
        siFalla: "invalid_state",
        descripcion: `vehiculo ${actual.vehiculoId} en ${actual.estatus}`,
      },
      eventoParaTransaccion({
        tipo: "VEHICULO_EDITADO",
        agregado: "VEHICULO",
        agregadoId: actual.vehiculoId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        vehiculoId: actual.vehiculoId,
        estadoAnterior: actual.estatus,
        estadoNuevo: actual.estatus,
        // El catalogo pide "los campos modificados". Se registran los nombres y
        // los valores nuevos; el valor anterior ya consta en el evento previo,
        // que es lo que hace reconstruible la historia sin duplicarla.
        datos: {
          campos: modificados,
          valores: Object.fromEntries(
            modificados.map((campo) => [campo, validacion.data[campo] ?? null]),
          ),
        },
      }),
    ],
    { cliente },
  );

  if (!resultado.ok) {
    // Si cancelo uno de los `Put` de centinela, el valor nuevo ya estaba
    // tomado. Decirlo por campo permite senalarlo en la pantalla.
    const duplicado = campoPorIndice.get(resultado.indice ?? -1);
    if (duplicado) {
      return fallo("validation_failed", { [duplicado]: "duplicado" });
    }
    return fallo(resultado.error);
  }
  return exito({ vehiculoId: actual.vehiculoId });
};
