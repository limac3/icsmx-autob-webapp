import "server-only";

// Utilidad transversal minima para el health check (regla 2 de CLAUDE.md: los
// Route Handlers solo se justifican para health check, descarga de archivos y
// callbacks de autenticacion). No consulta DynamoDB ni ninguna dependencia
// externa: un health check que dependiera de la base de datos reportaria
// caida la aplicacion cuando el problema esta en otra capa
// (arquitectura-tecnica-aws.md, seccion 7).

export type EstadoAplicacion = {
  estado: "ok";
  version: string;
  tiempo: string;
};

export const obtenerEstadoAplicacion = (): EstadoAplicacion => ({
  estado: "ok",
  version: process.env.npm_package_version ?? "0.0.0",
  tiempo: new Date().toISOString(),
});
