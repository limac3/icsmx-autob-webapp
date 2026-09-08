// Presentacion de importes. Puro, sin I/O, como el resto de `src/lib/domain`.

/**
 * Moneda de la operacion.
 *
 * La venta ocurre en Mexico —la misma razon por la que la zona horaria de
 * negocio es `America/Mexico_City` (regla 9)— y los importes se acuerdan en
 * pesos. Es una constante y no una configuracion porque no hay un segundo caso:
 * el dia que lo haya, este es el unico sitio que hay que tocar.
 */
export const MONEDA_DE_NEGOCIO = "MXN";

/**
 * Region que decide el formato del numero.
 *
 * **El idioma de la interfaz no basta.** Con `es` a secas, `Intl` aplica las
 * convenciones de Espana y escribe `185.000 MXN`: el punto como separador de
 * miles es exactamente lo que un lector mexicano interpreta como decimales. El
 * importe es de una operacion en Mexico se lea en el idioma que se lea, asi que
 * la region va fija y solo el idioma cambia. Es la misma decision que la zona
 * horaria unica de negocio.
 *
 * En ingles el resultado es `MX$185,000`, que ademas distingue el peso del
 * dolar sin que nadie tenga que preguntarlo.
 */
const REGION_DE_NEGOCIO = "MX";

/**
 * Formatea un precio de lote.
 *
 * **Sin decimales**, porque el precio se guarda como entero de pesos: pintar
 * ".00" sugeriria una precision que el dato no tiene e invitaria a capturar
 * centavos que el dominio rechaza (ver `PRECIO_MAXIMO_LOTE` en
 * `convocatorias.ts`).
 */
export const formatearPrecio = (precio: number, idioma: string): string =>
  new Intl.NumberFormat(`${idioma}-${REGION_DE_NEGOCIO}`, {
    style: "currency",
    currency: MONEDA_DE_NEGOCIO,
    maximumFractionDigits: 0,
  }).format(precio);
