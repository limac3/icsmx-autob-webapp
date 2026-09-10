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
import { consultarBitacoraGlobal } from "@/lib/auditoria/consultarBitacoraGlobal";
import {
  esTipoDeAgregado,
  eventoCoincideConFiltros,
  rangoPorDefecto,
  validarBusqueda,
  type BusquedaDeBitacora,
  type CriteriosCrudos,
} from "@/lib/auditoria/filtrosDeBitacora";
import {
  construirEtiquetador,
  type ReferenciaDeAgregado,
} from "@/lib/auditoria/etiquetasDeBitacora";
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
 *   - **Sin identificador**: `consultarBitacoraGlobal` (PA-13) consulta la
 *     particion que corresponde al criterio —el mes en GSI5, el tipo de evento
 *     en GSI6, la persona en GSI9— y el rango va como **condicion de clave**.
 *     Ahi el rango es la llave de la consulta y no un filtro, y de ahi salen
 *     las dos reglas: no puede estar vacio y no puede pasar de 90 dias.
 *
 * Las opciones de los selects **no** salen de esas lecturas. Las obtiene
 * `construirOpciones` con un sondeo por valor distinto sobre GSI7 y GSI8, y son
 * dos lecturas independientes a proposito: cuando las dos listas se derivaban de
 * una sola lectura acotada, el tipo de registro con mas volumen consumia el cupo
 * y los demas aparecian como "sin actividad en este rango" siendo falso.
 *
 * Que salgan de la bitacora del rango y no del catalogo de entidades es lo que
 * garantiza que ninguna opcion devuelva una tabla vacia.
 *
 * Dinamica: es una bitacora de trabajo, no un dato publicable.
 */
export const dynamic = "force-dynamic";

/**
 * Las referencias distintas de una lista de resultados.
 *
 * Distintas y no una por fila: mil eventos de un mismo lote se nombran leyendo
 * ese lote una vez. Es lo que hace que etiquetar la columna «Registro» cueste
 * lo mismo que etiquetar las opciones.
 */
const referenciasDe = (
  eventos: readonly EventoDTO[],
): ReferenciaDeAgregado[] => {
  const porClave = new Map<string, ReferenciaDeAgregado>();
  for (const evento of eventos) {
    if (!evento.agregado || !evento.agregadoId) continue;
    const llave = `${evento.agregado}#${evento.agregadoId}`;
    if (porClave.has(llave)) continue;
    porClave.set(llave, {
      agregado: evento.agregado,
      agregadoId: evento.agregadoId,
      ...(evento.convocatoriaId
        ? { convocatoriaId: evento.convocatoriaId }
        : {}),
      ...(evento.loteId ? { loteId: evento.loteId } : {}),
    });
  }
  return [...porClave.values()];
};

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

  // Las opciones ya no salen de una lectura del rango: `construirOpciones`
  // sondea GSI7 y GSI8 valor por valor. La diferencia no es solo de costo —de
  // miles de eventos a una consulta por identificador distinto— sino de
  // correccion: cuando las dos listas se derivaban de una misma lectura
  // acotada, un tipo de registro con mucho volumen consumia el cupo y los demas
  // aparecian como "sin actividad en este rango" siendo falso.
  const opciones = rangoDeOpciones
    ? await construirOpciones({
        desde: rangoDeOpciones.desde,
        hasta: rangoDeOpciones.hasta,
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

        // GSI6: el tipo **es** la particion, asi que esto cuesta entre una y
        // cuatro consultas y no puede responder de menos. La version anterior
        // reusaba la lectura de las opciones si no habia truncado, y esa
        // heuristica devolvia 483 filas donde habia 841 (`desafios` 46).
        const lectura = await consultarBitacoraGlobal({
          desde: busqueda.rango.desde,
          hasta: busqueda.rango.hasta,
          tipo: busqueda.tipo,
        });
        if (!lectura.ok) {
          throw new Error(`No se pudo leer la bitacora: ${lectura.error}`);
        }
        return lectura.data;
      })()
    : undefined;

  // Las etiquetas de la columna «Registro» salen del **mismo** etiquetador que
  // las opciones, con una lectura por referencia distinta. Sin esto la columna
  // mostraba el tipo y un identificador generado, que es lo que la Etapa 11.2
  // existe para dejar de mostrar.
  //
  // Solo en el modo global: con un identificador elegido, todas las filas son
  // de ese mismo registro y repetirlo en cada una no informa de nada.
  const registros =
    resultado && !busqueda?.agregadoId
      ? await construirEtiquetador({
          referencias: referenciasDe(resultado.eventos),
          actorIds: [],
          diccionario,
        })
      : undefined;

  const filas = (resultado?.eventos ?? []).map((evento) =>
    aFilaDeBitacora(evento, diccionario, {
      ...(registros?.ok && evento.agregado && evento.agregadoId
        ? {
            registro: `${etiquetas.tiposDeAgregado[evento.agregado]} · ${registros.data.deAgregado(evento.agregado, evento.agregadoId)}`,
          }
        : {}),
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
