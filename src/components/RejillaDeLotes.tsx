import Link from "next/link";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { Card } from "@churchofjesuschrist/eden-card";
import { Grid, Item } from "@churchofjesuschrist/eden-grid";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import { formatearEntero, formatearPrecio } from "@/lib/domain/dinero";
import type { EstatusLote } from "@/types/lote";
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
  fotografiaPrincipalUrl?: string;
};

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
      {lotes.map((lote) => (
        <Item key={lote.loteId} small={4} medium={4} large={4} xlarge={4}>
          <Link
            href={`${rutaBase}/lotes/${lote.loteId}`}
            className="rejilla-lotes__enlace"
          >
            <Card renderAs="article" className="rejilla-lotes__tarjeta">
              {lote.fotografiaPrincipalUrl ? (
                // `next/image` no aplica: la URL firmada caduca en minutos
                // (regla 13), igual que en `GaleriaVehiculo`.
                <img
                  className="rejilla-lotes__foto"
                  src={lote.fotografiaPrincipalUrl}
                  alt={`${lote.marca} ${lote.version} ${String(lote.modelo)}`}
                  loading="lazy"
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
