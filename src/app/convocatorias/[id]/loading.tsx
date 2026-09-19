import Esqueleto from "@/components/Esqueleto";
import { obtenerDiccionario } from "@/dictionaries";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "../pagina.css";

/**
 * Espera del detalle de convocatoria — pantalla 3.2.
 *
 * Variante de rejilla porque lo que viene es la rejilla de lotes, y es la
 * pantalla donde reservar el sitio importa mas: cada tarjeta trae fotografia,
 * asi que sin esqueleto el contenido salta dos veces —al llegar el marcado y
 * al decodificarse las imagenes—.
 */
const Cargando = async () => (
  <div className="catalogo">
    <Esqueleto
      variante="rejilla"
      diccionario={obtenerDiccionario(await obtenerIdiomaDePeticion())}
    />
  </div>
);

export default Cargando;
