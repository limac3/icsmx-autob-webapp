"use client";

import { useState, useTransition } from "react";
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
 * **El reordenamiento es con botones, no con arrastre.** El documento de UI
 * pide arrastre; se entrega mover arriba/abajo porque funciona con teclado, con
 * lector de pantalla y con el dedo en un telefono, que es el caso principal de
 * este proyecto. El arrastre queda pendiente como afinacion encima de esto, no
 * en su lugar.
 */

export type FotografiaEnGaleria = {
  fotoId: string;
  orden: number;
  descripcion?: string;
  /** URL firmada, valida por unos minutos. Nunca se persiste. */
  url: string;
  esPrincipal: boolean;
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

  const mover = (indice: number, direccion: -1 | 1) => {
    const destino = indice + direccion;
    if (destino < 0 || destino >= fotografias.length) return;

    const ids = fotografias.map((foto) => foto.fotoId);
    const [movida] = ids.splice(indice, 1);
    if (movida === undefined) return;
    ids.splice(destino, 0, movida);

    ejecutar(() => reordenarFotografias(vehiculoId, ids));
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
            <li key={foto.fotoId} className="galeria-vehiculo__item">
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
