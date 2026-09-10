import { Drawer, Summary } from "@churchofjesuschrist/eden-accordion";
import { DD, DL, DT } from "@churchofjesuschrist/eden-description-list";
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import { formatearEntero } from "@/lib/domain/dinero";

/**
 * Ficha tecnica del vehiculo de un lote — pantalla 3.3.
 *
 * **Dos desplegables y no uno por campo.** Antes cada dato tenia el suyo —hasta
 * cinco seguidos—, y consultar un vehiculo obligaba a abrirlos de uno en uno
 * para ver cinco parrafos. Se agrupan con **la misma division que el
 * formulario de alta y edicion** (`FormularioVehiculo`): especificacion es lo
 * que el vehiculo *es* y condicion lo que el vehiculo *tiene*. Que las dos
 * pantallas partan el dato igual es lo que permite capturar mirando una y
 * revisar mirando la otra.
 *
 * **Cacheable**, a diferencia del bloque de accion de la misma pantalla: no
 * depende de la sesion ni de la fila, solo de los datos del vehiculo
 * (`arquitectura-tecnica-aws.md` 3, fila `/convocatorias/[id]/lotes/[loteId]`).
 *
 * `Drawer`/`Summary` no comparan hijos por identidad —a diferencia de `Table`
 * o `Select`—, asi que puede ser Server Component.
 */

/**
 * Los dos grupos, con sus campos en el orden del formulario.
 *
 * Es una constante de modulo y no JSX repetido para que el orden y la
 * pertenencia sean un dato: agregar un campo a la ficha es agregarlo aqui, y no
 * hay forma de que aparezca en un grupo y falte en el otro.
 */
const GRUPOS = [
  {
    titulo: "seccionEspecificacion",
    campos: ["kilometraje", "nivelEquipamiento", "especificacionMecanica"],
  },
  {
    titulo: "seccionCondicion",
    campos: ["condicionesMecanicas", "detallesEsteticos"],
  },
] as const;

type CampoDeFicha = (typeof GRUPOS)[number]["campos"][number];

export type FichaTecnicaVehiculoProps = {
  kilometraje: number;
  nivelEquipamiento?: string;
  especificacionMecanica?: string;
  condicionesMecanicas?: string;
  detallesEsteticos?: string;
  diccionario: Diccionario;
  idioma: string;
};

const FichaTecnicaVehiculo = ({
  kilometraje,
  nivelEquipamiento,
  especificacionMecanica,
  condicionesMecanicas,
  detallesEsteticos,
  diccionario,
  idioma,
}: FichaTecnicaVehiculoProps) => {
  const etiquetas = diccionario.vehiculos;
  const campos = etiquetas.campos;

  const contenidoPorCampo: Record<CampoDeFicha, string | undefined> = {
    kilometraje: `${formatearEntero(kilometraje, idioma)} km`,
    nivelEquipamiento,
    especificacionMecanica,
    condicionesMecanicas,
    detallesEsteticos,
  };

  return (
    <>
      {GRUPOS.map((grupo) => {
        const datos = grupo.campos.flatMap((campo) => {
          const contenido = contenidoPorCampo[campo];
          return contenido ? [{ campo, contenido }] : [];
        });

        // Un grupo sin un solo dato no se pinta: un desplegable vacio invita a
        // abrirlo para nada. `kilometraje` es obligatorio, asi que en la
        // practica solo le pasa a condicion.
        if (datos.length === 0) return null;

        return (
          <Drawer key={grupo.titulo}>
            <Summary>{etiquetas[grupo.titulo]}</Summary>
            {/* `DL` y no parrafos sueltos: cada dato es una etiqueta con su
                valor, y esa relacion es la que un lector de pantalla anuncia.
                La etiqueta queda **arriba** del valor y no en una columna al
                lado, que es lo que necesitan `especificacionMecanica`,
                `condicionesMecanicas` y `detallesEsteticos`: son texto libre de
                varios renglones y en dos columnas caerian en una franja
                estrecha y altisima. */}
            <DL>
              {datos.map(({ campo, contenido }) => (
                <div key={campo}>
                  <DT>{campos[campo]}</DT>
                  <DD>
                    <Text2 renderAs="p">{contenido}</Text2>
                  </DD>
                </div>
              ))}
            </DL>
          </Drawer>
        );
      })}
    </>
  );
};

export default FichaTecnicaVehiculo;
