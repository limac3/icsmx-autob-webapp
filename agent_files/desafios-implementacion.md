# Desafios de Implementacion

Bitacora de problemas resueltos y decisiones no obvias. Se registra **solo** lo que no es
deducible leyendo el codigo o el historial de git: la causa raiz, la restriccion de negocio no
evidente y la decision de diseno con sus alternativas descartadas.

Formato fijado en `CLAUDE.md`. Secciones numeradas, se agregan al final.

---

## 1) Inspeccion TLS corporativa rompe Node, npm y ampx

### Problema

`npm install`, `npx ampx sandbox` y los SDK de AWS deben poder establecer conexiones HTTPS desde
la maquina de desarrollo.

### Sintoma

`UNABLE_TO_VERIFY_LEAF_SIGNATURE` en cualquier peticion HTTPS hecha desde Node, mientras el
navegador, PowerShell y los instaladores nativos funcionan sin problema. Esa asimetria es lo que
despista: parece un problema de credenciales, de VPN o de registro privado.

### Causa raiz

CrowdStrike Falcon hace inspeccion TLS de todo el trafico HTTPS saliente y reemite los
certificados firmados por `CN=Falcon ROOT CA Proxy, O=CrowdStrike`.

Ese CA **si** esta en el almacen de Windows (`LocalMachine\Root`), por eso las aplicaciones
nativas funcionan. Pero **Node trae su propio paquete de CAs y no consulta el almacen del
sistema**, asi que rechaza el certificado reemitido.

### Solucion aplicada

Variable de entorno de usuario:

```
NODE_EXTRA_CA_CERTS = C:\Users\<usuario>\.claude\certs\falcon-ca.pem
```

El PEM se exporta desde `Cert:\LocalMachine\Root`. La variable es **aditiva**: agrega el CA al
paquete de Node sin reemplazarlo.

### Regla para futuro

Ante cualquier fallo de certificado desde Node, npm, `ampx` o los SDK de AWS en una maquina
corporativa, **verificar `NODE_EXTRA_CA_CERTS` antes de investigar red, permisos o credenciales**.
Si el CA rota, reexportar el PEM.

**Nunca usar `NODE_TLS_REJECT_UNAUTHORIZED=0`**: desactiva la verificacion TLS de todo el
proceso, incluidas las llamadas a AWS, y convierte un problema de configuracion en un agujero de
seguridad.

Aplica solo a Node. El CLI y la extension de Claude Code resuelven el CA del sistema por su
cuenta y no necesitan el ajuste.

---

## 2) El stack elegido no tiene precedente en la organizacion

### Problema

Arrancar el proyecto reutilizando lo que ya funciona en `icsmx-camp-webapp`, la aplicacion
hermana de la misma organizacion y el mismo equipo.

### Sintoma

`CLAUDE.md` y `README.md` daban por sentado un stack —Amplify Gen2, DynamoDB, TypeScript
strict— que al explorar el proyecto hermano resulto no existir en ningun lado.

### Causa raiz

La organizacion despliega con **Terraform + ECS Fargate + Azure Pipelines** y persiste en
**PostgreSQL con Prisma 7**. El proyecto hermano es **JavaScript**, con `jsconfig.json`,
`typescript.ignoreBuildErrors: true` y sin script `typecheck`.

No existe ninguna carpeta `amplify/`, ningun cliente de DynamoDB, ningun `amplify.yml` ni
`.github/workflows`. El unico uso de AWS es S3 con firma de CloudFront.

### Solucion aplicada

Se conservo el stack decidido para este proyecto —Amplify Gen2, DynamoDB y TypeScript strict—
como **decision explicita con riesgo asumido** (riesgos R1 y R9 de `plan-ejecucion.md`).

Para acotar el costo se separo lo reutilizable de lo que hay que construir:

**Reutilizable tal cual del proyecto hermano:** `.mcp.json` (Eden MCP por HTTP), `.npmrc` de
Artifactory, versiones exactas de `next` y `react`, el contrato `{ ok, data } | { ok, error }`
de las Server Actions, `getSession()`, el motor puro `canPerformAction()` —que es exactamente el
`puedeEjecutar()` de este proyecto—, los helpers de test con axe, la inyeccion de dependencias
por `deps`, y `turbopack.root`.

**Por construir desde cero:** todo lo de Amplify, todo el acceso a DynamoDB, y la configuracion
de TypeScript.

La mitigacion estructural es que la frontera esta limpia: **todo el acceso a datos pasa por
`src/lib/data/`**, asi que cambiar el IaC no toca la aplicacion.

### Regla para futuro

Antes de dar por hecho que un stack "es el de la organizacion", **verificarlo en el codigo del
proyecto hermano**, no en la documentacion. La documentacion describe intenciones; el
`package.json` describe la realidad.

Validar el acceso a Amplify en la cuenta AWS como **primera tarea de la Etapa 3**, antes de
escribir infraestructura.

---

## 3) Los turnos de la fila no pueden ser contiguos

### Problema

La regla 16 de `CLAUDE.md` exigia probar que N solicitudes concurrentes producen "turnos
contiguos". Al disenar la transaccion resulto imposible de garantizar.

### Sintoma

No hubo sintoma en ejecucion: se detecto al escribir `modelo-datos-dynamodb.md`, antes de
implementar. La secuencia `ADD` atomico → `TransactWriteItems` no tiene forma de devolver el
turno consumido si la transaccion posterior falla.

### Causa raiz

Obtener el turno exige `UpdateItem` con `ADD` y `ReturnValues`, porque **`TransactWriteItems` no
devuelve valores**. Son forzosamente dos pasos.

Si el segundo falla —tipicamente porque el participante ya estaba en la fila y el centinela de
R-07 lo rechaza— el turno ya fue consumido. `ADD` es atomico precisamente porque no se puede
deshacer: "devolver" el turno decrementando el contador crearia turnos duplicados bajo
concurrencia, que es un defecto mucho peor que un hueco.

### Solucion aplicada

Se cambio la invariante de **contiguidad** a **unicidad y orden estricto**:

- Los turnos son unicos y estrictamente crecientes.
- Los huecos son legitimos y no afectan la equidad, que depende del **orden relativo**.
- Para que sean raros, la Server Action consulta el centinela de fila antes de consumir turno y
  rechaza los duplicados evidentes. Es **optimizacion, no garantia**: la autoridad sigue siendo
  la condicion de la transaccion.
- La verificacion de integridad del auditor reporta los huecos como **informativos**.

Se actualizaron en consecuencia la regla 16 de `CLAUDE.md` y la Etapa 8 de `plan-ejecucion.md`.

### Regla para futuro

Al disenar una secuencia con contador atomico, **no prometer contiguidad**. Prometer unicidad y
orden estricto, que si son garantizables.

Y tener la explicacion preparada: los huecos son la objecion mas frecuente cuando alguien
audita una fila (runbook R-8), y sin explicacion parecen evidencia de manipulacion.

---

## 4) La regla de una adjudicacion activa no cabe en una transaccion

### Problema

R-09 exige que al ganar un lote, las demas solicitudes del participante queden congeladas.

### Sintoma

Detectado al disenar T2: congelar N solicitudes exigiria incluirlas todas en la
`TransactWriteItems`, y **su cantidad no esta acotada** — un participante puede estar en decenas
de filas. El limite es de 100 items por transaccion.

### Causa raiz

Se estaba modelando la regla como un **efecto** de la adjudicacion (congelar las demas) en lugar
de como una **precondicion** (no adjudicar a quien ya tiene una).

### Solucion aplicada

Se invirtio el planteamiento. Un item centinela `PART#<id> / ADJUDICACION_ACTIVA` se crea dentro
de la transaccion de adjudicacion con `attribute_not_exists`. Es un solo item, siempre.

La adjudicacion recorre los turnos en orden e **intenta** la transaccion con cada candidato. Si
el candidato ya tiene una adjudicacion activa, el `Put` del centinela falla, la transaccion
completa se cancela sin efectos, y el algoritmo marca esa solicitud `CONGELADA` y sigue con el
turno siguiente.

`CONGELADA` pasa a ser un estado **derivado y de presentacion** —le explica al participante por
que no avanza— mientras la garantia real la sostiene la base de datos.

Se agrego el evento `SOLICITUD_OMITIDA`: sin el, la bitacora mostraria una adjudicacion al turno
5 con los turnos 3 y 4 vivos, indistinguible de una violacion del orden.

### Regla para futuro

Cuando una regla exija modificar una cantidad **no acotada** de items en una transaccion, es
senal de que esta modelada como efecto y deberia modelarse como precondicion sobre un solo item
centinela.

Corolario para la auditoria: **toda desviacion aparente del orden necesita su propio evento
explicativo**. Un salto sin registro es indistinguible de un fraude.

---

## 5) `revalidateTag` no cubre la publicacion programada

### Problema

Las rutas de convocatoria deben mostrar el contenido en cuanto se alcanza `publicadaEn`, sin
filtrarlo antes (regla 14, riesgo R4).

### Sintoma

Detectado al disenar la politica de cache. Con invalidacion por etiquetas, publicar dispara
`revalidateTag` y **todo funciona en pruebas** — porque en pruebas se publica con
`publicadaEn` en el pasado.

### Causa raiz

Cuando `publicadaEn` esta en el futuro, **no hay ninguna accion humana en ese instante** que
dispare la invalidacion. La convocatoria cambia de invisible a visible por el paso del tiempo,
y el sistema de etiquetas solo reacciona a eventos.

### Solucion aplicada

El listado de convocatorias visibles y el detalle **no dependen solo de etiquetas**. Se usa
lectura dinamica dentro de `Suspense`, o una `cacheLife` mas corta que la precision exigida a la
hora de publicacion.

Las etiquetas se conservan para los cambios que **si** tienen accion humana asociada: publicar,
concluir, editar un vehiculo.

### Regla para futuro

Al cachear algo cuya visibilidad depende de una **fecha futura**, comprobar siempre que exista
un disparador real en ese instante. Si el cambio lo produce el paso del tiempo y no un acto,
la invalidacion por etiquetas no basta.

Probar la publicacion programada con `publicadaEn` **en el futuro**. Con fecha pasada, el
defecto es invisible.

## 6) festack-scripts deprecado y TypeScript 7 incompatible con su lint

### Problema

Instalar el toolchain de la Etapa 1 (`@churchofjesuschrist/festack-scripts`, TypeScript strict)
segun lo especificado en `CLAUDE.md`.

### Sintoma

`npm install` completo sin errores, pero con dos avisos:

```
npm warn deprecated @churchofjesuschrist/festack-scripts@27.1.0: festack-scripts is deprecated.
Migrate to the underlying tools directly. See the 27.1.0 release notes for an AI agent
migration prompt: https://github.com/ICS-Eng/festack-scripts/blob/main/CHANGELOG.md#2710-2026-09-02
npm warn deprecated eslint@9.39.5: This version is no longer supported.
```

### Causa raiz

Dos hechos independientes, descubiertos antes de escribir codigo de negocio (verificando
versiones reales via `npm view`/`npm pack`, no asumiendolas):

1. **`festack-scripts` fue deprecado por sus propios mantenedores** en la version 27.1.0
   (2026-09-02, dos dias antes de esta etapa): "ya no aporta delta real sobre las herramientas
   estandar". Sigue funcionando sin degradacion, pero no recibira mas actualizaciones.
2. **La ultima version publicada de `typescript` es la 7.0.2**, pero
   `typescript-eslint@8.69.0` (dependencia de `festack-scripts`) declara
   `peerDependency typescript: ">=4.8.4 <6.1.0"`. Instalar TypeScript 7 habria dejado el lint de
   TypeScript silenciosamente roto o en conflicto de peers. El propio changelog de
   `festack-scripts@27.0.7` confirma este mismo limite de forma independiente: "typescript 6 → 7:
   typescript-eslint@8.65.0 requires typescript@>=4.8.4 <6.1.0. Revisit once typescript-eslint
   supports TypeScript 7."

### Solucion aplicada

- **`typescript` fijado a `6.0.3` exacto** (la ultima version estable dentro del rango que acepta
  `typescript-eslint`), no a `^` ni a la ultima publicada. Registrado en el Registro de
  decisiones de `plan-ejecucion.md`.
- **Se mantiene `festack-scripts`** por decision explicita del usuario, pese a la deprecacion.
  Se documenta como riesgo R16 en `plan-ejecucion.md`, con la migracion oficial (el changelog de
  27.1.0 trae un prompt de migracion completo y validado por el equipo de la herramienta) lista
  para ejecutarse cuando se decida, idealmente pronto: hoy solo la usan 5 archivos de
  configuracion, y cada etapa que pasa sin migrar encarece ligeramente el cambio.

### Regla para futuro

**Verificar version real instalable antes de fijarla en `package.json`, nunca asumir que "la
ultima" es segura.** `npm view <paquete> version` puede devolver una version que rompe un peer
dependency de otro paquete del mismo toolchain; `npm view <paquete> peerDependencies` en las
piezas que se acoplan (aqui, `typescript-eslint`) es lo que revela el limite real.

Ante un aviso `npm warn deprecated` en una dependencia mandada por `CLAUDE.md` o `AGENTS.md`,
no seguir de largo ni migrar por cuenta propia: es una decision de alcance de proyecto y
corresponde preguntar, igual que cualquier otra desviacion de una instruccion escrita.

## 7) `Text2` de Eden reenvia `emphasized` crudo al DOM

### Problema

Usar `<Text2 emphasized>` (`@churchofjesuschrist/eden-text@11.0.5`) para resaltar el valor del
estado del servicio en `EstadoServicio.tsx`.

### Sintoma

`npm run test` fallo con `Error: Received \`true\` for a non-boolean attribute \`emphasized\`.`
festack-scripts convierte todo `console.error` de React en una excepcion durante las pruebas
(`vitest-javascript.setup.mjs`), asi que el warning de React se volvio un fallo duro en vez de
pasar inadvertido.

### Causa raiz

El tipo publicado de `Text2` (`types.d.ts`) declara `emphasized?: boolean` como prop legitima,
pero la implementacion real (`components/Text2.jsx` dentro del paquete publicado) no la
consume: hace `const { children, renderAs: RenderAs = "div", className, ...props } = props` y
esparce `...props` —incluido `emphasized`— directo sobre el elemento host (`RenderAs`). React
rechaza un booleano crudo en un atributo DOM que no reconoce. Es un desfase entre el tipo
publicado y la implementacion de esta version del paquete, no un error de uso.

### Solucion aplicada

Se dejo de pasar `emphasized` — el contenido no lo necesitaba realmente, era un adorno visual.
**No se parcheo ni se envolvio el componente**: la regla 10 de `CLAUDE.md` pide usar los
componentes Eden tal cual.

### Regla para futuro

Si una prop de un componente Eden produce un warning de React al usarla, **verificar la
implementacion real del paquete instalado** (`node_modules/@churchofjesuschrist/<paquete>/lib/cjs/components/*.js`),
no solo su `.d.ts` — el tipo publicado puede no coincidir con el runtime en una version dada.
Si la prop es prescindible para el caso de uso, omitirla es preferible a rodear el componente
con un wrapper o a silenciar el warning. Si resulta indispensable, reportarlo al equipo de Eden
en vez de trabajarlo por fuera.

---

## 8) `participanteId` no puede resolverse contra DynamoDB todavia

### Problema

`identidad-autorizacion.md` (Etapa 0) especifica que `getSession()` hace un *upsert* del
participante en DynamoDB por `oktaSub` para obtener un `participanteId` propio y estable, mas
corto que el `sub` de Okta.

### Sintoma

No hubo sintoma en ejecucion: se detecto al implementar `session.ts` en la Etapa 2. El *upsert*
exige un cliente de DynamoDB y una tabla — ambos son entregables de la Etapa 3
(infraestructura Amplify) y la Etapa 4 (`src/lib/data`), que todavia no existen. La Etapa 2
depende solo de la Etapa 1 y su objetivo declarado es "sin datos de negocio aun".

### Causa raiz

El plan secuencia identidad (Etapa 2) antes que infraestructura y capa de datos (Etapas 3-4),
pero el diseno de `getSession()` en `identidad-autorizacion.md` da por hecho que la tabla ya
existe. Es una dependencia cruzada que el propio plan crea entre etapas no adyacentes.

### Solucion aplicada

`session.ts` resuelve `participanteId` con una funcion propia,
`resolverParticipanteId(oktaSub)`, que hoy simplemente devuelve el `oktaSub` tal cual — sigue
siendo un identificador unico y estable, solo que con el formato largo de Okta en vez de un id
interno corto. Es la unica funcion que la Etapa 4 debe reemplazar por el *upsert* real; el
contrato de `getSession()` (forma de `Sesion`, `null` si no hay sesion) no cambia.

### Regla para futuro

Al implementar la Etapa 4, sustituir el cuerpo de `resolverParticipanteId` en
`src/lib/auth/session.ts` por el *upsert* contra DynamoDB. Ninguna otra parte de la Etapa 2
(permisos, proxy, pagina de sesion) debe requerir cambios: todas consumen `Sesion.participanteId`
como valor opaco.

---

## 9) `next dev` reescribe `Cache-Control` en paginas, aunque `proxy.ts` ya lo fijo

### Problema

Verificar manualmente que `src/proxy.ts` fija `Cache-Control: no-store, no-cache,
must-revalidate, proxy-revalidate, private` en toda respuesta (Etapa 2).

### Sintoma

Con `npm run dev`, `curl -I http://localhost:3000/` muestra `Cache-Control: no-cache,
must-revalidate` — **no** el valor completo que `proxy.ts` establece. `/api/health` (Route
Handler) si muestra el valor completo; solo las paginas (RSC) lo pierden.

### Causa raiz

`base-server.js` de Next.js sobrescribe `Cache-Control` en toda respuesta de pagina **cuando
`this.dev` es verdadero**, para que el navegador pueda restaurarla del cache HTTP al navegar
atras/adelante en desarrollo, sin usar `no-store` (que rompe ese caso con HMR). Es deliberado y
esta comentado en el propio codigo fuente de Next; no distingue quien fijo el header antes.

Se confirmo que **no ocurre en produccion**: con `next build && next start`, `/` devuelve el
`Cache-Control` completo que fija `proxy.ts`, identico al de `/api/health`.

### Solucion aplicada

Ninguna — no es un defecto. Se deja documentado para que una verificacion manual futura con
`npm run dev` no se lea como que `proxy.ts` fallo en fijar el header.

### Regla para futuro

Para verificar cabeceras de cache de una pagina (no de un Route Handler), probar contra
`next build && next start`, nunca contra `next dev`: el modo desarrollo altera `Cache-Control`
en toda pagina por una razon ajena a la aplicacion.

---

## 10) `ampx sandbox` exige Docker si `esbuild` no esta en la raiz

### Problema
`defineFunction` empaqueta el handler de la funcion de barrido con esbuild. CDK sabe hacerlo
localmente, sin contenedores, y esa es la ruta rapida.

### Sintoma
Al sintetizar el backend:

```
NodeJSFunctionConstructInitializationError: Failed to instantiate nodejs function construct
Caused by: Error: spawnSync docker ENOENT
```

El mensaje habla de Docker, que no es lo que falta ni lo que se pidio.

### Causa raiz
`aws-lambda-nodejs` intenta primero el empaquetado local y **solo cae a Docker si no puede
resolver `esbuild` desde la raiz del proyecto**. `esbuild` si estaba instalado, pero anidado
en `node_modules/tsx/node_modules/esbuild`: npm no lo elevo porque ninguna dependencia
directa lo pedia. La deteccion de CDK no mira ahi, concluye que no hay esbuild y recurre al
contenedor. En una maquina corporativa sin Docker Desktop, eso es un muro.

### Solucion aplicada
`esbuild` como dependencia de desarrollo directa:

```bash
npm install --save-dev esbuild@^0.25.12
```

CDK acepta cualquier `0.x` (`ESBUILD_MAJOR_VERSION = "0"`), asi que basta con que exista en la
raiz. El empaquetado pasa a ser local y `backend.test.ts` sintetiza en ~7 s.

### Regla para futuro
Un error de `spawnSync docker ENOENT` en cualquier constructo de CDK casi nunca significa que
haga falta Docker: significa que falta la herramienta local que CDK prefiere. Antes de
instalar Docker, comprobar que la herramienta este **en la raiz** con
`node -e "console.log(require('esbuild/package.json').version)"`; que aparezca en
`node_modules` de alguien mas no cuenta.

---

## 11) Amplify Hosting no forma parte de `defineBackend`

### Problema
La regla 5 exige un `Deny` de IAM sobre los items `AUDIT#` en el rol de la aplicacion. Lo
natural seria que `defineBackend` creara ese rol y lo adjuntara al SSR.

### Sintoma
No existe forma de referenciar el rol de computo de Amplify Hosting desde `amplify/backend.ts`:
Hosting es un recurso de la consola, no de la pila que `defineBackend` despliega.

### Causa raiz
Amplify Gen2 separa dos cosas que parecen una: `defineBackend` declara **recursos de backend**
(tabla, bucket, funciones), mientras que **Hosting** —el computo que ejecuta el SSR de
Next.js— se configura en la consola y se conecta al repositorio. El "SSR Compute role" es una
funcionalidad de Hosting; la pila del backend no lo conoce.

### Solucion aplicada
El rol se **crea** en la pila (`RolComputoSsr`, en `amplify/permisos.ts`) con la relacion de
confianza que Amplify exige, y su ARN se publica en las salidas del backend:

```ts
assumedBy: new ServicePrincipal("amplify.amazonaws.com")
```

Adjuntarlo sigue siendo un paso manual: **App settings > IAM roles > Compute role**. Lo que se
gana es que el `Deny` de la bitacora vive en el repositorio y no en un procedimiento de
consola que alguien puede omitir; lo unico manual es la asociacion, que ademas se puede
cambiar sin redesplegar.

En un sandbox personal el rol confia tambien en la cuenta (`AccountRootPrincipal`), para que la
prueba de integracion pueda asumirlo y ejercer **la politica real** en vez de una copia. Fuera
de sandbox esa confianza no existe, y hay una prueba que falla si aparece.

### Regla para futuro
Todo permiso que la aplicacion necesite en runtime se declara en `aplicarPermisosAutob`, no en
la consola. Esa funcion la comparten el rol de SSR y el de la funcion de barrido a proposito:
dos listas separadas se desincronizan, y la que se olvide seria justo la que deja escribir la
bitacora.

---

## 12) `ampx` no resuelve importaciones relativas sin extension

### Problema
La documentacion de Amplify Gen2 escribe las importaciones de `backend.ts` sin extension
(`import { auth } from "./auth/resource"`), y `amplify/tsconfig.json` usa
`moduleResolution: "bundler"`, que las acepta. El proyecto se escribio asi.

### Sintoma
`npx ampx sandbox` pasa la sintesis y el chequeo de tipos, y **despues** falla:

```
✔ Backend synthesized in 0.64 seconds
✔ Type checks completed in 12.89 seconds
[ERROR] [BackendBuildError] Unable to deploy due to CDK Assembly Error
  ∟ Caused by: [AssemblyError] Assembly builder failed
    ∟ Caused by: [Error] Cannot find module '...\amplify\almacenamiento'
      imported from ...\amplify\backend.ts
```

Lo confuso es el orden: los dos pasos que uno esperaria que detectaran un import roto —la
sintesis y el `tsc`— pasan en verde. TypeScript nunca se queja porque con `bundler` la
importacion es valida **para el compilador**.

### Causa raiz
Son dos resolvedores distintos sobre el mismo archivo. `tsc` usa `moduleResolution: "bundler"`
y completa la extension; el paso de ensamblado de CDK **ejecuta** `backend.ts` con el
resolvedor ESM de Node, que **no completa extensiones** y exige la ruta literal. El tsconfig
describe una realidad que el runtime no comparte.

### Solucion aplicada
Extension `.js` explicita en las importaciones relativas de `backend.ts`:

```ts
import { AlmacenamientoAutob } from "./almacenamiento.js";
```

Apunta a `.js` aunque el archivo sea `.ts`: es la convencion de ESM en TypeScript — se escribe
la ruta que existira en ejecucion, y el compilador la mapea de vuelta al `.ts`. Funciona con
los dos resolvedores a la vez, y `vitest` tambien la resuelve.

Solo `backend.ts` la necesita: es el unico archivo de `amplify/` con importaciones relativas.

### Regla para futuro
Reproducir el paso que falla en vez de confiar en la compuerta de calidad. Aqui bastaba con
`npx tsx amplify/backend.ts`, que ejecuta el archivo igual que `ampx` y falla —o pasa— en
segundos, sin desplegar nada. Que `npm run typecheck` este verde **no prueba que un import se
resuelva en ejecucion** cuando el tsconfig usa `bundler` y el runtime es Node ESM.
