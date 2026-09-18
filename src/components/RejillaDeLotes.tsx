import Link from "next/link";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { Card } from "@churchofjesuschrist/eden-card";
import { Grid, Item } from "@churchofjesuschrist/eden-grid";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import { formatearEntero, formatearPrecio } from "@/lib/domain/dinero";
import type { EstatusLote } from "@/types/lote";
import type { FuentesDeImagen } from "@/types/media";
import "./RejillaDeLotes.css";

/**
 * Rejilla de vehiculos de una convocatoria — pantalla 3.2.
 *
 * **Server Component.** A diferencia de `CatalogoConvocatorias`, aqui no hay
 * ningun componente de Eden que compare hijos por identidad —`Grid`, `Card` y
 * `Badge` no lo hacen (`desafios-implementacion.md` 23 es especifico de
 * `Table` y `Select`)—, asi que no hace falta la frontera de cliente.
 *
 * `tamanoFila` es una **cantidad**, nunca identidades (regla 7 y R-12): antes
 * de la Etapa 8 siempre es cero, porque no existe ninguna solicitud todavia.
 */

/** Compartido con el detalle de lote, para que el mismo estatus se pinte igual. */
export const COLOR_POR_ESTATUS: Record<
  EstatusLote,
  "success" | "info" | "warn" | "greySoft" | "default"
> = {
  EN_OFERTA: "success",
  ADJUDICADO: "warn",
  VENDIDO: "info",
  NO_VENDIDO: "default",
  RETIRADO: "greySoft",
};

export type LoteEnCatalogo = {
  loteId: string;
  marca: string;
  version: string;
  modelo: number;
  kilometraje: number;
  precio: number;
  estatus: EstatusLote;
  tamanoFila: number;
  /**
   * Fuentes ya firmadas de la fotografia principal, o ausente si el vehiculo no
   * tiene galeria o no se pudo leer.
   *
   * Un objeto y no cuatro campos paralelos opcionales: `src` sin `ancho` es un
   * estado que no queremos poder representar.
   */
  fotografiaPrincipal?: FuentesDeImagen;
};

/**
 * Cuanto mide la tarjeta, traducido a viewport.
 *
 * **`eden-grid` usa container queries y `sizes` no las sabe expresar**, asi que
 * hay que traducir asumiendo el cromo de la pagina. La derivacion, para poder
 * revisarla cuando alguien cambie un padding:
 *
 *   contenedor C = min(100vw, 1600) - 2*padding(.envoltura__contenido) - 2*1.5rem(.catalogo)
 *
 * o sea `100vw - 80px` hasta 600 px de viewport y `min(100vw,1600) - 96px` por
 * encima. Con `Item small=4 medium=4 large=4` sobre una rejilla que pasa de 4 a
 * 8 columnas en 30rem y a 12 en 52.5rem, la tarjeta mide C, C/2 y C/3, con las
 * fronteras de viewport en ~561 px y ~936 px.
 *
 * El techo se declara en **480 px y no en los 485 que da la cuenta**:
 * sub-declarar un 1 % es invisible con `object-fit: cover` y evita que una
 * pantalla de densidad 1 salte a la variante de 1280 —unas seis veces el peso—
 * por cinco pixeles.
 *
 * **Ninguna prueba puede comprobar que esta traduccion siga siendo cierta.** Si
 * cambia el padding de la envoltura o el `span` del `Item`, esto miente y el
 * unico sintoma es que las imagenes pesan un poco mas o se ven un poco blandas.
 */
const TAMANOS_DE_TARJETA = [
  "(min-width: 1584px) 480px",
  "(min-width: 936px) calc((100vw - 96px) / 3 - 16px)",
  "(min-width: 561px) calc((100vw - 96px) / 2 - 12px)",
  "calc(100vw - 80px)",
].join(", ");

/**
 * Cuantas tarjetas se cargan con prioridad.
 *
 * El LCP de esta pantalla es la primera fotografia, y estaba marcada `lazy`:
 * el navegador la posterga hasta despues del layout y con prioridad baja, que
 * es el antipatron conocido. Tres cubre la primera fila en escritorio; el resto
 * sigue diferido, que es lo que hace util el diferimiento.
 */
const TARJETAS_PRIORITARIAS = 3;

export type RejillaDeLotesProps = {
  /**
   * Ruta de la pantalla de convocatoria desde la que se mira; los vehiculos
   * cuelgan de ella.
   *
   * **No es el identificador de la convocatoria, y esa es toda la diferencia.**
   * La misma rejilla la pintan dos pantallas —la del participante y la vista
   * previa administrativa— y cada una tiene que enlazar dentro de si misma: con
   * el identificador, la vista previa mandaba al detalle publico del vehiculo,
   * que responde 404 a quien administra porque no tiene el permiso de venta del
   * tipo (R-01, R-02).
   */
  rutaBase: string;
  lotes: readonly LoteEnCatalogo[];
  diccionario: Diccionario;
  idioma: string;
};

const RejillaDeLotes = ({
  rutaBase,
  lotes,
  diccionario,
  idioma,
}: RejillaDeLotesProps) => {
  const etiquetas = diccionario.catalogo;

  if (lotes.length === 0) {
    // `sinResultados` es del **listado de convocatorias** —"No hay
    // convocatorias disponibles"— y aqui la rejilla habla de vehiculos: el
    // mensaje contestaba otra pregunta. Lo destapo la vista previa
    // administrativa, mirando una convocatoria sin lotes.
    return <Text2 renderAs="p">{etiquetas.sinLotes}</Text2>;
  }

  return (
    <Grid>
      {lotes.map((lote, indice) => (
        <Item key={lote.loteId} small={4} medium={4} large={4} xlarge={4}>
          <Link
            href={`${rutaBase}/lotes/${lote.loteId}`}
            className="rejilla-lotes__enlace"
          >
            <Card renderAs="article" className="rejilla-lotes__tarjeta">
              {lote.fotografiaPrincipal ? (
                // `next/image` no aplica: la URL firmada caduca (regla 13) y,
                // desde que las variantes se generan al subir, el optimizador
                // no tendria nada que aportar. Igual que en `GaleriaVehiculo`.
                <img
                  className="rejilla-lotes__foto"
                  src={lote.fotografiaPrincipal.src}
                  {...(lote.fotografiaPrincipal.srcSet
                    ? {
                        srcSet: lote.fotografiaPrincipal.srcSet,
                        sizes: TAMANOS_DE_TARJETA,
                      }
                    : {})}
                  width={lote.fotografiaPrincipal.ancho}
                  height={lote.fotografiaPrincipal.alto}
                  alt={`${lote.marca} ${lote.version} ${String(lote.modelo)}`}
                  {...(indice < TARJETAS_PRIORITARIAS
                    ? {
                        loading: "eager" as const,
                        fetchPriority: "high" as const,
                      }
                    : { loading: "lazy" as const })}
                />
              ) : (
                <Text4 renderAs="p">{etiquetas.sinFotografias}</Text4>
              )}

              <Text2 renderAs="p">
                {`${lote.marca} ${lote.version} ${String(lote.modelo)}`}
              </Text2>
              <Text4 renderAs="p">
                {`${formatearEntero(lote.kilometraje, idioma)} km`}
              </Text4>
              <Text2 renderAs="p">{formatearPrecio(lote.precio, idioma)}</Text2>

              <Badge color={COLOR_POR_ESTATUS[lote.estatus]}>
                {diccionario.estatusLote[lote.estatus]}
              </Badge>
              <Text4 renderAs="p">
                {`${String(lote.tamanoFila)} ${etiquetas.enFila}`}
              </Text4>
            </Card>
          </Link>
        </Item>
      ))}
    </Grid>
  );
};

export default RejillaDeLotes;
