import "server-only";

// Edicion de los atributos de una convocatoria. Solo en `BORRADOR`.

import { AMBITOS_DE_IDENTIFICADOR, clave } from "@/lib/data/claves";
import {
  deleteDeCentinelaDeIdentificador,
  putDeCentinelaDeIdentificador,
} from "@/lib/data/centinelasDeIdentificador";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { validarDatosConvocatoria } from "@/lib/domain/convocatorias";
import type { ActorUsuario } from "@/types/auditoria";
import {
  CAMPOS_CONVOCATORIA,
  type Convocatoria,
  type DatosConvocatoria,
} from "@/types/convocatoria";
import { exito, fallo, type Resultado } from "@/types/resultado";

export type EntradaEditarConvocatoria = {
  /**
   * La convocatoria tal como se leyo para decidir el permiso.
   *
   * Se recibe en vez de releerla: quien invoca ya tuvo que leerla para armar el
   * contexto de `puedeEjecutar` —la guarda de `convocatoria:editar` necesita el
   * estatus— y una segunda lectura solo abriria una ventana entre las dos. La
   * condicion de la escritura cierra el hueco que queda.
   */
  actual: Convocatoria;
  cambios: Partial<DatosConvocatoria>;
  actor: ActorUsuario;
};

/** Campos cuyo valor cambia realmente, para que el evento no mienta. */
export const camposModificados = (
  actual: DatosConvocatoria,
  propuesto: DatosConvocatoria,
): (keyof DatosConvocatoria)[] =>
  CAMPOS_CONVOCATORIA.filter((campo) => actual[campo] !== propuesto[campo]);

export const editarConvocatoria = async (
  entrada: EntradaEditarConvocatoria,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ convocatoriaId: string }>> => {
  const { cliente, ahora } = resolver(deps);
  const { actual, cambios } = entrada;

  // Se valida la convocatoria **completa** resultante y no solo los campos que
  // llegaron: mover `inicioVenta` puede romper R-14 contra un `finVenta` que
  // nadie toco, y validar el fragmento no lo detectaria.
  const validacion = validarDatosConvocatoria({ ...actual, ...cambios });
  if (!validacion.ok) {
    return fallo("validation_failed", validacion.errores);
  }

  const modificados = camposModificados(actual, validacion.datos);
  if (modificados.length === 0) {
    // Nada que escribir. Se devuelve exito y **no** se escribe evento: una
    // bitacora con "editada" sin cambios entrena a quien la lee a ignorarla.
    return exito({ convocatoriaId: actual.convocatoriaId });
  }

  const momento = ahora.toISOString();
  const nombres: Record<string, string> = {
    "#estatus": "estatus",
    "#actualizadoEn": "actualizadoEn",
    "#actualizadoPor": "actualizadoPor",
  };
  const valores: Record<string, unknown> = {
    ":borrador": "BORRADOR",
    ":actualizadoEn": momento,
    ":actualizadoPor": entrada.actor.id,
  };
  const asignaciones = [
    "#actualizadoEn = :actualizadoEn",
    "#actualizadoPor = :actualizadoPor",
  ];

  for (const campo of modificados) {
    // Todo nombre de atributo viaja como marcador: varios son palabras
    // reservadas de DynamoDB y una expresion que las nombre directamente falla
    // con ValidationException.
    nombres[`#${campo}`] = campo;
    valores[`:${campo}`] = validacion.datos[campo];
    asignaciones.push(`#${campo} = :${campo}`);
  }

  // Renombrar el folio es **una sola transaccion**: reservar el nuevo, liberar
  // el viejo y actualizar la convocatoria. Partirlo en dos dejaria, si el
  // segundo paso falla, o un folio reservado que nadie puede volver a usar, o
  // dos convocatorias con el mismo. Es lo que hace corregible un typo sin
  // mover el ancla de la bitacora, que es el identificador interno.
  const renombrado: ItemDeTransaccion[] = modificados.includes("folio")
    ? [
        putDeCentinelaDeIdentificador(
          AMBITOS_DE_IDENTIFICADOR.folioDeConvocatoria,
          validacion.datos.folio,
          { convocatoriaId: actual.convocatoriaId },
        ),
        deleteDeCentinelaDeIdentificador(
          AMBITOS_DE_IDENTIFICADOR.folioDeConvocatoria,
          actual.folio,
        ),
      ]
    : [];

  const resultado = await ejecutarTransaccion(
    [
      ...renombrado,
      {
        item: {
          Update: {
            TableName: nombreDeTabla(),
            Key: clave.convocatoria(actual.convocatoriaId),
            UpdateExpression: `SET ${asignaciones.join(", ")}`,
            // La condicion no repite la guarda de permiso por gusto: entre la
            // lectura que decidio el permiso y esta escritura, otra persona pudo
            // mandarla a aprobacion. Sin ella, la edicion se colaria sobre una
            // convocatoria que ya esta en dictamen.
            ConditionExpression: "#estatus = :borrador",
            ExpressionAttributeNames: nombres,
            ExpressionAttributeValues: valores,
          },
        },
        siFalla: "invalid_state",
        descripcion: `convocatoria ${actual.convocatoriaId}`,
      },
      eventoParaTransaccion({
        tipo: "CONVOCATORIA_EDITADA",
        agregado: "CONVOCATORIA",
        agregadoId: actual.convocatoriaId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: actual.convocatoriaId,
        estadoAnterior: actual.estatus,
        estadoNuevo: actual.estatus,
        datos: { campos: modificados },
      }),
    ],
    { cliente },
  );

  if (!resultado.ok) {
    // El `Put` del folio nuevo es el item 0 cuando hay renombrado: si fue el
    // que cancelo, ese folio ya estaba tomado.
    if (renombrado.length > 0 && resultado.indice === 0) {
      return fallo("validation_failed", { folio: "duplicado" });
    }
    return fallo(resultado.error);
  }
  return exito({ convocatoriaId: actual.convocatoriaId });
};
