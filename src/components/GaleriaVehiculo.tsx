"use client";

import { useState, useTransition, type DragEvent } from "react";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { Error as AlertaError } from "@churchofjesuschrist/eden-alert";
import { Ghost, Secondary } from "@churchofjesuschrist/eden-buttons";
import {
  FileInput,
  FormField,
  Input,
} from "@churchofjesuschrist/eden-form-parts";
import { Text2 } from "@churchofjesuschrist/eden-text";
import {
  agregarFotografia,
  eliminarFotografia,
  marcarFotografiaPrincipal,
  reordenarFotografias,
} from "@/app/actions/vehiculos";
import type { Diccionario } from "@/dictionaries";
import type { CodigoError } from "@/types/resultado";
import "./GaleriaVehiculo.css";

/**
 * Galeria de un vehiculo — pantalla 4.2 de `ui-ux-requerimientos.md`.
 *
 * Las URLs llegan **ya firmadas desde el servidor** y no se guardan en ningun
 * lado: son credenciales con vencimiento corto (regla 13). Este componente solo
 * las pinta.
 *
 * **El reordenamiento tiene dos caminos, y los botones son el principal.**
 * Mover arriba/abajo funciona con teclado, con lector de pantalla y con el dedo
 * en un telefono. El arrastre va **encima** de eso, como atajo para quien usa
 * raton: si manana dejara de funcionar, la galeria seguiria siendo reordenable
 * por todos. Por eso no lleva semantica ARIA de arrastre —`aria-grabbed` esta
 * obsoleto y no lo anuncia ningun lector— y los botones no se ocultan cuando
 * hay arrastre disponible.
 */

export type FotografiaEnGaleria = {
  fotoId: string;
  orden: number;
  descripcion?: string;
  /** URL firmada, valida por unos minutos. Nunca se persiste. */
  url: string;
  esPrincipal: boolean;
};

/** Une clases descartando las condicionales apagadas. */
const clases = (...valores: (string | false | undefined)[]): string =>
  valores.filter((valor) => typeof valor === "string").join(" ");

/**
 * Mueve un elemento de `desde` a `hasta`, recorriendo a los demas.
 *
 * Es una funcion aparte porque los dos caminos —botones y arrastre— tienen que
 * dar **el mismo** resultado: soltar sobre la cuarta posicion debe dejar la
 * galeria igual que pulsar "abajo" hasta llegar a ella. Con la cuenta escrita
 * dos veces, esa igualdad seria una coincidencia.
 *
 * Los indices fuera de rango devuelven la lista intacta en vez de lanzar: el
 * unico origen de un indice invalido es un evento de arrastre a medias, y
 * quedarse quieto es la respuesta correcta.
 */
export const moverEnLista = <T,>(
  lista: readonly T[],
  desde: number,
  hasta: number,
): T[] => {
  const copia = [...lista];
  const enRango = (indice: number) => indice >= 0 && indice < copia.length;
  if (desde === hasta || !enRango(desde) || !enRango(hasta)) return copia;

  const [movido] = copia.splice(desde, 1);
  if (movido === undefined) return [...lista];
  copia.splice(hasta, 0, movido);
  return copia;
};

export type GaleriaVehiculoProps = {
  vehiculoId: string;
  fotografias: readonly FotografiaEnGaleria[];
  diccionario: Diccionario;
  /** Con `false` la galeria se ve pero no se toca. */
  puedeEditar: boolean;
};

const GaleriaVehiculo = ({
  vehiculoId,
  fotografias,
  diccionario,
  puedeEditar,
}: GaleriaVehiculoProps) => {
  const [enProceso, iniciar] = useTransition();
  const [error, setError] = useState<CodigoError | undefined>(undefined);
  // Indice que se arrastra y indice sobre el que esta parado. El segundo es
  // solo para pintar donde va a caer: sin esa senal, arrastrar es adivinar.
  const [origen, setOrigen] = useState<number | undefined>(undefined);
  const [destino, setDestino] = useState<number | undefined>(undefined);
  const etiquetas = diccionario.vehiculos.fotografias;

  const ejecutar = (accion: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(undefined);
    iniciar(async () => {
      const resultado = await accion();
      if (!resultado.ok) setError(resultado.error as CodigoError);
    });
  };

  const subir = (formData: FormData) => {
    const archivo = formData.get("archivo");
    if (!(archivo instanceof File) || archivo.size === 0) return;
    const descripcion = String(formData.get("descripcion") ?? "");

    ejecutar(() => agregarFotografia({ vehiculoId, archivo, descripcion }));
  };

  const reordenar = (desde: number, hasta: number) => {
    if (desde === hasta) return;
    const ids = fotografias.map((foto) => foto.fotoId);
    const nuevoOrden = moverEnLista(ids, desde, hasta);
    // `moverEnLista` devuelve la lista intacta si algun indice no aplica; sin
    // esta comprobacion se mandaria al servidor una transaccion vacia.
    if (nuevoOrden.every((id, indice) => id === ids[indice])) return;

    ejecutar(() => reordenarFotografias(vehiculoId, nuevoOrden));
  };

  const mover = (indice: number, direccion: -1 | 1) => {
    reordenar(indice, indice + direccion);
  };

  // Con una sola fotografia no hay nada que reordenar, y un item arrastrable
  // que no lleva a ningun lado es ruido.
  const sePuedeArrastrar = puedeEditar && !enProceso && fotografias.length > 1;

  const olvidarArrastre = () => {
    setOrigen(undefined);
    setDestino(undefined);
  };

  const iniciarArrastre = (
    evento: DragEvent<HTMLLIElement>,
    indice: number,
    fotoId: string,
  ) => {
    setOrigen(indice);
    setDestino(indice);
    // Firefox no arranca el arrastre si nadie escribe en `dataTransfer`. El
    // indice de verdad viaja por estado y no por aqui: durante `dragover` el
    // navegador **no deja leer** los datos, solo escribirlos.
    evento.dataTransfer.effectAllowed = "move";
    evento.dataTransfer.setData("text/plain", fotoId);
  };

  const arrastrarSobre = (evento: DragEvent<HTMLLIElement>, indice: number) => {
    // Sin `preventDefault` el navegador rechaza el soltar. Se llama solo
    // cuando el arrastre nacio en esta galeria: asi, un archivo traido del
    // escritorio cae en el formulario de subida y no aqui.
    if (origen === undefined) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    setDestino(indice);
  };

  const soltar = (evento: DragEvent<HTMLLIElement>, indice: number) => {
    if (origen === undefined) return;
    evento.preventDefault();
    const desde = origen;
    olvidarArrastre();
    reordenar(desde, indice);
  };

  return (
    <section className="galeria-vehiculo" aria-busy={enProceso}>
      {error ? (
        <AlertaError>
          <Text2 renderAs="p">{diccionario.errores[error]}</Text2>
        </AlertaError>
      ) : null}

      {fotografias.length === 0 ? (
        <Text2 renderAs="p">{etiquetas.vacia}</Text2>
      ) : (
        <ul className="galeria-vehiculo__lista">
          {fotografias.map((foto, indice) => (
            <li
              key={foto.fotoId}
              className={clases(
                "galeria-vehiculo__item",
                sePuedeArrastrar && "galeria-vehiculo__item--movible",
                origen === indice && "galeria-vehiculo__item--arrastrando",
                origen !== undefined &&
                  destino === indice &&
                  origen !== indice &&
                  "galeria-vehiculo__item--destino",
              )}
              // El titulo aparece al posar el raton, que es justo el unico
              // contexto donde el arrastre existe. En un telefono no estorba
              // porque no hay hover, y en un lector de pantalla no compite con
              // los botones, que ya dicen lo mismo con `aria-label`.
              title={
                sePuedeArrastrar ? etiquetas.arrastrarParaReordenar : undefined
              }
              draggable={sePuedeArrastrar}
              onDragStart={(evento) => {
                iniciarArrastre(evento, indice, foto.fotoId);
              }}
              onDragOver={(evento) => {
                arrastrarSobre(evento, indice);
              }}
              onDrop={(evento) => {
                soltar(evento, indice);
              }}
              onDragEnd={olvidarArrastre}
            >
              {/* `next/image` no se usa aqui: optimizar exigiria que el
                  optimizador alcance una URL firmada que caduca en minutos, y
                  la fotografia ya llega por CloudFront. */}
              <img
                className="galeria-vehiculo__imagen"
                src={foto.url}
                alt={foto.descripcion ?? ""}
                loading="lazy"
              />

              {foto.esPrincipal ? (
                <Badge color="success">{etiquetas.principal}</Badge>
              ) : null}

              {puedeEditar ? (
                <div className="galeria-vehiculo__acciones">
                  <Ghost
                    type="button"
                    disabled={enProceso || indice === 0}
                    aria-label={`${etiquetas.moverArriba}: ${String(indice + 1)}`}
                    onClick={() => {
                      mover(indice, -1);
                    }}
                  >
                    ↑
                  </Ghost>
                  <Ghost
                    type="button"
                    disabled={enProceso || indice === fotografias.length - 1}
                    aria-label={`${etiquetas.moverAbajo}: ${String(indice + 1)}`}
                    onClick={() => {
                      mover(indice, 1);
                    }}
                  >
                    ↓
                  </Ghost>
                  <Ghost
                    type="button"
                    disabled={enProceso || foto.esPrincipal}
                    onClick={() => {
                      ejecutar(() =>
                        marcarFotografiaPrincipal(vehiculoId, foto.fotoId),
                      );
                    }}
                  >
                    {etiquetas.marcarPrincipal}
                  </Ghost>
                  <Ghost
                    type="button"
                    // La ultima no se puede eliminar; el boton lo dice antes de
                    // intentarlo, y el servidor lo vuelve a comprobar.
                    disabled={enProceso || fotografias.length === 1}
                    title={
                      fotografias.length === 1
                        ? etiquetas.noSePuedeEliminarUltima
                        : undefined
                    }
                    onClick={() => {
                      ejecutar(() =>
                        eliminarFotografia(vehiculoId, foto.fotoId),
                      );
                    }}
                  >
                    {etiquetas.eliminar}
                  </Ghost>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {puedeEditar ? (
        <form action={subir} className="galeria-vehiculo__subida">
          <FormField
            label={etiquetas.subirArchivo}
            description={etiquetas.formatosAdmitidos}
          >
            <FileInput
              name="archivo"
              accept="image/jpeg,image/png,image/webp"
              required
            />
          </FormField>
          <FormField label={etiquetas.descripcion}>
            <Input name="descripcion" />
          </FormField>
          <Secondary type="submit" disabled={enProceso}>
            {enProceso ? etiquetas.subiendo : etiquetas.agregar}
          </Secondary>
        </form>
      ) : null}
    </section>
  );
};

export default GaleriaVehiculo;
