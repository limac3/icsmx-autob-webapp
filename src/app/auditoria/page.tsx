import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { Secondary } from "@churchofjesuschrist/eden-buttons";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import { exportarBitacoraFormulario } from "@/app/actions/auditoria";
import BitacoraDeEventos from "@/components/BitacoraDeEventos";
import FiltrosDeBitacora from "@/components/FiltrosDeBitacora";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { consultarActividadDeParticipante } from "@/lib/auditoria/consultarActividadDeParticipante";
import { consultarBitacoraCompleta } from "@/lib/auditoria/consultarBitacora";
import {
  consultarBitacoraGlobal,
  consultarPorTipoDeEvento,
} from "@/lib/auditoria/consultarBitacoraGlobal";
import {
  esTipoDeAgregado,
  eventoCoincideConFiltros,
  rangoPorDefecto,
  validarBusqueda,
  type BusquedaDeBitacora,
  type CriteriosCrudos,
} from "@/lib/auditoria/filtrosDeBitacora";
import { construirOpciones } from "@/lib/auditoria/opcionesDeBusqueda";
import { aFilaDeBitacora } from "@/lib/auditoria/vistaDeEvento";
import { TIPOS_DE_AGREGADO } from "@/lib/data/claves";
import { diaDeNegocio, desdeIso } from "@/lib/domain/fechas";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { TIPOS_DE_EVENTO, type EventoDTO } from "@/types/auditoria";
import "./pagina.css";

/**
 * Bitacora de auditoria — pantalla 7 de `ui-ux-requerimientos.md`.
 *
 * Sigue siendo **un `<form method="get">`**: el filtro vive en la URL, se
 * comparte y se navega hacia atras. Lo que cambio es que la pantalla ya no
 * exige conocer de antemano el identificador de lo que se busca. Ahora hay dos
 * modos de consulta, y la diferencia entre ellos explica casi todo lo demas:
 *
 *   - **Con identificador**: `consultarBitacoraCompleta` (PA-12) lee la
 *     particion de ese agregado, que trae su historia entera. El rango de
 *     fechas es entonces un filtro en memoria, asi que no se acota — y por eso
 *     un enlace desde la pantalla de una convocatoria puede abrir su historia
 *     completa aunque empiece hace meses.
 *   - **Sin identificador**: `consultarBitacoraGlobal` (PA-13) lee una
 *     particion **por dia**. Ahi el rango es la llave de la consulta, no un
 *     filtro, y de ahi salen las dos reglas: no puede estar vacio y no puede
 *     pasar de 31 dias.
 *
 * Las opciones de los selects salen de una lectura global del rango, siempre:
 * ofrecer solo lo que tiene actividad en el rango es lo que garantiza que
 * ninguna opcion devuelva una tabla vacia.
 *
 * Dinamica: es una bitacora de trabajo, no un dato publicable.
 */
export const dynamic = "force-dynamic";

/** Etiqueta corta del registro de un evento, para la columna homonima. */
const registroDeEvento = (
  evento: EventoDTO,
  etiquetas: Record<string, string>,
): string | undefined =>
  evento.agregado && evento.agregadoId
    ? `${etiquetas[evento.agregado]} · ${evento.agregadoId}`
    : undefined;

const AuditoriaPagina = async ({
  searchParams,
}: {
  searchParams: Promise<CriteriosCrudos>;
}) => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("auditoria:ver-bitacora");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.auditoria;

  const crudos = await searchParams;
  const ahora = new Date();
  const validacion = validarBusqueda(crudos, ahora);

  // El rango que se **pinta** en el formulario no es siempre el que se
  // consulta: si lo que llego es invalido, se le devuelve tal cual para que
  // quien lo escribio vea su error, en vez de sustituirlo por el defecto y
  // dejarlo mirando una bitacora que no pidio.
  const porDefecto = rangoPorDefecto(ahora);
  const rangoVisible = {
    desde: crudos.desde?.trim() || porDefecto.desde,
    hasta: crudos.hasta?.trim() || porDefecto.hasta,
  };

  const busqueda: BusquedaDeBitacora | undefined = validacion.ok
    ? validacion.busqueda
    : undefined;

  // El tipo de registro se toma de lo crudo y **no** de la busqueda validada,
  // y no es un atajo: al elegirlo, la busqueda todavia no es valida —falta el
  // identificador, que es justo lo que se va a elegir a continuacion—, asi que
  // leerlo de `busqueda` dejaria el select de identificador vacio para siempre
  // y la pantalla seria inutilizable.
  const agregadoElegido = esTipoDeAgregado(crudos.agregado)
    ? crudos.agregado
    : undefined;

  // Lectura global del rango para las opciones. Se intenta siempre que el
  // rango sea utilizable: sin ella los selects quedarian vacios justo cuando
  // hay que corregir un criterio.
  const rangoDeOpciones = validacion.ok
    ? validacion.busqueda.rango
    : validacion.motivos.includes("rango_invalido")
      ? undefined
      : rangoVisible;

  // Dos lecturas, y no una, cuando hay tipo de registro elegido:
  //
  //   - Sin acotar, para el select de **participantes**: ese no depende del
  //     tipo de registro.
  //   - Acotada al tipo, para el de **identificadores**. Derivar los dos de la
  //     misma lectura es lo que provoco el defecto que reporto el usuario: un
  //     tipo con mucho volumen agota el cupo y los demas aparecen como "sin
  //     actividad en este rango" siendo falso. En el sandbox, 3 288 eventos de
  //     lote de un dia dejaban fuera del corte los 9 de vehiculo y los 7 de
  //     convocatoria del dia anterior.
  const [eventosDelRango, eventosDelAgregado] = rangoDeOpciones
    ? await Promise.all([
        consultarBitacoraGlobal({
          desde: rangoDeOpciones.desde,
          hasta: rangoDeOpciones.hasta,
        }),
        agregadoElegido
          ? consultarBitacoraGlobal({
              desde: rangoDeOpciones.desde,
              hasta: rangoDeOpciones.hasta,
              agregado: agregadoElegido,
            })
          : undefined,
      ])
    : [undefined, undefined];

  const opciones =
    eventosDelRango?.ok === true
      ? await construirOpciones({
          eventos: eventosDelRango.data.eventos,
          ...(eventosDelAgregado?.ok === true
            ? { eventosDelAgregado: eventosDelAgregado.data.eventos }
            : {}),
          ...(agregadoElegido ? { agregado: agregadoElegido } : {}),
          diccionario,
        })
      : undefined;

  // --- Resultados -----------------------------------------------------------

  const resultado = busqueda
    ? await (async (): Promise<{
        eventos: readonly EventoDTO[];
        truncada: boolean;
        /** Eventos del agregado anteriores al rango, en el modo PA-12. */
        anteriores?: string;
      }> => {
        if (busqueda.agregado && busqueda.agregadoId) {
          const lectura = await consultarBitacoraCompleta({
            agregado: busqueda.agregado,
            agregadoId: busqueda.agregadoId,
          });
          if (!lectura.ok) {
            throw new Error(`No se pudo leer la bitacora: ${lectura.error}`);
          }

          const enRango = lectura.data.filter((evento) =>
            eventoCoincideConFiltros(evento, {
              ...(busqueda.tipo ? { tipo: busqueda.tipo } : {}),
              desde: busqueda.rango.desde,
              hasta: busqueda.rango.hasta,
              ...(busqueda.participanteId
                ? { participanteId: busqueda.participanteId }
                : {}),
            }),
          );

          // La particion se leyo entera, asi que saber si hay historia mas
          // vieja que el rango no cuesta ninguna lectura extra — y ofrecerla
          // evita que el rango por defecto esconda el origen del registro.
          const masViejo = lectura.data
            .map((evento) => desdeIso(evento.ocurridoEn))
            .filter((instante): instante is Date => instante !== undefined)
            .map((instante) => diaDeNegocio(instante))
            .sort()
            .at(0);

          return {
            eventos: enRango,
            truncada: false,
            ...(masViejo && masViejo < busqueda.rango.desde
              ? { anteriores: masViejo }
              : {}),
          };
        }

        if (busqueda.participanteId) {
          const lectura = await consultarActividadDeParticipante({
            participanteId: busqueda.participanteId,
            desde: busqueda.rango.desde,
            hasta: busqueda.rango.hasta,
            ...(busqueda.tipo ? { tipo: busqueda.tipo } : {}),
          });
          if (!lectura.ok) {
            throw new Error(`No se pudo leer la bitacora: ${lectura.error}`);
          }
          return lectura.data;
        }

        // Solo tipo de evento. `validarBusqueda` garantiza que si no hay
        // identificador ni participante, hay tipo.
        if (!busqueda.tipo) {
          throw new Error("Busqueda sin criterio: validarBusqueda fallo");
        }
        if (!eventosDelRango?.ok) {
          throw new Error("No se pudo leer la bitacora del rango");
        }

        // Reusa la lectura de las opciones **solo si fue completa**; ver
        // `consultarPorTipoDeEvento`.
        const lectura = await consultarPorTipoDeEvento({
          desde: busqueda.rango.desde,
          hasta: busqueda.rango.hasta,
          tipo: busqueda.tipo,
          yaLeido: eventosDelRango.data,
        });
        if (!lectura.ok) {
          throw new Error(`No se pudo leer la bitacora: ${lectura.error}`);
        }
        return lectura.data;
      })()
    : undefined;

  const filas = (resultado?.eventos ?? []).map((evento) =>
    aFilaDeBitacora(evento, diccionario, {
      ...(busqueda?.agregadoId
        ? {}
        : { registro: registroDeEvento(evento, etiquetas.tiposDeAgregado) }),
      ...(opciones?.ok && opciones.data.nombresDeActor.get(evento.actorId)
        ? {
            nombreDeActor: opciones.data.nombresDeActor.get(evento.actorId),
          }
        : {}),
    }),
  );

  const avisos = validacion.ok
    ? []
    : validacion.motivos.map((motivo) => etiquetas.busqueda[motivo]);

  // `auditoria:exportar` es el mismo `Autob_Auditar` que abrio esta pantalla
  // (permission-matrix.md seccion 7); no hace falta una segunda consulta.
  const puedeExportar = sesion.permisos.has("Autob_Auditar");

  return (
    <main className="auditoria">
      <header>
        <H1>{etiquetas.titulo}</H1>
        <Text2 renderAs="p">{etiquetas.descripcion}</Text2>
      </header>

      <FiltrosDeBitacora
        valores={{
          agregado: agregadoElegido ?? "",
          agregadoId: busqueda?.agregadoId ?? crudos.agregadoId?.trim() ?? "",
          tipo: busqueda?.tipo ?? "",
          participanteId: busqueda?.participanteId ?? "",
          desde: rangoVisible.desde,
          hasta: rangoVisible.hasta,
        }}
        tiposDeAgregado={TIPOS_DE_AGREGADO.map((valor) => ({
          valor,
          etiqueta: etiquetas.tiposDeAgregado[valor],
        }))}
        tiposDeEvento={TIPOS_DE_EVENTO.map((valor) => ({
          valor,
          etiqueta: diccionario.tiposDeEvento[valor],
        }))}
        identificadores={opciones?.ok ? opciones.data.identificadores : []}
        participantes={opciones?.ok ? opciones.data.participantes : []}
        etiquetas={{
          campoDesde: etiquetas.campoDesde,
          campoHasta: etiquetas.campoHasta,
          campoAgregado: etiquetas.campoAgregado,
          campoAgregadoId: etiquetas.campoAgregadoId,
          campoTipo: etiquetas.campoTipo,
          campoParticipante: etiquetas.campoParticipante,
          todosLosTipos: etiquetas.todosLosTipos,
          sinOpciones: etiquetas.sinOpciones,
          eligeTipoDeRegistro: etiquetas.eligeTipoDeRegistro,
          buscar: etiquetas.buscar,
          eligeIdentificador: etiquetas.eligeIdentificador,
        }}
        avisos={avisos}
      />

      {!busqueda || !resultado ? (
        <Text2 renderAs="p">{etiquetas.promptInicial}</Text2>
      ) : (
        <>
          <div className="auditoria__acciones">
            {/* La exportacion exige un identificador, y no por comodidad:
                `BITACORA_EXPORTADA` es un evento y todo evento se ancla a un
                agregado (`trazabilidad-auditoria.md` 2.1). Una exportacion del
                rango completo no tendria a que anclarse, asi que saldria sin
                quedar registrada — que es exactamente lo que la seccion 36 de
                `desafios-implementacion.md` cerro. */}
            {puedeExportar && busqueda.agregado && busqueda.agregadoId ? (
              <form action={exportarBitacoraFormulario}>
                <input
                  type="hidden"
                  name="agregado"
                  value={busqueda.agregado}
                />
                <input
                  type="hidden"
                  name="agregadoId"
                  value={busqueda.agregadoId}
                />
                {busqueda.tipo ? (
                  <input type="hidden" name="tipo" value={busqueda.tipo} />
                ) : null}
                <input
                  type="hidden"
                  name="desde"
                  value={busqueda.rango.desde}
                />
                <input
                  type="hidden"
                  name="hasta"
                  value={busqueda.rango.hasta}
                />
                {busqueda.participanteId ? (
                  <input
                    type="hidden"
                    name="participanteId"
                    value={busqueda.participanteId}
                  />
                ) : null}
                <Secondary type="submit">{etiquetas.exportar}</Secondary>
              </form>
            ) : null}
            {busqueda.agregado === "LOTE" && busqueda.agregadoId ? (
              <Link href={`/auditoria/lotes/${busqueda.agregadoId}`}>
                {etiquetas.verReconstruccion}
              </Link>
            ) : null}
            {resultado.anteriores ? (
              <Link
                href={`/auditoria?${new URLSearchParams({
                  agregado: busqueda.agregado ?? "",
                  agregadoId: busqueda.agregadoId ?? "",
                  desde: resultado.anteriores,
                  hasta: busqueda.rango.hasta,
                }).toString()}`}
              >
                {etiquetas.verHistoriaCompleta}
              </Link>
            ) : null}
          </div>
          <Text4 renderAs="p">{etiquetas.avisoExportacion}</Text4>
          {resultado.truncada ? (
            <Text4 renderAs="p" role="alert">
              {etiquetas.truncada}
            </Text4>
          ) : null}
          {resultado.anteriores ? (
            <Text4 renderAs="p">{etiquetas.anterioresAlRango}</Text4>
          ) : null}

          <BitacoraDeEventos eventos={filas} diccionario={diccionario} />
        </>
      )}
    </main>
  );
};

export default AuditoriaPagina;
