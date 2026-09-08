import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { FormField, Input } from "@churchofjesuschrist/eden-form-parts";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import { exportarBitacoraFormulario } from "@/app/actions/auditoria";
import BitacoraDeEventos from "@/components/BitacoraDeEventos";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { consultarBitacoraCompleta } from "@/lib/auditoria/consultarBitacora";
import { eventoCoincideConFiltros } from "@/lib/auditoria/filtrosDeBitacora";
import { aFilaDeBitacora } from "@/lib/auditoria/vistaDeEvento";
import { TIPOS_DE_AGREGADO, type TipoDeAgregado } from "@/lib/data/claves";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { TIPOS_DE_EVENTO, type TipoDeEvento } from "@/types/auditoria";
import "./pagina.css";

/**
 * Bitacora de auditoria — pantalla 7 de `ui-ux-requerimientos.md`.
 *
 * **Un `<form method="get">`, sin JavaScript de cliente** (mismo patron que
 * `/admin/vehiculos`): el filtro queda en la URL, se puede compartir y volver
 * atras. `consultarBitacora` (PA-12) solo acepta un agregado concreto, asi
 * que el resto de los filtros —tipo, fechas, participante— se aplican en
 * memoria sobre la historia completa de ese agregado.
 *
 * Dinamica: es una bitacora de trabajo, no un dato publicable.
 */
export const dynamic = "force-dynamic";

type Busqueda = {
  agregado?: string;
  agregadoId?: string;
  tipo?: string;
  desde?: string;
  hasta?: string;
  participanteId?: string;
};

const esTipoDeAgregado = (valor: string | undefined): valor is TipoDeAgregado =>
  valor !== undefined &&
  (TIPOS_DE_AGREGADO as readonly string[]).includes(valor);

const esTipoDeEvento = (valor: string | undefined): valor is TipoDeEvento =>
  valor !== undefined && (TIPOS_DE_EVENTO as readonly string[]).includes(valor);

const AuditoriaPagina = async ({
  searchParams,
}: {
  searchParams: Promise<Busqueda>;
}) => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("auditoria:ver-bitacora");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.auditoria;

  const { agregado, agregadoId, tipo, desde, hasta, participanteId } =
    await searchParams;
  const hayBusqueda = esTipoDeAgregado(agregado) && Boolean(agregadoId);
  // `auditoria:exportar` es el mismo `Autob_Auditar` que abrio esta pantalla
  // (permission-matrix.md seccion 7); no hace falta una segunda consulta.
  const puedeExportar = sesion.permisos.has("Autob_Auditar");

  const filas = hayBusqueda
    ? await (async () => {
        const lectura = await consultarBitacoraCompleta({
          agregado: agregado as TipoDeAgregado,
          agregadoId: agregadoId as string,
        });
        if (!lectura.ok) {
          throw new Error(`No se pudo leer la bitacora: ${lectura.error}`);
        }
        return lectura.data
          .filter((evento) =>
            eventoCoincideConFiltros(evento, {
              tipo: esTipoDeEvento(tipo) ? tipo : undefined,
              desde,
              hasta,
              participanteId,
            }),
          )
          .map((evento) => aFilaDeBitacora(evento, diccionario));
      })()
    : [];

  return (
    <main className="auditoria">
      <header>
        <H1>{etiquetas.titulo}</H1>
        <Text2 renderAs="p">{etiquetas.descripcion}</Text2>
      </header>

      <form method="get" className="auditoria__filtros">
        <FormField label={etiquetas.campoAgregado}>
          {/* `<option>` nativo: un `Select`/`Option` de Eden no sobrevive la
              frontera de RSC (desafios-implementacion.md 28). */}
          <select name="agregado" defaultValue={agregado ?? ""}>
            <option value="" />
            {TIPOS_DE_AGREGADO.map((valor) => (
              <option key={valor} value={valor}>
                {etiquetas.tiposDeAgregado[valor]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={etiquetas.campoAgregadoId}>
          <Input name="agregadoId" defaultValue={agregadoId ?? ""} />
        </FormField>
        <FormField label={etiquetas.campoTipo}>
          <select name="tipo" defaultValue={tipo ?? ""}>
            <option value="">{etiquetas.todosLosTipos}</option>
            {TIPOS_DE_EVENTO.map((valor) => (
              <option key={valor} value={valor}>
                {diccionario.tiposDeEvento[valor]}
              </option>
            ))}
          </select>
        </FormField>
        {/* `<input>` nativo: el `Input` de Eden no admite `type="date"`. */}
        <FormField label={etiquetas.campoDesde}>
          <input type="date" name="desde" defaultValue={desde ?? ""} />
        </FormField>
        <FormField label={etiquetas.campoHasta}>
          <input type="date" name="hasta" defaultValue={hasta ?? ""} />
        </FormField>
        <FormField label={etiquetas.campoParticipante}>
          <Input name="participanteId" defaultValue={participanteId ?? ""} />
        </FormField>
        <Primary type="submit">{etiquetas.buscar}</Primary>
      </form>

      {!hayBusqueda ? (
        <Text2 renderAs="p">{etiquetas.promptInicial}</Text2>
      ) : (
        <>
          <div className="auditoria__acciones">
            {puedeExportar ? (
              <form action={exportarBitacoraFormulario}>
                <input type="hidden" name="agregado" value={agregado} />
                <input type="hidden" name="agregadoId" value={agregadoId} />
                {tipo ? <input type="hidden" name="tipo" value={tipo} /> : null}
                {desde ? (
                  <input type="hidden" name="desde" value={desde} />
                ) : null}
                {hasta ? (
                  <input type="hidden" name="hasta" value={hasta} />
                ) : null}
                {participanteId ? (
                  <input
                    type="hidden"
                    name="participanteId"
                    value={participanteId}
                  />
                ) : null}
                <Secondary type="submit">{etiquetas.exportar}</Secondary>
              </form>
            ) : null}
            {agregado === "LOTE" && agregadoId ? (
              <Link href={`/auditoria/lotes/${agregadoId}`}>
                {etiquetas.verReconstruccion}
              </Link>
            ) : null}
          </div>
          <Text4 renderAs="p">{etiquetas.avisoExportacion}</Text4>

          <BitacoraDeEventos eventos={filas} diccionario={diccionario} />
        </>
      )}
    </main>
  );
};

export default AuditoriaPagina;
