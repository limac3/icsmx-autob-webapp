import Esqueleto from "@/components/Esqueleto";
import { obtenerDiccionario } from "@/dictionaries";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "./pagina.css";

/**
 * Espera de la pantalla 3.5.
 *
 * La lectura son tres saltos —GSI3, la convocatoria de cada solicitud y el
 * vehiculo de cada lote—, asi que la espera es real y conviene reservarle su
 * sitio en lugar de dejar la pantalla en blanco.
 */
const Cargando = async () => (
  <div className="mis-solicitudes">
    <Esqueleto
      variante="tabla"
      diccionario={obtenerDiccionario(await obtenerIdiomaDePeticion())}
    />
  </div>
);

export default Cargando;
