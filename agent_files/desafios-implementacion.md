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

## 12) `ampx` ejecuta `backend.ts` con el *type stripping* de Node, no con un bundler

### Problema
La documentacion de Amplify Gen2 escribe las importaciones de `backend.ts` sin extension
(`import { auth } from "./auth/resource"`), y `amplify/tsconfig.json` usa
`moduleResolution: "bundler"`, que las acepta. El proyecto se escribio asi.

### Sintoma
`npx ampx sandbox` pasa la sintesis y el chequeo de tipos, y **despues** falla:

```
✔ Backend synthesized in 0.62 seconds
✔ Type checks completed in 12.98 seconds
[ERROR] [BackendBuildError] Unable to deploy due to CDK Assembly Error
  ∟ Caused by: [AssemblyError] Assembly builder failed
    ∟ Caused by: [Error] Cannot find module '...amplifyalmacenamiento'
      imported from ...amplifyackend.ts
```

Lo confuso es el orden: los dos pasos que uno esperaria que detectaran un import roto —la
sintesis y el `tsc`— pasan en verde.

### Causa raiz
Son dos resolvedores distintos sobre el mismo archivo. `tsc` usa `moduleResolution: "bundler"`
y completa la extension; el paso de ensamblado de CDK **ejecuta** `backend.ts` con el
*type stripping* nativo de **Node 24**, cuyo resolvedor ESM exige la ruta literal en disco.

Ese resolvedor hace **dos** cosas que sorprenden, y hay que entender las dos:

1. No completa extensiones — `"./almacenamiento"` no encuentra nada.
2. **Tampoco mapea `.js` a `.ts`.** Esto es lo contraintuitivo, porque `.js` es la convencion
   de ESM en TypeScript y funciona con `tsc`, con `tsx` y con los bundlers. Aqui no: el
   archivo en disco se llama `almacenamiento.ts` y hay que nombrarlo asi.

**El primer intento de arreglo fue poner `.js` y fue incorrecto.** Cambio el mensaje de
`Cannot find module '...almacenamiento'` a `Cannot find module '...almacenamiento.js'` — mismo
fallo, ruta distinta. Peor aun, la verificacion con `npx tsx amplify/backend.ts` **paso en
verde**, porque `tsx` si hace el mapeo `.js` → `.ts`. Reproducir con la herramienta
equivocada confirmo un arreglo que no funcionaba.

### Solucion aplicada
Extension `.ts` explicita y literal en `backend.ts`:

```ts
import { AlmacenamientoAutob } from "./almacenamiento.ts";
```

Y `allowImportingTsExtensions: true` en `amplify/tsconfig.json`, que TypeScript exige para
aceptarlas (solo es valido con `noEmit`, que ya estaba). Funciona con los tres: Node, `tsc` y
`vitest`.

Solo `backend.ts` lo necesita: es el unico archivo de `amplify/` con importaciones relativas.

### Regla para futuro
Reproducir con **la misma herramienta que falla**, no con una parecida. Aqui el comando
correcto es `node amplify/backend.ts` —Node pelado, que es lo que `ampx` usa— y falla o pasa
en segundos sin desplegar nada. `npx tsx` es otro runtime con otro resolvedor, y da un falso
verde.

Corolario: `npm run typecheck` en verde **no prueba que un import se resuelva en ejecucion**
cuando el tsconfig usa `bundler` y el runtime es Node ESM. Son dos resolvedores que pueden
discrepar, y aqui discrepan.

---

## 13) Se asumio que EAS entregaba roles; entrega permisos

### Problema

La Etapa 2 construyo la autorizacion como RBAC: `puedeEjecutar({ accion, roles, contexto })`, un
catalogo `accion → roles permitidos` y una `permission-matrix.md` con seis columnas de rol. Se
esperaba que `getSession()` obtuviera de EAS la lista de roles del usuario.

### Sintoma

Dos defectos que en la superficie parecian independientes, encontrados por una revision externa:

1. **La union de roles concedia lo que la matriz negaba.** `puedeEjecutar` permitia si *alguno*
   de los roles del usuario estaba en la lista de la accion. Un usuario
   `["ADMINISTRADOR", "EMPLEADO"]` podia ejecutar `solicitud:crear`, contra lo que la matriz
   declaraba de forma explicita. Igual con `["AUDITOR_CUMPLIMIENTO", "OPERADOR_TESORERIA"]` y
   `pago:avalar`, contra el "sin excepcion" del documento.
2. Y no era un caso raro: `EMPLEADO` era **a la vez** permiso de compra y discriminador del
   `tipoParticipante`, asi que un administrador **necesitaba** el rol de comprador solo para poder
   *ver* una convocatoria de empleados. La combinacion no era una anomalia, era la normal.

### Causa raiz

Dos, una encima de la otra.

La superficial: `EMPLEADO`/`OTRO_USUARIO` estaban modelados como roles cuando describen un
**atributo de la persona**, no una concesion. `proyecto.md` incluso lo declaraba sin verlo como
problema: *"`EMPLEADO` y `OTRO_USUARIO` son a la vez rol y tipo de participante"*.

La de fondo, que solo aparecio al preguntarle al operador: **EAS no expone roles.** Se le pregunta
por uno o varios permisos y responde un booleano por cada uno; los roles viven dentro de EAS, que
calcula los permisos con reglas propias. El modelo entero estaba construido sobre una capacidad
que el proveedor de identidad no tiene.

Eso invalida tambien la correccion que parecia obvia. La primera propuesta fue un `deny-override`:
declarar "quien administra nunca compra" como exclusion en el codigo. Habria sido **el error
opuesto** — congelar politica organizacional en el repositorio. La regla es cierta hoy, pero puede
cambiar, y cuando cambie se cambiara en la configuracion de EAS.

### Solucion aplicada

`puedeEjecutar({ accion, permisos, contexto })`, con la responsabilidad partida en dos:

| Decide | Quien |
| --- | --- |
| **Capacidad** — "¿puede operar tesoreria?" | EAS |
| **Aplicabilidad** — "¿esta solicitud esta en `EN_VERIFICACION`?" | La aplicacion |

Las guardas contextuales se conservaron intactas: son justamente lo que EAS no puede saber. Lo que
desaparecio fue el catalogo `accion → roles`.

El tipo de convocatoria accesible pasa a salir de dos permisos —`Autob_Venta_a_empleados` y
`Autob_Venta_en_general`—, con lo que la regla "un empleado es superconjunto" deja de ser un caso
especial del codigo y pasa a ser configuracion.

`Rol` sobrevive solo en `src/lib/auth/rolesSimulados.ts`, para el modo de desarrollo, que sigue
razonando en roles porque es como piensa el equipo. Ningun otro archivo lo importa.

### Regla para futuro

**Antes de modelar autorizacion, confirmar que puede responder el proveedor de identidad.** No es
lo mismo "dame los roles de esta persona" que "¿tiene este permiso?": el segundo contrato no
permite reconstruir el primero, y toda la forma del codigo depende de cual de los dos es.

Y la regla general que dejo: **si una regla se puede expresar como "quien tiene tal permiso puede
tal cosa", no lleva codigo.** Cuando aparezca la tentacion de escribir una exclusion por rol,
significa que la decision le pertenece a la configuracion, no al repositorio.

---

## 14) Una prueba de "cerrado por omision" que no ejercia el defecto

### Problema

Varias guardas de `puedeEjecutar` fallaban abiertas: rechazaban `=== false` pero dejaban pasar
`undefined`. Como todos los campos de `Contexto` son opcionales, un dato que quien invoca olvidara
pasar se convertia en un permiso concedido. Habia siete casos, entre ellos ocultar una convocatoria
publicada **con fila viva** (R-06) y formarse dos veces en el mismo lote (R-07).

Al corregirlos se escribio la invariante que debia impedir que volvieran: recorrer el catalogo con
**contexto vacio** y exigir que toda accion con guarda denegara.

### Sintoma

La prueba pasaba en verde. Pero al revertir a proposito la correccion —volviendo `confirmado` a
`valor !== false`— **seguia pasando**. No detectaba el defecto que existia para detectar.

### Causa raiz

Con contexto vacio, las comprobaciones de estado se evaluan primero y deniegan antes de llegar a
la precondicion booleana:

```ts
if (c.estatusConvocatoria !== "BORRADOR") return denegar("invalid_state"); // deniega aqui
if (!confirmado(c.fechasCoherentes)) return denegar("invalid_state");      // nunca se llega
```

La prueba afirmaba lo correcto sobre el resultado final, pero por el camino equivocado. Un caso de
prueba que pasa por la razon equivocada es peor que no tenerla: da la señal de que el riesgo esta
cubierto.

### Solucion aplicada

Cambiar la afirmacion: partir del contexto minimo que **si** satisface la guarda y quitar **un
campo a la vez**, exigiendo que cada version incompleta deniegue. Cada campo del contexto minimo
queda demostrado como indispensable.

Se verifico por falsacion —revirtiendo `confirmado` y confirmando que la prueba falla— antes de
darla por buena.

Lleva una lista explicita de excepciones: `comprobante:descargar` con `Autob_Operar_Tesoreria` o
`Autob_Auditar` concede por capacidad sola, sin mirar el recurso. Estan declaradas una por una para
que agregar otra obligue a justificarla, en vez de debilitar la invariante.

### Regla para futuro

**Una prueba de seguridad nueva se valida rompiendo el codigo a proposito.** Si al revertir la
correccion la prueba sigue en verde, no esta probando lo que dice. Es barato —dos comandos— y es la
unica forma de distinguir una invariante real de una que solo parece exigente.

Vale tambien para el control de cobertura del catalogo: `expect(CATALOGO_ESPERADO).toHaveLength(33)`
parecia verificar que la matriz y el codigo no se separaran, pero contaba la tabla de expectativas
contra si misma. Una accion 34 en el codigo no la habria hecho fallar. Comparar contra
`Object.keys(CATALOGO_ACCIONES)` si lo hace.

---

## 15) `npm run verify` tardo 25 minutos en el chequeo de paquetes

### Problema

`npm run verify` es la compuerta previa a cada commit. Debe rondar el minuto.

### Sintoma

Una corrida tardo mas de 25 minutos. El 95% del tiempo se fue en "Check for outdated packages",
que no imprime nada hasta terminar y parece colgado.

### Causa raiz

Tres cosas sumadas, en orden de importancia:

1. **Latencia del registro en esta maquina.** El `.npmrc` apunta a Artifactory
   (`icseng.jfrog.io`). Un `npm view` de un solo paquete tarda **5 a 21 segundos**; en un
   registro sano es menos de uno. Con 21 paquetes, el piso son minutos. `npm-check-updates`
   no tiene la culpa: es el transporte.
2. **Cache frio.** La corrida lenta fue la primera despues de agregar los paquetes de AWS en
   la Etapa 3. Ya en caliente, `ncu` tarda **95 segundos**.
3. **Procesos huerfanos compitiendo.** Se habian lanzado varias corridas de `verify` y al
   detenerlas quedaron vivos los procesos hijo de `ncu`, los tres golpeando el registro a la vez.

Lo que **no** era la causa, pese a ser el sospechoso obvio: la bandera `--cooldown 1` que pasa
festack. Medido, da lo mismo — 95 s sin ella, 99 s con ella.

### Solucion aplicada

`npm run verify:rapido` — **44 segundos** medidos, contra ~2.5 minutos del completo.

`scripts/verify-rapido.mjs` invoca `npm run verify` con `CI=1` en el entorno.
`festack-scripts-verify.mjs` omite el chequeo de desactualizados cuando `CI` o `AGENT_ID` estan
definidas, y **ese chequeo nunca falla el build**: solo imprime una lista, y el propio festack lo
describe como mantenimiento *"mensual"*. Solo sale con error si `ncu` mismo revienta. Formato,
lint, pruebas y el chequeo de dependencias sin usar corren igual, asi que la compuerta no se
debilita.

Se delega en `npm run verify` en vez de invocar festack directamente para que las dos variantes
no puedan separarse. No hizo falta ninguna dependencia nueva: `cross-env` no esta en el proyecto
y `CI=1 npm run ...` no funciona en `cmd` ni en PowerShell, de ahi el script en vez de una linea
en `package.json`.

`npm run verify` completo se sigue corriendo de vez en cuando, que es justo la cadencia que
sugiere el mensaje de festack.

Antes de sospechar de la red, matar procesos `node` huerfanos: `ncu` de una corrida anterior
sigue vivo aunque se haya cerrado la terminal.

### Regla para futuro

**Nunca dejar dos `verify` corriendo a la vez**, y verificar procesos huerfanos antes de culpar
al entorno. Y al medir una lentitud, medir la hipotesis contra su alternativa —aqui, con y sin
`--cooldown`— en vez de aceptar el sospechoso obvio: habria llevado a "arreglar" una bandera que
no tenia nada que ver.
