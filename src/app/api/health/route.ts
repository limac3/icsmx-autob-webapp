import { NextResponse } from "next/server";
import { obtenerEstadoAplicacion } from "@/lib/estadoAplicacion";

// Route Handler (una de las tres excepciones a la regla 2 de CLAUDE.md).
// Sin autenticacion y sin tocar DynamoDB: un health check que dependiera de
// la base de datos reportaria caida la aplicacion cuando el problema esta en
// otra capa (agent_files/api-contracts.md, seccion 7).
export const GET = () => NextResponse.json(obtenerEstadoAplicacion());
