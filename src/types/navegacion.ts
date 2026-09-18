/**
 * Un enlace del menu, ya resuelto.
 *
 * Vive aqui y no en un componente porque lo comparten los tres: el encabezado
 * lo arma (`EncabezadoAplicacion`, en el servidor, con los permisos de la
 * sesion), la barra ancha lo pinta (`NavegacionPrincipal`) y la variante
 * angosta lo despliega (`MenuDeSecciones`). **Es una etiqueta y un destino,
 * nunca un permiso**: el filtrado ocurrio antes de llegar aqui.
 */
export type EnlaceDeMenu = {
  readonly href: string;
  readonly etiqueta: string;
};
