// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { ANCHOS_DE_VARIANTE } from "@/types/vehiculo";
import { MAXIMO_PIXELES_ENTRADA, normalizarImagen } from "./normalizarImagen";

vi.mock("server-only", () => ({}));

/**
 * Las imagenes de prueba las genera sharp aqui mismo.
 *
 * Asi no hay binarios de fixture en el repositorio y cada caso declara la
 * geometria que necesita en la linea que la usa.
 */
const jpeg = (ancho: number, alto: number) =>
  sharp({
    create: {
      width: ancho,
      height: alto,
      channels: 3,
      background: { r: 120, g: 140, b: 160 },
    },
  })
    .jpeg()
    .toBuffer();

const png = (ancho: number, alto: number) =>
  sharp({
    create: {
      width: ancho,
      height: alto,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .png()
    .toBuffer();

const avif = (ancho: number, alto: number) =>
  sharp({
    create: {
      width: ancho,
      height: alto,
      channels: 3,
      background: { r: 200, g: 60, b: 60 },
    },
  })
    .avif()
    .toBuffer();

const normalizar = async (bytes: Buffer, contentType = "image/jpeg") =>
  normalizarImagen({ bytes: new Uint8Array(bytes), contentType });

describe("EXIF y orientacion", () => {
  it("hornea la orientacion y no copia el EXIF a la salida", async () => {
    // **La prueba mas importante de este modulo, y cubre algo que nadie pidio.**
    // El archivo original se publicaba tal cual, con su EXIF intacto: eso
    // incluye las coordenadas GPS del patio donde se tomo la fotografia.
    // Recodificar lo elimina. Y de paso arregla la foto acostada: `Orientation:
    // 6` significa "girar 90 grados", y en cuanto el metadato desaparece, si los
    // pixeles no se giraron la imagen sale mal.
    // `withMetadata({ orientation })` y **no** `withExif({ IFD0: { Orientation }})`:
    // el segundo escribe el bloque EXIF pero `metadata().orientation` sigue
    // devolviendo 1, asi que `rotate()` no gira nada y la prueba pasaria
    // afirmando lo contrario de lo que cree. Comprobado antes de escribirla.
    const vertical = await sharp(await jpeg(400, 800))
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const entrada = await sharp(vertical).metadata();
    expect(entrada.orientation).toBe(6);
    expect(entrada.exif).toBeDefined();

    const resultado = await normalizar(vertical);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    for (const variante of resultado.imagen.variantes) {
      const salida = await sharp(variante.cuerpo).metadata();

      // Sin EXIF: no viaja el GPS.
      expect(salida.exif).toBeUndefined();
      // Y con el giro aplicado a los pixeles: la entrada era 400x800 declarada
      // como girada, asi que la salida queda horizontal.
      expect(salida.width).toBeGreaterThan(salida.height as number);
    }
  });
});

describe("variantes", () => {
  it("produce las tres, en orden ascendente y con los anchos declarados", async () => {
    const resultado = await normalizar(await jpeg(4032, 3024));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.imagen.variantes.map((v) => v.nombre)).toEqual([
      "min",
      "med",
      "max",
    ]);
    expect(resultado.imagen.variantes.map((v) => v.ancho)).toEqual([
      ANCHOS_DE_VARIANTE.min,
      ANCHOS_DE_VARIANTE.med,
      ANCHOS_DE_VARIANTE.max,
    ]);
  });

  it("todas salen en WebP, sea cual sea la entrada", async () => {
    const resultado = await normalizar(await png(1000, 750), "image/png");
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    for (const variante of resultado.imagen.variantes) {
      expect((await sharp(variante.cuerpo).metadata()).format).toBe("webp");
    }
  });

  it("conserva la relacion de aspecto: el recorte lo hace el navegador", async () => {
    // Recortar a 4:3 en el servidor mutilaria el visor ampliado, que muestra la
    // fotografia completa. La rejilla usa `object-fit: cover` justo para eso.
    const resultado = await normalizar(await jpeg(1600, 1000));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    for (const variante of resultado.imagen.variantes) {
      expect(variante.ancho / variante.alto).toBeCloseTo(1.6, 1);
    }
  });

  it("no agranda una imagen mas chica que la variante menor", async () => {
    // `withoutEnlargement`: una entrada de 400 px —por debajo de los 480 de la
    // variante menor— produce **tres variantes de 400**, todas del mismo ancho.
    // Por eso el ancho se guarda medido y no se deriva de `ANCHOS_DE_VARIANTE`,
    // o las vistas emitirian un `width` que miente. Y por eso `fuentesDeImagen`
    // tiene que deduplicar: aqui las tres colapsan en una.
    const resultado = await normalizar(await jpeg(400, 300));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    for (const variante of resultado.imagen.variantes) {
      expect(variante.ancho).toBe(400);
      expect(variante.alto).toBe(300);
    }
  });

  it("cada variante reporta sus bytes, y la chica pesa menos que la grande", async () => {
    const resultado = await normalizar(await jpeg(3000, 2000));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const [min, , max] = resultado.imagen.variantes;
    expect(min?.bytes).toBeGreaterThan(0);
    expect(min?.bytes).toBeLessThan(max?.bytes as number);
    expect(min?.bytes).toBe(min?.cuerpo.byteLength);
  });
});

describe("AVIF", () => {
  it("entra y sale como WebP, igual que los demas", async () => {
    // **Se agrego despues, y por un reporte de campo:** un operador subio un
    // `.avif` dentro de una tanda y se la rechazo entera. No era una limitacion
    // tecnica —libvips lo decodifica— sino que nadie lo habia pedido.
    const resultado = await normalizar(await avif(900, 600), "image/avif");

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.imagen.variantes).toHaveLength(3);
    for (const variante of resultado.imagen.variantes) {
      const meta = await sharp(Buffer.from(variante.cuerpo)).metadata();
      expect(meta.format).toBe("webp");
    }
  });

  it("se detecta como `heif`, y el mapa de formatos tiene que saberlo", async () => {
    // **La trampa.** AVIF es un contenedor HEIF con carga AV1, asi que
    // `metadata().format` devuelve `"heif"` y no `"avif"`. Con `"avif"` en
    // `FORMATO_ESPERADO`, **todos** los AVIF se rechazarian con
    // `tipo_no_coincide`, un motivo que manda a buscar el defecto al lado
    // contrario. Esta prueba fija la equivalencia.
    const resultado = await normalizar(await avif(400, 300), "image/avif");

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.imagen.formatoDetectado).toBe("heif");
  });

  it("un JPEG declarado como AVIF se sigue rechazando", async () => {
    // Que el mapa acepte `heif` para `image/avif` no afloja la comprobacion
    // para los demas formatos.
    const resultado = await normalizar(await jpeg(400, 300), "image/avif");

    expect(resultado).toEqual({ ok: false, motivo: "tipo_no_coincide" });
  });
});

describe("rechazos", () => {
  it("lo que no se puede decodificar se rechaza como tal", async () => {
    const resultado = await normalizar(Buffer.from("esto no es una imagen"));

    expect(resultado).toEqual({ ok: false, motivo: "no_decodificable" });
  });

  it("un PNG declarado como JPEG se rechaza en vez de aceptarse a la callada", async () => {
    // El `contentType` lo declara el navegador. Recodificar funcionaria igual,
    // pero la discrepancia es senal de que algo esta mal en el camino y callarla
    // esconderia el defecto.
    const resultado = await normalizar(await png(500, 500), "image/jpeg");

    expect(resultado).toEqual({ ok: false, motivo: "tipo_no_coincide" });
  });

  it("un tipo fuera de la lista blanca se rechaza aunque sharp sepa leerlo", async () => {
    // sharp trae librsvg y decodifica SVG sin problema. Un SVG es un documento
    // con script, y servirlo desde el mismo origen que la aplicacion seria una
    // via de XSS: la lista blanca sigue siendo la que decide.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>',
    );

    const resultado = await normalizar(svg, "image/svg+xml");

    expect(resultado).toEqual({ ok: false, motivo: "tipo_no_coincide" });
  });

  it("una imagen con mas pixeles de los admitidos no se decodifica", async () => {
    // El tope de bytes no protege de esto: un PNG de pocos megabytes puede
    // declarar dimensiones enormes y reventar la memoria al descomprimirse.
    const ladoExcesivo = Math.ceil(Math.sqrt(MAXIMO_PIXELES_ENTRADA)) + 1000;
    const bomba = await sharp({
      create: {
        width: ladoExcesivo,
        height: ladoExcesivo,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const resultado = await normalizar(bomba, "image/png");

    expect(resultado).toEqual({ ok: false, motivo: "no_decodificable" });
  });
});
