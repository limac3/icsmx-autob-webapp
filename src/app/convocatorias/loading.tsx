import Esqueleto from "@/components/Esqueleto";
import { obtenerDiccionario } from "@/dictionaries";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "./pagina.css";

/** Espera del catalogo de convocatorias — pantalla 3.1. */
const Cargando = async () => (
  <div className="catalogo">
    <Esqueleto
      variante="tabla"
      diccionario={obtenerDiccionario(await obtenerIdiomaDePeticion())}
    />
  </div>
);

export default Cargando;
