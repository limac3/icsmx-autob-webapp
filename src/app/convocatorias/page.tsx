import { redirect } from "next/navigation";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import CatalogoConvocatorias, {
  type ConvocatoriaEnCatalogo,
} from "@/components/CatalogoConvocatorias";
import { obtenerDiccionario } from "@/dictionaries";
import { getSession } from "@/lib/auth/session";
import { listarConvocatoriasVisibles } from "@/lib/convocatorias/listarConvocatoriasVisibles";
import { desdeIso } from "@/lib/domain/fechas";
import { textoPlanoDeDescripcion } from "@/lib/domain/htmlDeDescripcion";
import { calcularEstadoDeVentaUi } from "@/lib/domain/ventanas";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "./pagina.css";

/**
 * Catalogo de convocatorias para el participante — pantalla 3.1.
 *
 * **Gating triple en la consulta** (regla 8, R-01): `listarConvocatoriasVisibles`
 * aplica `estatus = PUBLICADA`, `publicadaEn <= ahora` y el tipo compatible con
 * los permisos de venta de la sesion **dentro** de la `Query`. Nada de lo que
 * el participante no deberia ver llega siquiera a esta funcion.
 *
 * **Dinamica y sin cache estatica** (regla 14): esta pantalla depende de
 * `publicadaEn` y de los permisos de venta de quien mira, y ninguno de los dos
 * se puede fijar en tiempo de build.
 */
export const dynamic = "force-dynamic";

const CatalogoDeConvocatorias = async () => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.catalogo;

  const ahora = new Date();
  const resultado = await listarConvocatoriasVisibles(
    sesion.tiposDeConvocatoriaPermitidos,
    ahora,
  );
  if (!resultado.ok) throw new Error(resultado.error);

  const convocatorias: ConvocatoriaEnCatalogo[] = resultado.data.map(
    (convocatoria) => {
      const publicadaEn = desdeIso(convocatoria.publicadaEn);
      const inicioVenta = desdeIso(convocatoria.inicioVenta);
      const finVenta = desdeIso(convocatoria.finVenta);

      return {
        convocatoriaId: convocatoria.convocatoriaId,
        tipo: convocatoria.tipo,
        resumenDescripcion: textoPlanoDeDescripcion(
          convocatoria.descripcionParticipacion,
          160,
        ),
        cantidadDeLotes: convocatoria.cantidadDeLotes,
        // Las tres fechas ya se validaron al capturarse (R-14); si alguna no
        // parseara aqui, tratarla como cerrada es lo mas conservador que se
        // puede mostrar sin inventar un dato.
        estadoDeVenta:
          publicadaEn && inicioVenta && finVenta
            ? calcularEstadoDeVentaUi(
                { publicadaEn, inicioVenta, finVenta },
                ahora,
              )
            : ({ fase: "VENTA_CERRADA" } as const),
      };
    },
  );

  return (
    <main className="catalogo">
      <header className="catalogo__encabezado">
        <H1>{etiquetas.titulo}</H1>
        <Text2 renderAs="p">{etiquetas.descripcion}</Text2>
      </header>

      <CatalogoConvocatorias
        convocatorias={convocatorias}
        diccionario={diccionario}
        idioma={idioma}
      />
    </main>
  );
};

export default CatalogoDeConvocatorias;
