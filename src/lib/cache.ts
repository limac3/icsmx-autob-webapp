// Etiquetas de invalidacion de cache.
//
// En un solo lugar porque una etiqueta es un acuerdo entre dos puntos lejanos
// del codigo —quien cachea y quien invalida— y basta una letra de diferencia
// para que la invalidacion no invalide nada. El fallo no se ve: la pantalla
// simplemente sigue mostrando lo viejo.

export const etiqueta = {
  /** Ficha de un vehiculo, con su galeria. */
  vehiculo: (vehiculoId: string): string => `vehiculo:${vehiculoId}`,

  /** Catalogo administrativo completo (PA-03). */
  catalogoVehiculos: "vehiculos",

  /** Convocatoria con sus lotes. */
  convocatoria: (convocatoriaId: string): string =>
    `convocatoria:${convocatoriaId}`,

  /** Listados de convocatorias: la bandeja del administrador y la del aprobador. */
  catalogoConvocatorias: "convocatorias",

  /**
   * Lo que ve un participante. Se separa del listado administrativo porque
   * cambia por razones distintas: publicar y concluir la mueven, pero editar un
   * borrador no, y no tendria sentido tirar la cache de quien compra cada vez
   * que alguien corrige una descripcion.
   */
  convocatoriasVisibles: "convocatorias:visibles",

  /** Lote y su fila. */
  lote: (loteId: string): string => `lote:${loteId}`,
} as const;
