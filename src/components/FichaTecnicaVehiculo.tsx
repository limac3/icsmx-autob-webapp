import { Drawer, Summary } from "@churchofjesuschrist/eden-accordion";
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import { formatearEntero } from "@/lib/domain/dinero";

/**
 * Ficha tecnica del vehiculo de un lote — pantalla 3.3.
 *
 * **Cacheable**, a diferencia del bloque de accion de la misma pantalla: no
 * depende de la sesion ni de la fila, solo de los datos del vehiculo
 * (`arquitectura-tecnica-aws.md` 3, fila `/convocatorias/[id]/lotes/[loteId]`).
 *
 * `Drawer`/`Summary` no comparan hijos por identidad —a diferencia de `Table`
 * o `Select`—, asi que puede ser Server Component.
 */

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
  const campos = diccionario.vehiculos.campos;

  const secciones: { titulo: string; contenido: string }[] = [
    {
      titulo: campos.kilometraje,
      contenido: `${formatearEntero(kilometraje, idioma)} km`,
    },
    ...(nivelEquipamiento
      ? [{ titulo: campos.nivelEquipamiento, contenido: nivelEquipamiento }]
      : []),
    ...(especificacionMecanica
      ? [
          {
            titulo: campos.especificacionMecanica,
            contenido: especificacionMecanica,
          },
        ]
      : []),
    ...(condicionesMecanicas
      ? [
          {
            titulo: campos.condicionesMecanicas,
            contenido: condicionesMecanicas,
          },
        ]
      : []),
    ...(detallesEsteticos
      ? [{ titulo: campos.detallesEsteticos, contenido: detallesEsteticos }]
      : []),
  ];

  return (
    <>
      {secciones.map((seccion) => (
        <Drawer key={seccion.titulo}>
          <Summary>{seccion.titulo}</Summary>
          <Text2 renderAs="p">{seccion.contenido}</Text2>
        </Drawer>
      ))}
    </>
  );
};

export default FichaTecnicaVehiculo;
