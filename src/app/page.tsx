import Link from "next/link";
import { Suspense } from "react";
import { Warn } from "@churchofjesuschrist/eden-alert";
import { Primary } from "@churchofjesuschrist/eden-buttons";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import GuiaDeInicio, { type BloqueEnGuia } from "@/components/GuiaDeInicio";
import PanelDeInicio, {
  type SiguientePasoEnPantalla,
} from "@/components/PanelDeInicio";
import { obtenerDiccionario, type Diccionario } from "@/dictionaries";
import { getSession } from "@/lib/auth/session";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import type { SiguientePaso } from "@/lib/domain/siguientePaso";
import { bloquesVisibles } from "@/lib/guiaDeInicio";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { resumenDeInicio } from "@/lib/inicio/resumenDeInicio";
import type { Sesion } from "@/types/identidad";
import "./pagina.css";

/**
 * Pantalla de inicio.
 *
 * **Dos piezas con dependencias distintas, y por eso van separadas.** La guia
 * de instrucciones depende solo de los permisos de la sesion, que ya estan en
 * memoria; el panel de "tu siguiente paso" depende de cuatro lecturas. Si
 * fueran una sola pieza, la pantalla entera esperaria a DynamoDB para decirle
 * a alguien como formarse en una fila —y desapareceria por completo si esa
 * lectura fallara—. El panel va en su `<Suspense>` y la guia se dibuja de
 * inmediato.
 *
 * `force-dynamic`: todo lo que se muestra depende de la sesion y del reloj del
 * servidor —que ventas estan abiertas, que plazo corre—. Nada de esto puede
 * entrar en cache estatica (regla 14).
 *
 * **`getSession()` no se envuelve en `catch`.** Aqui `null` significa visita
 * sin autenticar, que es un estado legitimo de esta pantalla; una excepcion
 * significa que EAS no respondio, y eso tiene que llegar al boundary de error
 * en vez de disfrazarse de visitante anonimo (regla 15). El encabezado si lo
 * atrapa, porque el encabezado no decide nada con los permisos.
 */
export const dynamic = "force-dynamic";

const InicioPagina = async () => {
  const [sesion, idioma] = await Promise.all([
    getSession(),
    obtenerIdiomaDePeticion(),
  ]);
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.inicio;

  if (!sesion) {
    return (
      <main className="inicio">
        <header className="inicio__encabezado">
          <H1>{etiquetas.sinSesionTitulo}</H1>
          <Text2 renderAs="p">{etiquetas.sinSesionDescripcion}</Text2>
        </header>
        <Primary renderAs={Link} href="/auth/login">
          {diccionario.navegacion.entrar}
        </Primary>
      </main>
    );
  }

  const bloques: BloqueEnGuia[] = bloquesVisibles(sesion.permisos).map(
    (bloque) => ({ id: bloque.id, href: bloque.href }),
  );

  return (
    <main className="inicio">
      <header className="inicio__encabezado">
        <H1>{diccionario.comun.nombreAplicacion}</H1>
        <Text2 renderAs="p">{etiquetas.bienvenida}</Text2>
      </header>

      <Suspense fallback={null}>
        <DatosDeInicio
          sesion={sesion}
          diccionario={diccionario}
          idioma={idioma}
        />
      </Suspense>

      {bloques.length > 0 ? (
        <GuiaDeInicio bloques={bloques} diccionario={diccionario} />
      ) : (
        // Una sesion valida sin ningun permiso es un caso real y distinto de
        // un EAS caido: entro bien, simplemente no le han asignado accesos.
        <Warn title={etiquetas.sinAccesosTitulo}>
          <Text2 renderAs="p">{etiquetas.sinAccesosDescripcion}</Text2>
        </Warn>
      )}
    </main>
  );
};

/**
 * El panel de datos, aparte para que tenga su propio `<Suspense>`.
 *
 * Formatea aqui, en el servidor, lo unico que el componente no puede calcular
 * sin volver a mirar el reloj: la fecha en hora de negocio y los segundos que
 * faltan (regla 9). `CuentaRegresiva` solo los decrementa.
 */
const DatosDeInicio = async ({
  sesion,
  diccionario,
  idioma,
}: {
  sesion: Sesion;
  diccionario: Diccionario;
  idioma: string;
}) => {
  const ahora = new Date();
  const resultado = await resumenDeInicio({
    participanteId: sesion.participanteId,
    permisos: sesion.permisos,
    tiposPermitidos: sesion.tiposDeConvocatoriaPermitidos,
    ahora,
  });

  if (!resultado.ok) {
    return (
      <PanelDeInicio
        pendientes={[]}
        fallo
        diccionario={diccionario}
        idioma={idioma}
      />
    );
  }

  const { siguientePaso, pendientes } = resultado.data;

  return (
    <PanelDeInicio
      siguientePaso={
        siguientePaso ? paraPantalla(siguientePaso, ahora) : undefined
      }
      pendientes={pendientes}
      diccionario={diccionario}
      idioma={idioma}
    />
  );
};

const paraPantalla = (
  paso: SiguientePaso,
  ahora: Date,
): SiguientePasoEnPantalla => {
  if (paso.tipo === "PLAZO_CORRIENDO") {
    const vence = desdeIso(paso.venceEn);
    return {
      ...paso,
      fechaFormateada: vence ? formatearFechaHora(vence) : undefined,
      segundosParaVencer: vence
        ? Math.max(0, Math.round((vence.getTime() - ahora.getTime()) / 1000))
        : undefined,
    };
  }

  if (paso.tipo === "PROXIMA_APERTURA") {
    const abre = desdeIso(paso.inicioVenta);
    return {
      ...paso,
      fechaFormateada: abre ? formatearFechaHora(abre) : undefined,
    };
  }

  return paso;
};

export default InicioPagina;
