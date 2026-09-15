#!/usr/bin/env node
// Carga .claude/adr.md en el ADR del grafo de codebase-memory-mcp, o verifica que
// lo que el grafo tiene sea byte a byte identico al archivo.
//
// Por que existe: `index_repository` borra el ADR del grafo, asi que hay que
// recargarlo despues de cada reindexado (CLAUDE.md, paso 3). Pasarlo por el
// contexto del agente cuesta ~40 000 tokens y puede corromperlo en silencio al
// transcribir 900 lineas de prosa acentuada. El servidor MCP es un proceso
// **stdio local**, asi que se le habla por JSON-RPC con el contenido leido del
// disco: exacto por construccion. Ver desafios-implementacion.md seccion 63.
//
//   node scripts/adr-grafo.mjs              # sube el archivo al grafo
//   node scripts/adr-grafo.mjs --verificar   # compara el grafo contra el archivo
//   node scripts/adr-grafo.mjs --secciones   # lista las secciones almacenadas

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");
const ARCHIVO = resolve(RAIZ, ".claude/adr.md");
const PROYECTO = "C-apps-node-icsmx-autob-webapp";
const EJECUTABLE = resolve(homedir(), ".local/bin/codebase-memory-mcp.exe");

/**
 * Habla JSON-RPC con el servidor stdio: saludo, una llamada y cierre.
 * Se espera el `initialize` antes de enviar nada mas porque el servidor no
 * acepta `tools/call` sin la sesion establecida.
 */
async function llamar(nombre, argumentos) {
  const proceso = spawn(EJECUTABLE, [], { stdio: ["pipe", "pipe", "pipe"] });

  let pendiente = "";
  const respuestas = new Map();
  const esperando = new Map();

  proceso.stdout.setEncoding("utf8");
  proceso.stdout.on("data", (trozo) => {
    pendiente += trozo;
    let corte;
    while ((corte = pendiente.indexOf("\n")) !== -1) {
      const linea = pendiente.slice(0, corte).trim();
      pendiente = pendiente.slice(corte + 1);
      if (!linea) continue;
      let mensaje;
      try {
        mensaje = JSON.parse(linea);
      } catch {
        continue; // el servidor tambien escribe diagnostico suelto
      }
      if (mensaje.id === undefined) continue;
      const resolver = esperando.get(mensaje.id);
      if (resolver) {
        esperando.delete(mensaje.id);
        resolver(mensaje);
      } else {
        respuestas.set(mensaje.id, mensaje);
      }
    }
  });

  let errores = "";
  proceso.stderr.setEncoding("utf8");
  proceso.stderr.on("data", (trozo) => (errores += trozo));

  const enviar = (mensaje) =>
    proceso.stdin.write(JSON.stringify(mensaje) + "\n");

  const pedir = (id, metodo, params) => {
    const ya = respuestas.get(id);
    if (ya) {
      respuestas.delete(id);
      return Promise.resolve(ya);
    }
    const llegada = new Promise((resolver) => esperando.set(id, resolver));
    enviar({ jsonrpc: "2.0", id, method: metodo, params });
    return llegada;
  };

  const fin = new Promise((_, rechazar) =>
    proceso.on("exit", (codigo) => {
      if (codigo !== 0)
        rechazar(new Error(`el servidor salio con ${codigo}: ${errores}`));
    }),
  );

  try {
    await Promise.race([
      pedir(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "adr-grafo", version: "1.0.0" },
      }),
      fin,
    ]);
    enviar({ jsonrpc: "2.0", method: "notifications/initialized" });

    const respuesta = await Promise.race([
      pedir(2, "tools/call", { name: nombre, arguments: argumentos }),
      fin,
    ]);
    if (respuesta.error) throw new Error(JSON.stringify(respuesta.error));
    return (respuesta.result?.content ?? [])
      .map((parte) => parte.text ?? "")
      .join("");
  } finally {
    proceso.stdin.end();
    proceso.kill();
  }
}

const contenido = readFileSync(ARCHIVO, "utf8");
const bytes = Buffer.byteLength(contenido, "utf8");

if (process.argv.includes("--secciones")) {
  console.log(
    await llamar("manage_adr", { project: PROYECTO, mode: "sections" }),
  );
} else if (process.argv.includes("--verificar")) {
  // `mode: "get"` devuelve un envoltorio JSON `{"content": "..."}` con los saltos
  // de linea escapados, no el markdown crudo: hay que desenvolverlo antes de
  // comparar, o la diferencia aparente son los ~900 bytes del escapado.
  const respuesta = await llamar("manage_adr", {
    project: PROYECTO,
    mode: "get",
  });
  const enElGrafo = JSON.parse(respuesta).content ?? "";
  const iguales = enElGrafo === contenido;
  console.log(
    `archivo: ${bytes} bytes · grafo: ${Buffer.byteLength(enElGrafo, "utf8")} bytes`,
  );
  console.log(iguales ? "identico" : "DIFIERE — recargar");
  if (!iguales) process.exitCode = 1;
} else {
  const salida = await llamar("manage_adr", {
    project: PROYECTO,
    mode: "update",
    content: contenido,
  });
  console.log(`subidos ${bytes} bytes desde .claude/adr.md`);
  console.log(salida.slice(0, 600));
}
