# AGENTS.md — Convenciones del Repositorio

Como se escribe codigo en este repositorio. Complementa `CLAUDE.md`, que fija las reglas de
negocio criticas y el flujo de trabajo; aqui estan los patrones concretos.

El contexto funcional completo esta en `agent_files/`. Empieza por
`agent_files/plan-ejecucion.md`.

---

## Comandos

```bash
npm run dev        # servidor de desarrollo, puerto 3000
npm run format     # Prettier. Ejecutar antes de verify si hubo cambios
npm run typecheck  # tsc --noEmit
npm run test       # Vitest
npm run lint       # ESLint + Stylelint
npm run verify:rapido  # compuerta completa sin el chequeo de desactualizados (~50 s)
npm run prototipo:fila # prototipo concurrente de la fila contra el sandbox (R18, ~2 min)
npm run carga:apertura # prueba de carga de la apertura de una convocatoria (Etapa 12, sandbox)
npm run verify     # lo anterior + chequeo de paquetes desactualizados (~2.5 min)
npm run build      # build de produccion
npx ampx sandbox   # backend Amplify Gen2 personal
```

`typecheck` → `verify` → `build`. Los tres en verde antes de dar por terminada cualquier tarea.

### Requisitos previos

- **Node 24.**
- **`NODE_AUTH_TOKEN`** exportado. Los paquetes `@churchofjesuschrist/*` vienen del Artifactory
  privado declarado en `.npmrc`.
- **`NODE_EXTRA_CA_CERTS`** en maquinas con inspeccion TLS corporativa. Ver seccion 1 de
  `agent_files/desafios-implementacion.md`.

---

## Estructura

```
amplify/                    Backend Gen2: defineBackend y constructos CDK
agent_files/                Documentacion de contexto
src/
  app/
    <ruta>/page.tsx         Server Component
    actions/<area>.ts       Server Actions
    api/<ruta>/route.ts     Route Handlers (solo los tres permitidos)
  components/               Componentes planos: .tsx + .css + .test.tsx colocados
  dictionaries/             es.json, en.json, index.ts
  lib/
    auth/                   Sesion, EAS, permisos
    data/                   Cliente DynamoDB, claves, transacciones
    domain/                 Reglas puras, sin I/O
    media/                  S3 y firma de CloudFront
    <feature>/              Un archivo por operacion
  types/                    Tipos compartidos por dominio
  proxy.ts                  Middleware (Next.js 16 lo renombro)
```

### Nombres

| Elemento | Convencion | Ejemplo |
| --- | --- | --- |
| Componentes | `PascalCase.tsx` | `FilaEstado.tsx` |
| Utilidades y servicios | `camelCase.ts` | `solicitarCompra.ts` |
| Tipos compartidos | `src/types/<dominio>.ts` | `src/types/fila.ts` |
| Tests | junto al archivo | `solicitarCompra.test.ts` |
| Estilos | junto al componente | `FilaEstado.css` |

**Un archivo por operacion.** `crearVehiculo.ts`, `editarVehiculo.ts` — no un
`vehiculosService.ts` con quince metodos.

**El dominio se nombra en espanol** (`solicitarCompra`, `EN_FILA`, `convocatoria:aprobar`); las
APIs de framework y librerias siguen en ingles.

**Los acentos: en los diccionarios si, en el codigo no.** Identificadores, comentarios, mensajes
de commit y los documentos de `agent_files/` van sin acentos, para que ninguna herramienta tenga
que adivinar la codificacion. Los **valores** de `src/dictionaries/*.json` son la excepcion: son
el texto que lee el usuario y se escriben con la ortografia correcta del idioma. Sus **claves**
siguen siendo identificadores y van sin acento. El riesgo real no es teclear mal, es copiar una
frase de un documento a una etiqueta; hay una prueba en `diccionarios.test.ts` que vigila las
palabras del dominio en las que eso ya paso.

---

## Importaciones

```ts
import Componente from "@/components/Componente";
```

`@/*` → `src/*`. Configurado en `tsconfig.json` y **duplicado en `vitest.config.mts`** — si
falta ahi, los tests no resuelven el alias.

---

## Patrones

### Server Action

Delgada: sesion, permiso, delegacion, invalidacion. **Sin logica de negocio ni acceso a datos.**

```ts
"use server";

export const solicitarCompra = async (input: Entrada) => {
  const ctx = await exigirPermiso("solicitud:crear", { loteId: input.loteId });
  if (ctx.error) return { ok: false as const, error: ctx.error };

  const resultado = await solicitarCompraServicio({
    loteId: input.loteId,
    participanteId: ctx.sesion.participanteId,
  });

  if (resultado.ok) revalidateTag(`lote:${input.loteId}`);
  return resultado;
};
```

**El actor sale de la sesion, nunca del input.** Aceptar un `participanteId` como parametro
permitiria actuar en nombre de otro.

### Servicio

```ts
import "server-only";

export const solicitarCompra = async (input: Entrada, deps: Deps = {}) => {
  const cliente = deps.cliente ?? clienteDynamo;
  const ahora = deps.ahora ?? (() => new Date());

  const errores = validar(input);
  if (Object.keys(errores).length) {
    return { ok: false as const, error: "validation_failed" as const, detalles: errores };
  }
  // ...
  return { ok: true as const, data: { ... } };
};

export const __test__ = { helperPrivado };
```

- `import "server-only"` en todo modulo que toque datos o secretos.
- Dependencias inyectables por `deps` — `ahora` incluido, para probar fronteras de tiempo.
- **Nunca lanza.** Devuelve `{ ok, data }` o `{ ok, error }`.
- `ProjectionExpression` explicito: nunca devolver el item completo.
- `export const __test__` para exponer helpers privados a los tests.

### Server Component

```ts
const sesion = await getSession();
if (!sesion) redirect("/auth/login");

const resultado = await listarConvocatoriasVisibles(
  sesion.tiposDeConvocatoriaPermitidos,
);
if (!resultado.ok) throw new Error(resultado.error);
```

Server Components por defecto. `"use client"` solo para hooks, estado o eventos de navegador, y
**en el componente mas pequeno posible**.

Nunca se pasa el objeto `Sesion` completo a un componente cliente.

---

## Tests

Colocados junto al codigo. Nunca en `__tests__/`.

### Componente

```tsx
import { genericTests, getTestContext } from "@/utils/testHelpers";
import FilaEstado from "./FilaEstado";

const context = getTestContext();
genericTests(context, FilaEstado, { miTurno: 3, miPosicion: 2, tamanoFila: 7 });
```

`genericTests` cubre render sin fallo y `axe` sin violaciones. Se agregan casos especificos
aparte.

### Servicio

```ts
// @vitest-environment node
vi.mock("server-only", () => ({}));
import { describe, expect, it, vi } from "vitest";
```

Los `vi.mock` van **antes** de los imports: se elevan.

### Obligatorios

- Reglas puras de `src/lib/domain/`, con fronteras de tiempo.
- Casos **allow y deny** de cada permiso, mas las invariantes de `permission-matrix.md`
  seccion 9 — incluida la 8: quitar un campo a la vez del contexto minimo debe denegar.
- **Concurrencia** en todo cambio al motor de fila: N solicitudes en paralelo, turnos unicos y
  estrictamente crecientes, una sola adjudicacion. Se ejecuta **varias veces** — una carrera que
  pasa una vez no prueba nada.
- Que ninguna proyeccion al cliente contenga identidad de terceros.
- Test de regresion por cada defecto corregido.

---

## Reglas que no se negocian

Detalle en `CLAUDE.md`. Resumen operativo:

1. El orden de la fila lo asigna el servidor con un contador atomico. **Jamas ordenar por
   timestamp.**
2. Toda mutacion de solicitud escribe su evento de auditoria **en la misma transaccion**.
3. Los items `AUDIT#` son append-only. Nunca `UpdateItem` ni `DeleteItem`.
4. La adjudicacion se gana con escritura condicional, nunca con lectura previa.
5. Ninguna proyeccion al cliente expone identidad de terceros.
6. Gating de convocatoria en servidor, siempre triple.
7. Fechas en ISO-8601 UTC; zona de negocio `America/Mexico_City`.
8. Eden primero: consultar el MCP antes de crear componentes.
9. Sin ENUMs crudos en UI: todo por diccionario.
10. Sin fallback silencioso: si falla una dependencia, error explicito.

---

## Commits

Mensaje en imperativo, en espanol, explicando el **por que** cuando no sea obvio.

Antes de commit: `npm run verify:rapido` limpio y `npm run build` exitoso. `npm run verify`
completo de vez en cuando — solo agrega el aviso de paquetes desactualizados, que nunca falla
el build (ver `desafios-implementacion.md` seccion 15).

Si la tarea cambio reglas, contratos o decisiones, actualizar el documento de `agent_files/` que
corresponda **en la misma entrega** — la tabla de clasificacion esta en `CLAUDE.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
