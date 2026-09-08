import { Drawer, Summary } from "@churchofjesuschrist/eden-accordion";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { Ghost, Secondary } from "@churchofjesuschrist/eden-buttons";
import { Text2, Text3 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import type { Permiso } from "@/types/identidad";
import "./BarraDeIdentidadSimulada.css";

/**
 * Conmutador de identidad simulada — **solo desarrollo**.
 *
 * Presentacional y sin I/O: recibe el roster ya resuelto y la action ya
 * enlazada. Quien lee la sesion y el modo es
 * `PanelDeIdentidadSimulada.tsx`; separarlo mantiene esta pieza probable en
 * jsdom sin montar cookies ni sesion.
 *
 * **Un solo `<form>` con un boton de envio por persona.** El `name`/`value` del
 * boton pulsado es lo que viaja, que es HTML nativo: la barra funciona sin una
 * linea de JavaScript de cliente y por eso no necesita `"use client"`
 * (regla 1). `Drawer`/`Summary` no comparan hijos por identidad, asi que
 * sobreviven la frontera de RSC — igual que en `FichaTecnicaVehiculo.tsx`.
 *
 * **No muestra roles.** Cada persona se describe por los permisos que recibe,
 * con las etiquetas del diccionario (regla 11): el concepto de rol no sale de
 * `rolesSimulados.ts`, ni siquiera hacia esta pantalla.
 */

export type PersonaEnBarra = {
  readonly id: string;
  readonly nombre: string;
  readonly permisos: readonly Permiso[];
};

export type BarraDeIdentidadSimuladaProps = {
  personas: readonly PersonaEnBarra[];
  /** Persona vigente, o `null` si la sesion sale de las variables de entorno. */
  idActivo: string | null;
  /** Nombre que la sesion esta presentando ahora mismo. */
  nombreVigente: string;
  /**
   * Sub real de Okta. Se muestra a proposito: es lo unico que distingue "con
   * quien estoy navegando" de "con quien inicie sesion", y confundir los dos
   * es la forma mas facil de perder una hora depurando la pantalla equivocada.
   */
  oktaSub: string;
  accion: (formData: FormData) => void | Promise<void>;
  diccionario: Diccionario;
};

const BarraDeIdentidadSimulada = ({
  personas,
  idActivo,
  nombreVigente,
  oktaSub,
  accion,
  diccionario,
}: BarraDeIdentidadSimuladaProps) => {
  const etiquetas = diccionario.desarrollo;
  const etiquetasPermisos = diccionario.permisos;

  const describir = (permisos: readonly Permiso[]): string =>
    permisos.length === 0
      ? etiquetas.sinPermisos
      : permisos.map((permiso) => etiquetasPermisos[permiso]).join(" · ");

  return (
    <aside className="identidad-simulada" aria-label={etiquetas.titulo}>
      <Drawer>
        <Summary>
          <span className="identidad-simulada__resumen">
            <Badge color="warn">{etiquetas.insignia}</Badge>
            <Text3 renderAs="span">
              {idActivo === null ? etiquetas.sinSimular : nombreVigente}
            </Text3>
          </span>
        </Summary>

        <div className="identidad-simulada__cuerpo">
          <Text3 renderAs="p" className="identidad-simulada__ayuda">
            {etiquetas.ayuda}
          </Text3>

          <form action={accion} className="identidad-simulada__opciones">
            {personas.map((persona) => {
              const activa = persona.id === idActivo;
              const contenido = (
                <span className="identidad-simulada__persona">
                  <Text2 renderAs="span">{persona.nombre}</Text2>
                  <Text3 renderAs="span">{describir(persona.permisos)}</Text3>
                </span>
              );

              // Dos variantes de Eden en vez de una clase modificadora:
              // `Secondary` marca la persona vigente y `Ghost` las demas, sin
              // CSS propio para el estado (regla 10). Las ramas van
              // desplegadas porque `Ghost` y `Secondary` son componentes
              // polimorficos: asignar uno de los dos a una variable y usarlo
              // como JSX pierde la resolucion de sus sobrecargas.
              return activa ? (
                <Secondary
                  key={persona.id}
                  type="submit"
                  name="persona"
                  value={persona.id}
                  small
                  fullWidth
                  aria-pressed={true}
                >
                  {contenido}
                </Secondary>
              ) : (
                <Ghost
                  key={persona.id}
                  type="submit"
                  name="persona"
                  value={persona.id}
                  small
                  fullWidth
                  aria-pressed={false}
                >
                  {contenido}
                </Ghost>
              );
            })}

            {/* Sin `value`: el campo llega vacio y la action borra la cookie. */}
            {idActivo === null ? null : (
              <Ghost type="submit" name="persona" value="" small fullWidth>
                {etiquetas.volverAlEntorno}
              </Ghost>
            )}
          </form>

          <Text3 renderAs="p" className="identidad-simulada__pie">
            {`${etiquetas.sesionRealDeOkta}: ${oktaSub}`}
          </Text3>
        </div>
      </Drawer>
    </aside>
  );
};

export default BarraDeIdentidadSimulada;
