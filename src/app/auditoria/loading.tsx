import Esqueleto from "@/components/Esqueleto";
import { obtenerDiccionario } from "@/dictionaries";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "./pagina.css";

/**
 * Espera de la bitacora — pantalla 7.
 *
 * Es la lectura mas cara de la aplicacion: PA-13 consulta una particion por mes
 * del rango, y las dos listas de opciones son lecturas independientes.
 */
const Cargando = async () => (
  <div className="auditoria">
    <Esqueleto
      variante="tabla"
      cuantos={8}
      diccionario={obtenerDiccionario(await obtenerIdiomaDePeticion())}
    />
  </div>
);

export default Cargando;
