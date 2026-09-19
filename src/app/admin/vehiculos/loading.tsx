import Esqueleto from "@/components/Esqueleto";
import { obtenerDiccionario } from "@/dictionaries";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "./pagina.css";

/** Espera del catalogo administrativo de vehiculos — pantalla 4.1. */
const Cargando = async () => (
  <div className="catalogo-vehiculos">
    <Esqueleto
      variante="tabla"
      diccionario={obtenerDiccionario(await obtenerIdiomaDePeticion())}
    />
  </div>
);

export default Cargando;
