import "server-only";

// Alta de una fotografia en la galeria de un vehiculo.

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { esTipoDeImagen, LIMITES } from "@/lib/domain/vehiculos";
import {
  borrarObjetos,
  CACHE_DE_FOTOGRAFIA,
  claveDeFotografia,
  guardarObjeto,
  MAXIMO_BYTES_FOTOGRAFIA,
  type DepsDeAlmacenamiento,
} from "@/lib/media/almacenamiento";
import {
  CONTENT_TYPE_DE_VARIANTE,
  normalizarImagen,
  type Normalizador,
  type VarianteNormalizada,
} from "@/lib/media/normalizarImagen";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { Fotografia, VehiculoConFotografias } from "@/types/vehiculo";
import { resolver, type ActorUsuario, type DepsDeVehiculos } from "./deps";

/**
 * Tope de fotografias por vehiculo.
 *
 * Derivado del dominio y no escrito aqui otra vez: este modulo es `server-only`
 * y la pantalla necesita el mismo numero para avisar antes de empezar una tanda
 * de subida multiple.
 */
export const MAXIMO_FOTOGRAFIAS = LIMITES.fotografiasPorVehiculo;

export type EntradaAgregarFotografia = {
  /** El vehiculo con su galeria, tal como se leyo para decidir el permiso. */
  actual: VehiculoConFotografias;
  archivo: { bytes: Uint8Array; contentType: string };
  esPrincipal?: boolean;
  descripcion?: string;
  actor: ActorUsuario;
};

/**
 * `cliente` es el de DynamoDB y `s3` el de S3.
 *
 * Se nombran distinto en vez de heredar dos veces un campo `cliente`: dos
 * dependencias con el mismo nombre y tipos incompatibles es justo la clase de
 * confusion que un dia inyecta el cliente equivocado.
 */
export type DepsAgregarFotografia = DepsDeVehiculos & {
  s3?: DepsDeAlmacenamiento["cliente"];
  /**
   * El normalizador de imagenes, inyectable.
   *
   * **No es un adorno de pureza: sin esto las pruebas de este servicio se
   * vuelven pruebas de sharp.** Su fixture es un `Uint8Array` de cuatro bytes
   * —la firma de un PNG—, que no es una imagen decodificable, y lo que este
   * archivo prueba es la transaccion, el orden de los items, la principal y la
   * compensacion. El pipeline real se prueba aparte, en
   * `normalizarImagen.test.ts`, con imagenes de verdad.
   */
  normalizar?: Normalizador;
};

export const agregarFotografia = async (
  entrada: EntradaAgregarFotografia,
  deps: DepsAgregarFotografia = {},
): Promise<Resultado<{ fotoId: string }>> => {
  const { cliente, ahora, nuevoId } = resolver(deps);
  const normalizar = deps.normalizar ?? normalizarImagen;
  const { actual, archivo } = entrada;

  if (!esTipoDeImagen(archivo.contentType)) {
    return fallo("validation_failed", { archivo: "tipo_no_admitido" });
  }
  if (archivo.bytes.byteLength === 0) {
    return fallo("validation_failed", { archivo: "vacio" });
  }
  if (archivo.bytes.byteLength > MAXIMO_BYTES_FOTOGRAFIA) {
    return fallo("validation_failed", { archivo: "muy_grande" });
  }
  if (actual.fotografias.length >= MAXIMO_FOTOGRAFIAS) {
    return fallo("validation_failed", { fotografias: "demasiadas" });
  }
  const descripcion = entrada.descripcion?.trim();
  if (descripcion && descripcion.length > LIMITES.descripcionFotografia) {
    return fallo("validation_failed", { descripcion: "muy_largo" });
  }

  // **Normalizar antes de tocar S3.** El fallo mas probable de todo este camino
  // es que el archivo no sea una imagen utilizable, y ocurriendo aqui no hay
  // nada que compensar: todavia no se escribio ningun objeto. Es la misma
  // logica que ya ordena las guardas de arriba, un paso mas alla.
  const normalizada = await normalizar({
    bytes: archivo.bytes,
    contentType: archivo.contentType,
  });
  if (!normalizada.ok) {
    return fallo("validation_failed", { archivo: normalizada.motivo });
  }

  const fotoId = nuevoId();

  /**
   * Las variantes con su clave de S3, y **cuales hay que subir de verdad**.
   *
   * `withoutEnlargement` hace que el ancho de salida sea `min(tope, ancho del
   * original)`. Como los topes son distintos entre si, dos variantes solo
   * pueden coincidir en ancho si **ninguna de las dos redimensiono nada**: son
   * el original intacto, codificado dos veces con la misma calidad, o sea el
   * mismo archivo byte a byte. Coincidir en ancho aqui no es parecerse, es ser
   * el mismo objeto — y por eso basta comparar el ancho.
   *
   * No es un caso raro: una fotografia que paso por mensajeria llega en 1280 px
   * o menos, y entonces `med` y `max` son la misma imagen. Subir las dos gastaba
   * el doble de almacenamiento —en un bucket versionado y sin reglas de ciclo de
   * vida— por un objeto que nadie llega a descargar dos veces, porque
   * `fuentesDeImagen` deduplica por ancho antes de emitir el `srcSet`.
   *
   * Se apuntan las dos entradas al **mismo** objeto en vez de omitir la
   * variante: `variantes` es un Record completo a proposito, para que no se
   * pueda representar "tengo min y max pero no med", y las vistas siguen
   * leyendo las tres sin saber nada de esto.
   */
  const variantesConClave: (VarianteNormalizada & { claveS3: string })[] = [];
  const porSubir: (VarianteNormalizada & { claveS3: string })[] = [];
  for (const variante of normalizada.imagen.variantes) {
    const gemela = variantesConClave.find(
      (otra) => otra.ancho === variante.ancho,
    );
    const conClave = {
      ...variante,
      claveS3:
        gemela?.claveS3 ??
        claveDeFotografia(actual.vehiculoId, fotoId, variante.nombre),
    };
    variantesConClave.push(conClave);
    if (!gemela) porSubir.push(conClave);
  }

  // `claveS3` del item sigue siendo una sola, y es la mayor: lo que firma,
  // borra y audita el resto del codigo no tiene que saber de variantes.
  const mayor = variantesConClave.at(-1);
  if (!mayor) {
    // Inalcanzable: `normalizarImagen` devuelve las tres o un fallo. Se
    // comprueba porque el tipo lo permite y un `!` aqui seria una promesa que
    // nadie vuelve a revisar.
    return fallo("validation_failed", { archivo: "no_decodificable" });
  }

  const variantes = Object.fromEntries(
    variantesConClave.map((variante) => [
      variante.nombre,
      {
        claveS3: variante.claveS3,
        ancho: variante.ancho,
        alto: variante.alto,
        bytes: variante.bytes,
      },
    ]),
  ) as Fotografia["variantes"];

  // La primera fotografia es la principal aunque nadie lo pida: un vehiculo con
  // galeria y sin principal no se puede representar en el listado, y dejar esa
  // decision para despues produce tarjetas sin imagen.
  const seraPrincipal =
    entrada.esPrincipal === true || actual.fotografias.length === 0;

  // El orden es de presentacion, no una garantia: dos subidas simultaneas
  // pueden reclamar el mismo numero y quedar empatadas —el `fotoId` desempata
  // la clave, asi que no se pierde ninguna— y `reordenarFotografias` lo
  // resuelve. No confundir con el turno de la fila, donde el orden **es** la
  // regla y por eso viene de un contador atomico.
  const orden =
    actual.fotografias.reduce((mayor, foto) => Math.max(mayor, foto.orden), 0) +
    1;

  const momento = ahora.toISOString();

  // S3 primero, DynamoDB despues. El criterio es no dejar nunca una
  // **referencia colgante**: al reves, un fallo de S3 dejaria un item de
  // fotografia apuntando a un objeto inexistente y la galeria mostraria una
  // imagen rota. Un objeto huerfano en S3 es invisible —nadie firmara jamas su
  // URL— y ademas se compensa abajo.
  //
  // **En serie y acumulando lo ya escrito.** En paralelo, un fallo de la segunda
  // subida deja las otras en vuelo y no se sabe que compensar sin esperarlas
  // igual. Y la lista de claves a borrar se acumula en vez de derivarse de
  // `variantes`: derivarla mandaria borrados de objetos que nunca se escribieron
  // —correcto, porque borrar lo que no existe es exito en S3, pero oscurece la
  // intencion y multiplica las llamadas del camino de error.
  const escritas: string[] = [];
  for (const variante of porSubir) {
    try {
      await guardarObjeto(
        {
          clave: variante.claveS3,
          cuerpo: variante.cuerpo,
          contentType: CONTENT_TYPE_DE_VARIANTE,
          cacheControl: CACHE_DE_FOTOGRAFIA,
        },
        { cliente: deps.s3 },
      );
      escritas.push(variante.claveS3);
    } catch {
      await borrarObjetos(escritas, { cliente: deps.s3 });
      return fallo("dependencia_no_disponible");
    }
  }

  const items: ItemDeTransaccion[] = [
    {
      item: {
        Put: {
          TableName: nombreDeTabla(),
          Item: {
            ...clave.fotografia(actual.vehiculoId, orden, fotoId),
            fotoId,
            vehiculoId: actual.vehiculoId,
            orden,
            claveS3: mayor.claveS3,
            contentType: CONTENT_TYPE_DE_VARIANTE,
            bytes: mayor.bytes,
            variantes,
            descripcion,
            subidaEn: momento,
            subidaPor: entrada.actor.id,
          },
          ConditionExpression: "attribute_not_exists(SK)",
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: `fotografia ${fotoId}`,
    },
    {
      item: {
        Update: {
          TableName: nombreDeTabla(),
          Key: clave.vehiculo(actual.vehiculoId),
          // Identificador y clave **siempre juntos**: si divergieran, el
          // listado de la pantalla 4.1 mostraria la miniatura de una
          // fotografia que ya no es la principal.
          UpdateExpression: seraPrincipal
            ? "SET #principal = :fotoId, #principalClave = :claveMin," +
              " #actualizadoEn = :momento, #actualizadoPor = :actor"
            : "SET #actualizadoEn = :momento, #actualizadoPor = :actor",
          ConditionExpression:
            "attribute_exists(PK) AND #estatus = :estatusEsperado",
          ExpressionAttributeNames: {
            "#estatus": "estatus",
            "#actualizadoEn": "actualizadoEn",
            "#actualizadoPor": "actualizadoPor",
            ...(seraPrincipal
              ? {
                  "#principal": "fotografiaPrincipalId",
                  "#principalClave": "fotografiaPrincipalClave",
                }
              : {}),
          },
          ExpressionAttributeValues: {
            ":estatusEsperado": actual.estatus,
            ":momento": momento,
            ":actor": entrada.actor.id,
            ...(seraPrincipal
              ? { ":fotoId": fotoId, ":claveMin": variantes.min.claveS3 }
              : {}),
          },
        },
      },
      siFalla: "invalid_state",
      descripcion: `vehiculo ${actual.vehiculoId} en ${actual.estatus}`,
    },
    eventoParaTransaccion({
      tipo: "VEHICULO_FOTOGRAFIA_AGREGADA",
      agregado: "VEHICULO",
      agregadoId: actual.vehiculoId,
      actor: entrada.actor,
      ocurridoEn: ahora,
      correlacionId: nuevaCorrelacion(ahora),
      vehiculoId: actual.vehiculoId,
      datos: {
        fotoId,
        orden,
        esPrincipal: seraPrincipal,
        claveS3: mayor.claveS3,
        // Todas las claves escritas, no solo la principal: si el borrado de S3
        // fallara alguna vez, la bitacora es lo unico que dice que objetos
        // habia que borrar. Son tres, o dos cuando el original era chico y dos
        // variantes comparten objeto.
        clavesDeVariantes: escritas,
        formatoDeOrigen: normalizada.imagen.formatoDetectado,
      },
    }),
  ];

  const resultado = await ejecutarTransaccion(items, { cliente });

  if (!resultado.ok) {
    // Compensacion de mejor esfuerzo. Si tambien falla, quedan objetos
    // inalcanzables en un bucket versionado, que es el peor caso aceptable.
    await borrarObjetos(escritas, { cliente: deps.s3 });
    return fallo(resultado.error);
  }

  return exito({ fotoId });
};
