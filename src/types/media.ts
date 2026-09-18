// Tipos de presentacion de imagen, compartidos entre el servidor que los
// produce y los componentes que los pintan.
//
// **Viven aqui y no junto a `fuentesDeImagen`** porque ese modulo es
// `server-only` —firma con la llave privada de CloudFront— y uno de los
// consumidores, `GaleriaVehiculo`, es un componente de cliente. Un `import
// type` se borra al compilar y no arrastraria nada, pero deja puesta la trampa:
// basta que alguien convierta ese import en uno de valor para meter la firma en
// el navegador. Con el tipo aparte, esa linea no existe.

/** Lo que un `<img>` necesita para pedir la variante que le toca. */
export type FuentesDeImagen = {
  /**
   * La variante **mas chica** de las incluidas.
   *
   * Es lo que usa un navegador que ignora `srcSet`, y tambien lo que
   * `MediaThumbnailGallery` de Eden toma si su propia seleccion falla. Que sea
   * la mas chica hace que el peor caso sea una imagen algo blanda, nunca una
   * descarga de mas.
   */
  src: string;
  /**
   * Candidatas con su descriptor `w`, ascendente.
   *
   * **Ausente cuando queda una sola.** No es una simplificacion: con una unica
   * candidata, `getThumbnailImage` de `eden-media-thumbnail-gallery` devuelve
   * `{ src, size }` **sin `alt`**, `eden-image` marca la imagen como
   * `role="presentation"` y el boton que la envuelve se queda sin nombre
   * accesible — violacion `button-name` de axe. Y el caso ocurre de verdad: la
   * normalizacion no agranda, asi que un original de 400 px produce tres
   * variantes de 400 px que colapsan en una.
   */
  srcSet?: string;
  /** De la variante mas grande incluida, para el ratio intrinseco. */
  ancho: number;
  alto: number;
};
