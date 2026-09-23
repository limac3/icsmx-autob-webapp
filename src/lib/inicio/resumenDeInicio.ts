import "server-only";

// Lo que el home muestra ademas de la guia: que le toca hacer ahora a quien
// mira. `ui-ux-requerimientos.md`, pantalla de inicio.
//
// **No estrena ningun patron de acceso.** Las cuatro lecturas son las que ya
// alimentan el catalogo, `/mis-solicitudes`, la bandeja del aprobador y la de
// tesoreria; aqui se reusan enteras y solo se cuenta el resultado. No hay
// indice nuevo ni entidad nueva que documentar en `modelo-datos-dynamodb.md`.
//
// **Cada lectura esta condicionada por la capacidad de quien mira**, con el
// mismo criterio que `guiaDeInicio.ts`: la accion que **decide**, no la que
// abre la bandeja. Un auditor ve las bandejas en lectura (`tesoreria:
// ver-bandeja` se lo concede) pero no tiene trabajo pendiente en ninguna, asi
// que no se le consulta nada y no se le dibuja ninguna linea.

import { tieneCapacidad, type Accion } from "@/lib/auth/permisos";
import { listarConvocatorias } from "@/lib/convocatorias/listarConvocatorias";
import { listarConvocatoriasVisibles } from "@/lib/convocatorias/listarConvocatoriasVisibles";
import type { DepsDeServicio } from "@/lib/data/deps";
import { calcularSiguientePaso } from "@/lib/domain/siguientePaso";
import { listarMisSolicitudes } from "@/lib/fila/listarMisSolicitudes";
import { listarPendientesVerificacion } from "@/lib/tesoreria/listarPendientesVerificacion";
import type { Permiso } from "@/types/identidad";
import type { TipoConvocatoria } from "@/types/convocatoria";
import type { PendienteDeBandeja, ResumenDeInicio } from "@/types/inicio";
import { exito, type Resultado } from "@/types/resultado";

/**
 * La bandeja del adjudicador no se cuenta, se anuncia.
 *
 * Contar los lotes que esperan decision es recorrer cada convocatoria manual,
 * leer sus lotes y consultar el tamano de la fila de cada uno — lo que hace
 * `/adjudicacion`, y que alli se paga porque esa es la pantalla. Pagarlo en el
 * home lo cobraria en **cada** visita de quien adjudica, y por un numero.
 *
 * La alternativa de contar convocatorias manuales publicadas y llamarlo
 * "pendientes" se descarto por mentirosa: una convocatoria manual sin nadie
 * formado no espera ninguna decision, asi que el numero diria "2" con la
 * bandeja vacia. Se usa esa consulta barata —una `Query`— solo para decidir si
 * **existe** algo que revisar, y la linea manda a la bandeja sin numero.
 */
const contarAdjudicacion = async (
  deps: DepsDeServicio,
): Promise<Resultado<number>> => {
  const publicadas = await listarConvocatorias(
    { estatus: ["PUBLICADA"] },
    deps,
  );
  if (!publicadas.ok) return publicadas;
  return exito(
    publicadas.data.filter(
      (convocatoria) => convocatoria.modalidadAdjudicacion === "MANUAL",
    ).length,
  );
};

/**
 * Reune lo que el home necesita para una sesion concreta.
 *
 * Devuelve `Resultado` y no lanza: la pantalla degrada el bloque de datos a un
 * aviso y **la guia de instrucciones se sigue dibujando**, porque no depende
 * de ninguna lectura. Es explicito, que es lo que pide la regla 15 — lo que
 * esa regla prohibe es callar el fallo o rellenarlo con datos falsos, no
 * conservar la parte de la pantalla que si funciona.
 */
export const resumenDeInicio = async (
  {
    participanteId,
    permisos,
    tiposPermitidos,
    ahora,
  }: {
    participanteId: string;
    permisos: ReadonlySet<Permiso>;
    tiposPermitidos: readonly TipoConvocatoria[];
    ahora: Date;
  },
  deps: DepsDeServicio = {},
): Promise<Resultado<ResumenDeInicio>> => {
  const puede = (accion: Accion) => tieneCapacidad({ accion, permisos });

  const compra = puede("solicitud:crear");

  const [mias, visibles, enAprobacion, enVerificacion, manuales] =
    await Promise.all([
      compra ? listarMisSolicitudes(participanteId, deps) : undefined,
      compra
        ? listarConvocatoriasVisibles(tiposPermitidos, ahora, deps)
        : undefined,
      puede("convocatoria:aprobar")
        ? listarConvocatorias({ estatus: ["EN_APROBACION"] }, deps)
        : undefined,
      puede("pago:avalar") ? listarPendientesVerificacion(deps) : undefined,
      puede("adjudicacion:adjudicar") ? contarAdjudicacion(deps) : undefined,
    ]);

  // Cualquier lectura fallida tumba el resumen entero. Un home que muestra la
  // bandeja de tesoreria y calla que no pudo leer los plazos propios es
  // exactamente el fallback silencioso que la regla 15 prohibe.
  for (const lectura of [
    mias,
    visibles,
    enAprobacion,
    enVerificacion,
    manuales,
  ]) {
    if (lectura && !lectura.ok) return lectura;
  }

  const siguientePaso =
    mias?.ok && visibles?.ok
      ? calcularSiguientePaso({
          solicitudes: mias.data.solicitudes,
          truncada: mias.data.truncada,
          convocatorias: visibles.data,
          ahora,
        })
      : undefined;

  const pendientes: PendienteDeBandeja[] = [];

  if (enAprobacion?.ok && enAprobacion.data.length > 0) {
    pendientes.push({
      id: "aprobaciones",
      href: "/aprobaciones",
      cantidad: enAprobacion.data.length,
    });
  }

  if (manuales?.ok && manuales.data > 0) {
    pendientes.push({ id: "adjudicacion", href: "/adjudicacion" });
  }

  if (enVerificacion?.ok && enVerificacion.data.length > 0) {
    pendientes.push({
      id: "tesoreria",
      href: "/tesoreria/verificacion",
      cantidad: enVerificacion.data.length,
    });
  }

  return exito({ siguientePaso, pendientes });
};
