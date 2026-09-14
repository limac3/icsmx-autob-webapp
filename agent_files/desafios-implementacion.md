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

---

## 16) `new Date("2026-02-30T00:00:00Z")` no es una fecha invalida: es el 2 de marzo

### Problema

`desdeIso` es la frontera de entrada de toda fecha del sistema: convierte lo que viene de
DynamoDB, de un formulario o de una URL en un instante. Debia rechazar cualquier cosa que no
fuera ISO-8601 UTC canonico, incluida una fecha de calendario que no existe.

### Sintoma

La prueba `desdeIso rechaza dia inexistente` fallo con:

```
AssertionError: expected 2026-03-02T00:00:00.000Z to be undefined
```

La implementacion validaba con una expresion regular y despues comprobaba
`Number.isNaN(instante.getTime())`. `2026-02-30T00:00:00Z` pasa las dos: coincide con el patron
y produce un `Date` perfectamente valido.

### Causa raiz

El parser de ISO-8601 de V8 **desborda el dia en silencio**. Febrero tiene 28 dias en 2026, asi
que el 30 de febrero se convierte en el 2 de marzo. El comportamiento es ademas asimetrico y por
eso engana: un mes 13 **si** produce `Invalid Date`, de modo que probar solo con meses fuera de
rango da la falsa impresion de que el parser valida el calendario.

El impacto no era teorico. `finVenta` sale de un formulario; un `2026-02-30` capturado por error
se habria persistido como 2 de marzo y habria alargado la ventana de venta dos dias, sin ningun
sintoma. Las tres fechas de una convocatoria y el `venceEn` de cada adjudicacion entran por esta
misma funcion.

### Solucion aplicada

Verificacion de ida y vuelta en vez de confiar en `NaN`: se capturan los componentes con grupos
de la expresion regular y se comprueba que el instante producido los reproduzca.

```ts
const [, anio, mes, dia, hora, minuto, segundo] = partes;
const coincide =
  instante.getUTCFullYear() === Number(anio) &&
  instante.getUTCMonth() + 1 === Number(mes) &&
  instante.getUTCDate() === Number(dia) &&
  // ... hora, minuto, segundo
```

### Regla para futuro

**Un parser que devuelve un valor valido no es un parser que valido.** Ante cualquier
conversion de texto a dato —fechas, numeros, identificadores— la comprobacion es que el
resultado vuelva a producir la entrada, no que no sea `NaN`.

Y en la tabla de casos rechazados, incluir siempre un valor que **desborda** y no solo uno
sintacticamente imposible: el 30 de febrero encontro el defecto, el mes 13 lo habria ocultado.

---

## 17) Un item compartido dentro de una transaccion no serializa: cancela

### Problema

El prototipo de R18 debia validar el mecanismo que este proyecto habia propuesto para cerrar la
carrera entre el paso 1 y el paso 2 de T1: anotar la reserva del turno **en el propio item del
lote** (`ADD contadorTurnos :uno SET reservas.#id = :ahora`) y retirarla en la transaccion del
paso 2. El argumento escrito era: "el lote ya es el punto de serializacion —el paso 1 lo escribe
de todos modos—, asi que no cuesta una escritura adicional".

### Sintoma

Con 10 solicitudes concurrentes sobre el mismo lote, **entre 5 y 9 fallaban** en el paso 2 con
`TransactionCanceledException`, motivo `TransactionConflict`. Participantes legitimos, llegados
en el instante correcto, rechazados.

La misma rafaga con la variante ingenua —sin reservas— entraba completa. La unica diferencia era
el item del lote dentro de la transaccion.

Poco despues aparecio el mismo sintoma por una segunda causa, y ahi quedo claro que no era un
detalle del mecanismo: el `ConditionCheck` sobre la convocatoria que la Etapa 2.1 agrego al paso
2 contra la publicacion parcial cancelaba **entre 5 y 7 de cada 10** solicitudes, por el mismo
motivo. Un `ConditionCheck` no escribe nada.

### Causa raiz

El argumento confundia dos mecanismos distintos de DynamoDB:

- Un `UpdateItem` suelto sobre un item caliente **espera**. El servicio lo serializa
  internamente y nadie falla; por eso el contador atomico del paso 1 nunca dio problemas.
- El mismo item dentro de una `TransactWriteItems` **falla**. Las transacciones no se encolan:
  cuando otra transaccion tiene tomado alguno de sus items, la actual se cancela entera.

Y `ConditionCheck` participa de esa deteccion **igual que una escritura**: retiene el item aunque
solo lo lea. Es contraintuitivo —un chequeo parece una lectura— y es justo lo que convierte un
item de solo lectura, compartido por todas las solicitudes de una convocatoria, en un cuello de
botella que rechaza en vez de encolar.

El agravante es el momento: la contencion es maxima exactamente en `inicioVenta`, que es cuando
la equidad de la fila importa mas.

### Solucion aplicada

**Ningun item compartido en el camino de una solicitud.** Las dos correcciones son la misma idea
aplicada dos veces:

1. La reserva pasa a ser un **item propio**, `LOTE#<loteId> / RESERVA#<reservaId>`, escrito antes
   de pedir el turno y borrado en la transaccion del paso 2. Cada intento toca claves distintas,
   asi que no hay dos transacciones que compartan item. Con 10 simultaneas entran las 10.
2. La publicacion parcial se cierra **ordenando la propagacion de T8** en vez de verificando en
   tiempo de ejecucion: al publicar se marca primero la convocatoria y despues los lotes; al
   ocultar, al reves. El estado intermedio es siempre el mas restrictivo, asi que el atributo
   desnormalizado del lote puede quedarse atras pero nunca adelantarse.

El item del lote sigue dentro de la transaccion de **adjudicacion** (T2), y ahi esta bien: es el
mutex que decide al ganador, ocurre una vez por lote y su conflicto se resuelve releyendo y
reintentando con jitter. La diferencia no es el item, es cuantos caminos pasan por el.

### Regla para futuro

**Antes de meter un item en una `TransactWriteItems`, contar cuantas transacciones concurrentes
lo tocaran.** Si la respuesta es "todas las de esta convocatoria" o "todas las de este lote", el
diseno esta rechazando usuarios, no serializandolos — y da igual que la operacion sea un
`ConditionCheck` y no una escritura.

Y la regla que hizo visible todo esto: **el prototipo tiene que implementar la variante que se
cree mala, no solo la que se cree buena.** Las tres variantes del prototipo (ingenua, reserva en
el lote, reserva por item) son lo que permitio atribuir cada fallo a una causa y no a un
presentimiento. Un prototipo de una sola variante habria "funcionado" y habria escondido las dos
correcciones.

---

## 18) `revalidateTag` de Next.js 16 no invalida: programa

### Problema

Las Server Actions de vehiculo tenian que invalidar la ficha y el catalogo al
guardar. `estrategia-aplicacion.md` seccion 5.2 y el patron de la seccion 4.1
indican `revalidateTag(...)`, que es la API que todo el mundo conoce de Next 14
y 15.

### Sintoma

`tsc` fallo con `Expected 2 arguments, but got 1`.

### Causa raiz

Next.js 16 cambio la firma a `revalidateTag(tag, profile)`, donde `profile` es
un perfil de `cacheLife` —`"max"`, `"default"`— o un objeto `{ expire }`. Y el
cambio no es solo de firma: la funcion **programa** la expiracion segun ese
perfil en vez de invalidar de inmediato. Los propios tipos del paquete lo dicen:

> For immediate expiration in Server Actions, use `updateTag` instead.

Pasar un perfil cualquiera para callar al compilador habria compilado y habria
dejado a quien edita un vehiculo viendo sus propios datos viejos al volver al
listado — un defecto que no falla, solo miente, y que ninguna prueba unitaria
detecta porque el mock registra la llamada igual.

### Solucion aplicada

`updateTag(tag)` en las acciones de mutacion, que es la que tiene semantica de
*leer lo que uno acaba de escribir*. Las etiquetas viven en `src/lib/cache.ts`
para que quien cachea y quien invalida no puedan escribirlas distinto.

`revalidateTag` sigue siendo la correcta para invalidar **desde fuera** de una
action —un webhook, un proceso programado— donde nadie espera ver el cambio en
la misma navegacion.

### Regla para futuro

En Next.js 16, dentro de una Server Action va `updateTag`; fuera de ella,
`revalidateTag` con su perfil explicito. Y ante un cambio de firma en una API de
framework, leer que cambio ademas de los argumentos: aqui el numero de
parametros era la parte menos importante.

---

## 19) El `maxLength` de Eden y el de React no se pueden usar a la vez

### Problema

Los campos de texto del formulario de vehiculo debian llevar `maxLength` con las
mismas cotas que valida el servidor (`LIMITES` de `src/lib/domain/vehiculos.ts`),
para que el navegador dejara de aceptar teclas al llegar al limite.

### Sintoma

```
error TS2322: Type '60' is not assignable to type 'undefined'.
```

Y con `String(60)`, el mismo error.

### Causa raiz

`Input` de `@churchofjesuschrist/eden-form-parts` se declara como
`React.FC<{ ... maxLength?: string ... } & React.ComponentProps<"input">>`.
React declara `maxLength?: number`. La interseccion de las dos propiedades es
`string & number`, que no admite **ningun** valor: el tipo resultante es
`undefined`. No hay valor correcto que pasar.

Afecta solo a `Input`. `TextArea` declara `maxLength?: number` y funciona.

### Solucion aplicada

Los `Input` van sin `maxLength`. El limite lo sigue aplicando el servidor, que
devuelve el motivo por campo (`muy_largo`) y la pantalla lo muestra traducido.
Lo que se pierde es la contencion en el teclado, no la validacion.

No se uso un `as never` ni un `@ts-expect-error`: silenciar el compilador aqui
seria fingir que el tipo del paquete dice algo que no dice.

### Regla para futuro

Antes de dar por hecho que una prop nativa pasa a traves de un componente de
Eden, comprobar su declaracion en `lib/es/types.d.ts`. Varios componentes
redeclaran props que tambien existen en el elemento nativo, y cuando los tipos
difieren la interseccion puede quedar inutilizable sin que nadie lo note hasta
usarla.

---

## 20) jsdom no implementa `DataTransfer`, y hacen falta dos cosas que lo usan

### Problema

La prueba de accesibilidad de `GaleriaVehiculo` —`genericTests` con axe— tenia
que renderizar el formulario de subida, que usa `FileInput` de Eden. Despues, al
agregar el arrastre a la galeria, las pruebas del reordenamiento necesitaron
`dataTransfer` en los eventos que despachan: el mismo hueco de jsdom, por dos
caminos distintos.

### Sintoma

`ReferenceError: DataTransfer is not defined`, y al definir un doble ingenuo,
`TypeError: Failed to set the 'files' property on 'HTMLInputElement': The
provided value is not of type 'FileList'`.

### Causa raiz

`FileInput` sincroniza el valor del input nativo con su estado interno asi:

```js
const dataTransfer = new DataTransfer();
if (innerValue) dataTransfer.items.add(innerValue);
ref.current.files = dataTransfer.files;
```

jsdom no implementa `DataTransfer` —es API de arrastre— pero **si** valida el
tipo al asignar `input.files`: exige un `FileList` de verdad, no un arreglo.

### Solucion aplicada

Un doble minimo en la prueba, cuyo `files` es un `FileList` autentico obtenido
del unico sitio que lo entrega sin `DataTransfer`:

```ts
const listaVacia = (() => {
  const input = document.createElement("input");
  input.type = "file";
  return input.files;
})();
```

El mismo doble crecio despues con `setData`, `effectAllowed` y `dropEffect` —lo
que escribe el arrastre— y se adjunta al evento con `Object.defineProperty`,
porque `new Event("dragstart")` no trae `dataTransfer` y React lo copia del
evento nativo por acceso directo, no por enumeracion.

Se estabiliza el entorno de prueba, no el codigo de produccion: la regla 10 dice
usar Eden tal cual, y una carencia de jsdom no es razon para sustituir un
componente.

### Regla para futuro

Cuando un componente de Eden falle en jsdom, distinguir **defecto del
componente** de **carencia del entorno**. Si es lo segundo, el doble va en la
prueba y con la forma que jsdom valida —un `FileList` de verdad, no un objeto
parecido—; un doble aproximado convierte un error claro en uno confuso dos
capas mas abajo.

---

## 21) `index_repository` borra el ADR del grafo de codigo

### Problema
Se creo un ADR espejo de `agent_files/` con `manage_adr` de `codebase-memory-mcp`, para tener
las decisiones enlazadas a los simbolos de codigo y consultables desde el grafo.

### Sintoma
Tras editar `CLAUDE.md` y reindexar el proyecto, `manage_adr(mode="sections")` devolvio `[]`.
El ADR completo habia desaparecido sin ningun error: el reindexado reporto `status: indexed` y
`adr_present: false`, que se lee como una sugerencia de crear uno, no como un aviso de borrado.

### Causa raiz
`index_repository` **reconstruye** la base del grafo en vez de actualizarla, y el ADR se
almacena dentro de esa misma base. Cualquier reindexado lo destruye, aunque el cambio que lo
motivo haya sido de codigo y no tenga relacion con la documentacion.

### Solucion aplicada
La copia versionada del ADR vive en `.claude/adr.md`; el grafo es solo el indice consultable.
El procedimiento quedo fijado en `CLAUDE.md` y recordado por el hook
`.claude/hooks/adr-doc-sync`: editar `.claude/adr.md`, luego `index_repository(mode="full")`,
y **al final** `manage_adr(mode="update")`. Invertir los dos ultimos pasos pierde el trabajo.

Segundo hallazgo del mismo episodio: `mode="fast"` no es un `full` mas rapido. Excluye
`scripts/` y `src/lib/media/` y omite las aristas de similitud —2879 aristas contra 2901—, asi
que el grafo queda mas pobre. Para este repositorio se usa siempre `full`; tarda segundos.

### Regla para futuro
Ningun dato que importe se deja unicamente dentro del grafo de `codebase-memory-mcp`: el grafo
es derivable y se reconstruye, el ADR no. Despues de cualquier `index_repository`, verificar
con `manage_adr(mode="sections")` y recargar si devuelve `[]`.

---

## 22) La llave privada de CloudFront generada en Windows llega con CRLF

### Problema

Armar `.env.local` para poder abrir las pantallas de la Etapa 5 en el navegador.
`CLOUDFRONT_PRIVATE_KEY` se guarda con los saltos escapados como `\n`, tal como
lo documenta `.env.local.example`, a partir del PEM que produjo `openssl`.

### Sintoma

`Error: error:1E08010C:DECODER routines::unsupported` al construir la llave. El
mensaje no menciona la variable, ni el archivo, ni el salto de linea: solo dice
que el decodificador no soporta lo que recibio.

### Causa raiz

`openssl` en Windows escribe el PEM con **CRLF**. Al escapar unicamente los
saltos de linea, cada linea queda terminada en un retorno de carro real seguido
de la secuencia `\n`:

```
-----BEGIN PRIVATE KEY-----\r\nMIIEvQ...
```

`normalizarLlave` deshacia solo `\n`, asi que los CR sobrevivian **dentro** del
PEM. Un PEM con CR intercalados no lo acepta el decodificador de OpenSSL.

No era un problema del archivo de origen: el mismo PEM leido directo de disco
carga sin objecion. Se rompe al pasar por el escapado, que es el unico camino
por el que la llave entra en produccion.

### Solucion aplicada

`normalizarLlave` quita los retornos de carro despues de deshacer el escapado:

```ts
const conSaltos = crudo.includes("\n") ? crudo.replaceAll("\n", "\n") : crudo;
const llave = conSaltos.replaceAll("\r", "");
```

Un PEM no lleva CR en ningun caso legitimo, asi que quitarlos no pierde nada. La
prueba arma el caso completo —PEM con CRLF, escapado, normalizado— y comprueba
que `createPrivateKey` lo acepta; falsificada quitando el `replaceAll`.

### Regla para futuro

Todo secreto multilinea que viaje por una variable de entorno se normaliza a LF
al leerlo, no al escribirlo: quien lo escribe puede ser un gestor de secretos,
una consola de AWS o un `openssl` de otro sistema operativo, y ninguno de los
tres esta bajo control de la aplicacion. Y toda normalizacion de material
criptografico se prueba llegando hasta la funcion que lo consume —aqui
`createPrivateKey`—, porque comparar cadenas no distingue un PEM valido de uno
que solo se le parece.

---

## 23) Eden compara hijos por identidad, y RSC rompe esa identidad

### Problema

Abrir `/admin/vehiculos`. La pantalla es un Server Component: filtros con
`<form method="get">` y tabla, sin estado de cliente.

### Sintoma

`500` en la peticion y en el navegador:

```
TypeError: Cannot destructure property 'handleChange' of 'useContext(...)' as it is null.
    at CatalogoVehiculos (src/app/admin/vehiculos/page.tsx:88)
```

La linea 88 era `<Option value="">`. Ninguna prueba lo habia detectado: las 968
estaban en verde, incluida la de accesibilidad de la propia pantalla.

### Causa raiz

`Select` de Eden decide si monta su desplegable propio recorriendo sus hijos y
comparando el **tipo por identidad**:

```js
if (child?.type === Option || child?.type === OptGroup) hasCustomComponents = true;
...
const hasDropdown = multiple || !!searchSlot || hasCustomComponents;
```

Cuando los hijos los crea un **Server Component**, no llegan como elementos con
`type` resuelto: llegan como referencias perezosas que React resuelve al
renderizar. La comparacion falla, `hasDropdown` queda en `false`, y los `Option`
se renderizan directamente dentro del `<select>` nativo — fuera del `Dropdown`,
que es quien provee `DropdownContext`. `useContext` devuelve el valor por
defecto, `null`, y desestructurarlo lanza.

El experimento que lo separo de otras causas: el mismo `<Select><Option/></Select>`
montado **100% en cliente**, en jsdom, funciona. La diferencia es la frontera, no
`deepMapChildren` ni la version de Eden.

Y no es un caso aislado. En los paquetes instalados hacen la misma comparacion
`Table` (`ColGroup`, `Col`, `THead`), `FieldSet` (`Hint`, `Legend`), `FormField`
(`Hint`, `Label`), `OptGroup` (`Option`) y `Fade` (`Scrollable`).

**El caso de `Table` es peor que el de `Select`, porque no falla.** `Table` arma
la lista de columnas con esa comparacion y `CardView` saca de ahi la etiqueta de
cada celda (`columns[index]?.header`). Con la lista vacia, las tarjetas de la
vista movil se renderizan **sin etiquetas**, sin error y sin aviso — justo la
vista que exige la regla 12. `TablaVehiculos` estaba asi desde la Etapa 5.

### Solucion aplicada

Dos caminos distintos, segun lo que ofrezca cada componente:

- **Filtros**: `<option>` nativo en vez del `Option` de Eden. `Select` admite
  `child.type === "option"` de forma explicita, y un `type` de cadena si
  sobrevive la serializacion. La pantalla sigue siendo Server Component y el
  formulario GET sigue funcionando sin JavaScript, que era el objetivo.
- **`TablaVehiculos`**: `"use client"`. Aqui no hay equivalente nativo —
  `ColGroup`, `Col` y `THead` solo se reconocen por identidad—, asi que padre e
  hijos tienen que vivir en el mismo grafo de cliente. No cambia el HTML que se
  sirve; el componente no tiene estado ni eventos.

La invariante vive en `src/components/fronteraRsc.test.ts`: recorre el codigo
fuente y exige `"use client"` en todo archivo que importe uno de esos simbolos.
Mira el **fuente** y no el render, porque en jsdom todo se monta del lado del
cliente y la identidad siempre coincide: una prueba de componente no puede
detectar esto.

### Regla para futuro

Antes de usar un componente de Eden con hijos estructurados desde un Server
Component, revisar si el padre compara `child.type` con un componente
importado. Si lo hace, o se usa el equivalente nativo —los `type` de cadena si
cruzan— o el archivo entero se marca `"use client"`.

Y la senal general: **una prueba en jsdom no distingue un Server Component de
uno cliente.** Todo defecto que solo exista en la frontera de RSC hay que
buscarlo leyendo el codigo del paquete, o abriendo la pantalla.

---

## 24) Un modulo `"use server"` no puede exportar nada que no sea funcion async

### Problema

`/admin/vehiculos/nuevo` monta el formulario de alta. El adaptador
`(estadoPrevio, formData)` vive en `src/app/actions/vehiculos.ts` junto al resto
de las Server Actions, y `useActionState` necesita un estado inicial, que estaba
exportado del mismo archivo.

### Sintoma

La pagina responde `200`, pero al enviar el formulario:

```
Error: A "use server" file can only export async functions, found object.
> export {ESTADO_FORMULARIO_INICIAL as '7f41204b...'} from 'ACTIONS_MODULE0'
```

`POST /admin/vehiculos/nuevo 500`.

### Causa raiz

Todo lo que exporta un modulo `"use server"` se convierte en un **endpoint**:
el bundler le asigna un identificador y lo publica para que el cliente lo
invoque por la red. Un objeto no es invocable, asi que la evaluacion del modulo
falla completa — se cae el modulo entero, no solo esa exportacion.

`ESTADO_FORMULARIO_INICIAL` es un objeto de tres campos que solo usa el cliente
para inicializar `useActionState`. Estaba ahi por cercania: es el estado que
devuelven los adaptadores del mismo archivo.

**Ni `tsc` ni `next build` lo detectan.** El tipo es correcto y la compilacion
pasa; el fallo aparece al servir la pagina. El `export type` de al lado no
molesta porque los tipos se borran al compilar.

### Solucion aplicada

El tipo y la constante se movieron a `src/types/formularioVehiculo.ts`, que no
lleva directiva. Los componentes cliente importan el valor de ahi y la action de
`@/app/actions/vehiculos`; el modulo de actions importa el tipo.

Se movieron **los dos**, aunque el tipo podia quedarse: separarlos dejaria la
mitad de la respuesta en cada archivo.

La invariante vive en `src/components/fronteraRsc.test.ts`, junto a la de la
seccion 23: recorre el codigo fuente, encuentra los modulos con `"use server"` y
exige que toda exportacion de valor sea `async`. Falsificada volviendo a
exportar la constante.

### Regla para futuro

En un modulo `"use server"`, cada exportacion es una puerta abierta a la red.
Antes de agregar una, preguntar si tiene sentido que el cliente la **invoque**;
si no lo tiene, no pertenece a ese archivo. Constantes, tipos con valor,
esquemas y tablas de configuracion van a `src/types/` o a `src/lib/`.

Y la senal general, la misma que la seccion 23: **la compuerta verde no cubre la
frontera servidor/cliente.** `tsc` mira tipos y `next build` compila; ninguno de
los dos ejecuta el modulo como lo ejecuta el servidor al atender una peticion.

---

## 25) El `FieldSet` de Eden es para agrupar `Radio` y `Checkbox`, no para seccionar un formulario

### Problema

El formulario de alta y edicion de vehiculo se divide en tres secciones
—identificacion, especificacion, condicion— como pide `ui-ux-requerimientos.md`
4.2. Se uso el `FieldSet` de Eden con un `Legend` por seccion.

### Sintoma

Ninguno visible en las pruebas: la compuerta estaba en verde, incluida la de
accesibilidad. Al revisar el codigo del paquete aparecieron dos efectos, los dos
medidos despues montando el formulario y llamando `checkValidity()`:

- **Seis mensajes de error para cuatro campos obligatorios.** Cuatro dentro de
  los `FormField` y **dos colgando directamente del `<fieldset>`**, repitiendo el
  error del primer campo invalido de cada seccion.
- Los `FormField` no se apilan: quedan en una fila que envuelve.

### Causa raiz

El tipo del paquete lo dice sin ambiguedad:

> The `FieldSet` is used to group `Radio` and `Checkbox` components (...)
> children: Should contain `Radio` or `Checkbox` form controls each with their `Label`.

La documentacion oficial —consultada despues por el MCP `eden-docs`— lo repite
desde el otro lado, y de paso confirma la composicion que se adopto: el ejemplo
de `eden-form-parts` es `Form` > `Stack` > `FormField`, y entre sus gotchas
esta *"`FormField` es para un unico control y NO debe envolver `Radio` ni
`Checkbox`: para esos usa `FieldSet`"*.

De ahi salen las dos consecuencias:

1. Su CSS estira a ancho completo solo a los hijos que espera:
   `> :is(legend,label,input) { flex: 0 1 100% }`. Un `FormField` renderiza un
   `div`, que no encaja en ese selector, asi que se queda con `flex: 0 1 auto`
   dentro de un contenedor `display:flex; align-items:center`.
2. `useValidation` trata al `<fieldset>` como un control de grupo: le redefine
   `validationMessage` para que devuelva el del primer elemento invalido y
   escucha `invalid` **en fase de captura**, de modo que recoge los eventos de
   sus descendientes. Para un grupo de radios eso es correcto —el grupo es una
   sola respuesta—; para una seccion de campos independientes, duplica.

### Solucion aplicada

Cada seccion es `Card renderAs="fieldset"` con un `Stack` dentro, conservando el
`Legend` de Eden, que solo aporta tipografia (`Text4` sobre un `<legend>`) y no
trae comportamiento.

El primer intento fue `<fieldset>` pelado. Resolvia los dos defectos, pero al
verlo en pantalla no separaba nada: sin marco, las tres secciones se leian como
una lista continua con tres titulos grises. **`renderAs` es lo que permite
quedarse con las dos cosas**: `Card` pone borde, radio y sombra, y el elemento
sigue siendo un `<fieldset>` con su `<legend>` —que es lo que hace que un lector
de pantalla anuncie la seccion como contexto de cada campo—. `Stack` apila los
campos con la separacion de la escala de Eden.

No es saltarse la regla 10, es al reves: se usan tres componentes de Eden
(`Card`, `Stack`, `Legend`) y se descarta solo el que estaba escrito para otra
cosa. `Card` y `Stack` estaban instalados como dependencias transitivas; se
declararon en `package.json` al pasar a usarse directamente.

El CSS propio queda en dos reglas: el espacio interior, que `Card` no trae a
proposito para no imponer una densidad, y un respiro lateral en el `<legend>`,
que el navegador recorta sobre el borde superior. Lleva `min-inline-size: 0`
porque el `<fieldset>` impone `min-width: min-content` y sin eso un campo largo
desborda la columna en vez de encogerse.

Consultado despues el MCP, la composicion resulto ser **la que Eden prescribe**:
el `useWhen` de `Card` es "agrupar contenido en una superficie elevada que
destaque del fondo", su `avoidWhen` es "solo separas elementos con espaciado,
sin superficie: usa `eden-stack`", declara `shipsCss: no trae padding propio` y
su ejemplo oficial es `<Card depth="raised" renderAs="section" style={{padding:
"var(--unity-spacing16)"}}><Stack>` — el mismo token de espaciado incluido.

Dos ajustes salieron de esa consulta:

- **El titulo de seccion es `H4 renderAs="legend"`.** El `Legend` de
  `eden-form-parts` renderiza `Text4`, que en la escala de Unity es tamano de
  *descripcion* (`Text1`–`Text6` se eligen por proposito semantico), y dejaba
  los titulos indistinguibles de las etiquetas de campo. `H4` es 1.125rem/600
  contra el 1.25rem/700 de `H3`: suficiente para separar sin competir con el
  `H1` de la pagina.
- **El reparto en columnas es `Grid` de Eden**, no una media query propia. Mide
  el **contenedor** con `@container` y no la ventana, de modo que la pantalla se
  comporta igual si el formulario acaba dentro de un panel. Los breakpoints son
  4/8/12/12 columnas (small/medium/large/xlarge) y `Condicion` abarca el ancho
  completo, que antes dejaba media fila vacia.

Ojo con `Item`: **el tipo enviado exige los cuatro breakpoints** aunque la
documentacion diga que uno sin definir hereda del inmediato mayor y su tabla de
props los marque opcionales. Van los cuatro explicitos.

No existe separador de proposito general en Eden. Se reviso el catalogo
completo: el unico `Divider` es subcomponente de `eden-vertical-tiles`, y ese
paquete es una tarjeta de media para cuadriculas y carruseles. La otra forma
legitima de seccionar seria `eden-accordion`, descartada porque su `useWhen` es
"contenido secundario opcional que el usuario abre bajo demanda" y colapsar
esconderia campos obligatorios y sus errores de validacion.

Tres pruebas de regresion: los mensajes se cuentan, ninguno cuelga del
`<fieldset>`, y cada seccion sigue siendo un `<fieldset>` con `<legend>`. La
primera se falsifico devolviendo una seccion al `FieldSet` de Eden —cinco
mensajes y uno al pie—; la tercera, quitando el `renderAs`, con lo que la tarjeta
se ve igual y la semantica desaparece sin ruido.

### Regla para futuro

Antes de usar un componente de Eden fuera del caso para el que esta escrito,
leer su tipo en `lib/es/types.d.ts` —lleva la descripcion de proposito y de que
espera como hijos— y su CSS. Un componente puede renderizar sin fallar y aun asi
estar aplicando reglas de disposicion y de validacion pensadas para otra cosa.

Y de nuevo la senal de las secciones 23 y 24: **la compuerta verde no cubre el
comportamiento visual ni el de validacion nativa.** Aqui hizo falta montar el
componente y disparar `checkValidity()` a proposito para verlo.

---

## 26) Un error del servidor no llega solo a la validacion de Eden

### Problema

El servidor devuelve los errores por campo (`detalles: { marca: "requerido" }`) y
la pantalla tiene que marcar **ese** campo como invalido, no solo escribir un
texto suelto.

### Sintoma

El mensaje aparecia, pero el campo se veia bien: sin marco rojo, sin icono de
error y sin `aria-invalid`. Se leia como un texto de ayuda mas entre las
etiquetas, que es exactamente lo que era — viajaba por el `description` de
`FormField`, documentado como *"a brief description of how to fill in the
input"*.

### Causa raiz

Eden decide el estado de validez de un control con **una sola fuente**:

```js
const getValidityState = (validationMessage, warningMessage, showWhenSuccessful) => {
  if (validationMessage) return "error";
  ...
};
```

`description` no entra en esa cuenta, asi que el `validityState` se quedaba en
`unknown` y ni `SharedInput` pintaba el borde de peligro ni aparecia el icono.

Y hay dos cosas mas que no son evidentes leyendo solo la API:

1. **`useValidation` solo reacciona a eventos del DOM** — escucha `input`,
   `change`, `invalid`, `resetValidity` y `validate` sobre el propio control. Al
   volver del servidor no ocurre ninguno: el estado de React cambia, el
   componente se repinta, y Eden no se entera. El mensaje se quedaria invisible
   hasta que el usuario tecleara.
2. **`setCustomValidity` persiste.** Una vez puesto, el control sigue invalido
   aunque el usuario escriba un valor correcto, hasta que alguien lo limpia con
   la cadena vacia.

### Solucion aplicada

Los errores del servidor se guardan traducidos en un `ref` y se aplican por
`onValidate`, que es el punto de extension que documenta el paquete:

```tsx
const validarConElServidor = (control: HTMLInputElement): void => {
  control.setCustomValidity(erroresDelServidor.current[control.name] ?? "");
};
```

El campo sale de `control.name` y no de un closure por campo: una fabrica que
devuelve funciones leyendo el `ref` hace saltar la regla del compilador de React
sobre refs en render, y ademas sobra.

Para los dos puntos de arriba:

- Al llegar el estado nuevo, un efecto **despacha `validate`** sobre cada
  control. Es el evento que `useValidation` escucha para justamente esto.
- Un manejador de `input` en el formulario **borra la entrada del `ref`** en
  cuanto el usuario toca el campo. Funciona por el orden de los eventos: Eden
  escucha `input` en el control y reevalua dentro de un `requestAnimationFrame`,
  asi que el borrado —que corre al burbujear hasta el formulario— ya ocurrio
  cuando se vuelve a llamar a `onValidate`.

Los tres formularios pasaron ademas al `<Form>` de Eden, que pone `noValidate`
en el elemento y conduce la validacion el mismo. Con el `<form>` crudo salian
las dos cosas a la vez: el globo nativo del navegador y el hint de Eden.

Dos pruebas, falsificadas por separado: quitar el despacho de `validate` deja
las dos en rojo, y quitar el olvido al teclear deja solo la segunda.

### Regla para futuro

Un texto en pantalla no es una validacion. Si el diseño dice "el campo queda
invalido", hay que moverle al componente **el estado** que el usa para decidirlo
—aqui `validationMessage` via `setCustomValidity`—, no escribir el mensaje por
un hueco que solo lo muestra.

Y al integrar validacion propia con un componente de terceros, mirar **como se
entera**: si escucha eventos del DOM, un cambio de estado de React no le llega y
hay que provocar el evento. La prueba tiene que esperar al
`requestAnimationFrame`, o pasa y falla segun lo que tarde el entorno.

---

## 27) `HtmlFragment` no sanea: React para casi todo, pero no un `<script>`

### Problema

`descripcionParticipacion` pasa a capturarse con el editor enriquecido de Eden
para que la convocatoria publicada se lea mejor. Eden empareja
`eden-rich-text-editor` con `eden-html-fragment` y describe esa relacion como
**display-companion-requerido**: "RichTextEditor produce HTML; HtmlFragment lo
renderiza de forma segura. Evita `dangerouslySetInnerHTML`".

Esa descripcion se leyo como una garantia de seguridad. No lo es.

### Sintoma

Ninguno todavia: se midio **antes** de escribir la pantalla. `HtmlFragment` usa
`html-react-parser`, que convierte HTML en elementos React y **no sanea nada**.
Lo que protege, si algo protege, es React. Se monto el componente con cinco
cargas hostiles:

| Carga | Resultado |
| --- | --- |
| `<img src=x onerror="...">` | React lo rechaza: *Invalid event handler property* |
| `<div onclick="...">` | Igual |
| `<a href="javascript:...">` | React lo sustituye por `javascript:throw new Error('React has blocked a javascript: URL...')` |
| `<iframe src="javascript:...">` | Igual |
| **`<script>...</script>`** | **Se renderiza al DOM tal cual** |

En jsdom no llego a ejecutarse, pero jsdom no corre scripts por defecto. En un
navegador, un `script` creado con `createElement` al que se le pone texto antes
de insertarlo **si se ejecuta**.

### Causa raiz

React neutraliza dos superficies —atributos de evento en cadena y URLs
`javascript:`— y ninguna de las dos es la unica. `HtmlFragment` no anade ninguna
lista de permitidos: mapea elementos a componentes y deja pasar los que no
conoce. "Sin `dangerouslySetInnerHTML`" describe **como** renderiza, no que
filtre.

Y hay una razon estructural para no depender de eso: el editor solo restringe al
usuario honesto. La Server Action recibe una cadena, y un `POST` fabricado con
`curl` manda la que sea. Cualquier garantia tiene que estar en el servidor.

### Solucion aplicada

`src/lib/domain/htmlDeDescripcion.ts`: una lista de **permitidos** que se aplica
al guardar, dentro de `revisarDatosConvocatoria`. Sobreviven dieciseis etiquetas
—las que el editor puede producir con sus controles restringidos— y un solo
atributo, el `href` de un enlace, limitado a `http`, `https` y rutas internas.

**Rechaza en vez de limpiar, y eso es lo importante.** Limpiar exige entender
toda la entrada para decidir que quitar, y ahi es donde se rompen los
saneadores: basta una forma que el limpiador interprete distinto que el
navegador. El clasico es `<scr<script>ipt>`, que al quitar el interior deja un
`<script>` intacto. Rechazar solo exige reconocer lo permitido; **todo lo que no
se reconoce se rechaza**, y esa asimetria es la que hace la diferencia. Hay
prueba de ese caso concreto.

Dos expectativas de las pruebas resultaron equivocadas, y las dos en la misma
direccion: el validador era **mas** estricto de lo que yo esperaba. Rechaza un
`<` sin escapar —el editor emite `&lt;`, asi que no ocurre en la practica— y
clasifica un `data:` con marcado dentro como etiqueta invalida en vez de enlace
invalido. Se corrigieron las pruebas, no el codigo: ante una cadena que no es
HTML bien formado, no sabemos como la interpretara el navegador, y adivinar es
justamente lo que se quiere evitar.

El limite de la descripcion subio de 2000 a 8000 caracteres: ahora el marcado
cuenta.

### Regla para futuro

**"Renderiza seguro" en la documentacion de un componente no es una lista de
permitidos.** Antes de confiar en una pieza de terceros para contener entrada de
usuario, medirla con cargas hostiles; toma diez minutos y aqui cambio el diseno.

Y la regla que no depende de ningun componente: **lo que decide si un dato es
admisible se ejecuta en el servidor**, porque es lo unico que el cliente no
puede saltarse. Un editor que restringe la interfaz es comodidad para quien
captura, nunca un control de seguridad.

---

## 28) El `Option` de Eden deduce su valor del texto, y una opcion vacia envia su etiqueta

### Problema

El selector de vehiculos de la pantalla de lotes necesita una opcion de marcador
—"Elige un vehiculo"— con valor vacio, para que `required` obligue a elegir. Sin
ella el navegador da por valida la primera de la lista, que es justo el vehiculo
que nadie escogio.

### Sintoma

Con `<Option value="">Elige un vehiculo</Option>`, el `<option>` que Eden
renderiza sale con `value="Elige un vehiculo"`. Un envio sin elegir nada no
falla la validacion del navegador: manda esa cadena como `vehiculoId`, y el
servidor responde `not_found` sobre un vehiculo que se llama como el texto del
marcador.

### Causa raiz

`Option.js`:

```js
value = getChildrenText(value || children);
```

`value || children` con la cadena vacia es falsy, asi que **toma los hijos**. Es
razonable para el caso normal —`<Option>Sonora</Option>` sin `value` explicito—
pero convierte "valor vacio" en algo que la API no puede expresar. `Select`
repite el mismo calculo al armar sus `<option>` nativos, de modo que no hay
forma de corregirlo desde fuera.

Detras hay una segunda cosa que conviene saber: **`Option` no es un `<option>`**.
Es un `A11y` —un `<button>`— del desplegable propio de Eden, y `Select` decide
si monta ese desplegable comparando `child?.type === Option`. La misma
comparacion por identidad de la seccion 23; aqui no falla porque el componente
es cliente, pero es la que hace que un `<option>` nativo entre por otro camino.

### Solucion aplicada

`<option>` nativo dentro del `Select` de Eden, que es un uso documentado —su API
dice "elements or `<Option>` components"—. Con hijos nativos `hasCustomComponents`
queda en `false`, `Select` no monta el desplegable y renderiza un `<select>`
normal: el valor viaja intacto y el formulario sigue funcionando sin JavaScript.

```tsx
<Select name="vehiculoId" required defaultValue="">
  <option value="">{etiquetas.elegirVehiculo}</option>
  {disponibles.map((vehiculo) => (
    <option key={vehiculo.vehiculoId} value={vehiculo.vehiculoId}>
      {vehiculo.etiqueta}
    </option>
  ))}
</Select>
```

La prueba que lo fija afirma que la primera opcion tiene `value === ""` y su
texto es la etiqueta. Se falsifico volviendo a `Option`: falla con
`expected 'Elige un vehiculo' to be ''`.

### Regla para futuro

**Un componente de Eden que acepta `value` no necesariamente lo respeta.** Antes
de apoyar una decision de correccion —que se envia, que se compara— en el valor
de un control de terceros, comprobar en el DOM que ese valor es el que se
escribio. Vale para cualquier caso en que el valor "vacio", "cero" o "falso"
tenga significado propio: es donde los `||` de una libreria hacen dano.

## 29) `GSI2SK <= ahora` excluye por error los items publicados en el mismo instante

### Problema

PA-05 (Etapa 7, catalogo de participante) necesita `GSI2SK <= ahora` para la
segunda pata del gating triple: `publicadaEn <= ahora`, inclusiva (R-01,
`yaPublicada`).

### Sintoma

Al escribir la condicion de rango del `Query`, comparar directamente contra
`ahora.toISOString()` excluye una convocatoria cuyo `publicadaEn` es
exactamente igual a `ahora`. La condicion `yaPublicada` en memoria (`ventanas.ts`)
dice que si deberia verse; la consulta de DynamoDB, que no.

### Causa raiz

`GSI2SK` no es la fecha sola: es `<fecha>#<id>` (`gsi2.porEstatus`). Comparar
`"2026-09-10T14:00:00.000Z#01AB..." <= "2026-09-10T14:00:00.000Z"` es **falso**:
la cadena con sufijo es lexicograficamente mayor que su propio prefijo, porque
cualquier caracter despues del final de la mas corta la hace "mayor". El
espejo en memoria (`ventanas.test.ts`) nunca iba a detectar esto: prueba
`Date.getTime()`, no la comparacion de cadenas que hace DynamoDB.

### Solucion aplicada

`gsi2.cotaSuperiorPorFecha(fecha)` en `claves.ts` devuelve `"<fecha>#￿"`.
`￿` es mayor que cualquier caracter del alfabeto de ULID (Crockford:
digitos y mayusculas sin I/L/O/U, todo por debajo de `Z`), asi que ningun `id`
real supera esa cota y la comparacion queda inclusiva en la fecha:

```ts
KeyConditionExpression: "GSI2PK = :pk AND GSI2SK <= :cota",
ExpressionAttributeValues: {
  ":cota": gsi2.cotaSuperiorPorFecha(ahoraIso),
},
```

Prueba de frontera en `claves.test.ts`: un item publicado en el instante exacto
de la cota queda incluido; uno un milisegundo despues, excluido.

### Regla para futuro

**Una condicion de rango sobre una `SK` compuesta (`<fecha>#<id>`) nunca compara
contra la fecha sola si se quiere inclusividad en la fecha.** Hace falta una
cota que domine cualquier sufijo posible, no el valor sin sufijo. Aplica a
cualquier GSI de este modelo con la misma forma —`GSI4SK` de vencimientos
incluido, el dia en que necesite un limite superior inclusivo.

## 30) El centinela de adjudicacion sobrevive a la prueba que lo creo

### Problema

La prueba de concurrencia de la Etapa 8 corre contra el sandbox y purga al
terminar las particiones que creo: la convocatoria, el vehiculo y el lote.

### Sintoma

La primera corrida pasaba entera. **La segunda fallaba**, y de una forma que
parecia un defecto grave del motor de fila: la reasignacion devolvia
`fila_agotada` teniendo candidatos vivos, y en la rafaga ganaba el turno 2 con
el turno 1 en la fila. La tercera volvia a fallar igual.

### Causa raiz

El centinela de adjudicacion activa vive en `PART#<participanteId> /
ADJUDICACION_ACTIVA`, **fuera de las particiones del lote** — tiene que estar
ahi, es lo que hace que R-09 valga entre lotes distintos—. La purga no lo
borraba y los identificadores de participante de la prueba eran fijos
(`e8-cancela`, `e8-part0`...), asi que la corrida siguiente encontraba a esos
participantes con una adjudicacion activa **de la corrida anterior** y los
congelaba.

El sistema estaba haciendo exactamente lo correcto. La prueba era la que
mentia. El mismo defecto aparecio dos veces: entre corridas del proceso y entre
las dos rondas de la rafaga dentro de la misma corrida, porque las dos usaban
los mismos nombres.

### Solucion aplicada

Identificadores de participante unicos por corrida **y por ronda**, y registro
de `PART#<id>` entre las particiones a purgar:

```ts
const CORRIDA = randomUUID().slice(0, 8);

const participante = (nombre: string): string => {
  const id = `e8-${nombre}-${CORRIDA}`;
  particionesCreadas.add(clave.centinelaAdjudicacion(id).PK);
  return id;
};
```

### Regla para futuro

**Una prueba de integracion que crea estado con garantias que cruzan agregados
no puede reutilizar identidades.** Antes de culpar al codigo por un fallo que
solo aparece en la segunda corrida, revisar que items quedaron vivos de la
primera: los centinelas son, por diseno, los que mas sobreviven. Vale igual
para `VEH#<id> / ACTIVO` (R-10) y para `LOTE#<id> / PART#<id>` (R-07).

---

## 31) `PendienteDTO` necesita el correo del titular y no existe ningun perfil de participante

### Problema

`api-contracts.md` (Etapa 0) exige que `PendienteDTO` —la bandeja de tesoreria— incluya el
correo del titular, para que quien avala o rechaza sepa a quien le pertenece un comprobante.

### Sintoma

No hay sintoma en ejecucion: se detecto al escribir `listarPendientesVerificacion`. La solicitud
solo guarda `participanteId`, y no existe ningun item `PART#<id> / PERFIL` con datos de contacto
— la Etapa 2 documento en su momento (seccion 8 de este archivo) que el *upsert* real de
participante nunca se implemento; `participanteId` sigue siendo el `oktaSub` tal cual.

### Causa raiz

El modelo de datos nunca desnormalizo un correo en ningun lado alcanzable por tesoreria, y no hay
tabla de perfiles que consultar en su lugar. `getSession()` si conoce el correo —viene del *claim*
de Okta en cada peticion— pero esa sesion es la de quien participa, no la de quien tiene tesoreria
delante.

### Solucion aplicada

`correoTitular` se copia de la sesion **al crear la solicitud** (T1,
`src/lib/fila/solicitarCompra.ts`), como un atributo mas del item — igual que `participanteId`,
solo que de presentacion. `src/app/actions/fila.ts` lo toma de `sesion.correo` y lo pasa al
servicio; `aSolicitud` lo lee de vuelta como cualquier otro campo opcional.

No es una fuga de R-12: la regla protege que un participante vea la identidad de **otro**, y
`correoTitular` es el dato **propio** del titular de esa misma solicitud. Sigue habiendo una
frontera que vigilar — ninguna proyeccion hacia otro participante (`MiLugarDTO`) debe exponerlo —,
y por eso vive en el item crudo y no en un tipo compartido con esa proyeccion.

### Regla para futuro

Cuando la Etapa 4 real (*upsert* de participante) se implemente, `correoTitular` puede
seguir copiandose igual en vez de resolverse por *join*: es mas barato, y ademas conserva el
correo con el que se pago aunque la cuenta cambie de correo despues, que es lo que el auditor
necesita ver.

---

## 32) Tesoreria necesita leer una solicitud sin conocer su lote, y GSI2 tiene que dispersarse otra vez

### Problema

`subirComprobante`, `avalarPago` y `rechazarPago` (`api-contracts.md` seccion 5) reciben solo
`solicitudId`. Todo patron de acceso de `modelo-datos-dynamodb.md` seccion 5 lee una solicitud
a partir de su `loteId` — no hay ninguno que resuelva la operacion inversa.

### Sintoma

No hay sintoma en ejecucion: se detecto al disenar `src/app/actions/tesoreria.ts`, antes de
escribir la lectura.

### Causa raiz

`solicitudId` no es un identificador arbitrario: `identificadorDeSolicitud` (`claves.ts`) lo
**deriva** de `loteId` y `turno` como `<loteId>-<turno>`, precisamente para no desincronizarse
nunca de su clave. El documento nunca necesito leerlo en reversa porque, hasta la Etapa 9, todo
lo que operaba sobre una solicitud ya tenia el lote en la mano (la pagina del participante, la
propia fila).

### Solucion aplicada

`loteYTurnoDesdeIdentificador` (`claves.ts`), el inverso exacto de `identificadorDeSolicitud`:
divide por el **ultimo** `-` —un `loteId` real es un ULID, alfabeto de Crockford, sin guion, asi
que el separador nunca es ambiguo— y valida que el resto sean solo digitos. `leerSolicitudPorId`
(`src/lib/fila/leerSolicitud.ts`) lo usa para armar la clave y hacer un `GetItem` consistente, sin
inventar un indice nuevo.

Aparte, `avalarPago` y `rechazarPago` tienen que **retirar** las claves de GSI2 que `subirComprobante`
les puso: sin eso, una solicitud ya `VENDIDA` o `RECHAZADA_POR_TESORERIA` seguiria apareciendo en
la particion `SOL_ESTATUS#EN_VERIFICACION` que lee PA-11, y la bandeja de tesoreria mostraria
trabajo ya resuelto. Es la misma logica de dispersion que GSI4 ya documentaba para los
vencimientos (modelo-datos-dynamodb.md seccion 3): las claves de "trabajo pendiente" solo existen
mientras el item de verdad esta pendiente.

### Regla para futuro

Un identificador de negocio derivado (no generado) es reversible por diseno: antes de crear un
indice nuevo para leerlo "al reves", comprobar si basta con deshacer la derivacion. Y cualquier
GSI que modele "trabajo pendiente" tiene que limpiarse en **todas** las transiciones de salida,
no solo en la que el documento menciono primero — T3 escribe las claves de PA-11, pero T4 y T6 son
igual de responsables de retirarlas.

## 33) El barrido no empaqueta: `esbuild` no conoce `server-only`

### Problema

Al implementar la Etapa 10, el barrido (`amplify/barrido/handler.ts`) pasa de ser un andamio sin
efectos a reusar de verdad `src/lib/fila/barridoDeVencimientos.ts` y
`src/lib/correo/procesarOutbox.ts` — y, transitivamente, casi toda la capa de servicios, que
empieza cada archivo con `import "server-only";`.

### Sintoma

`amplify/backend.test.ts` (que empaqueta el Lambda del barrido con `esbuild` para sintetizar la
pila) fallo con `Could not resolve "server-only"`, con la sugerencia de esbuild de marcarlo
`external` — que solo habria trasladado el fallo al arranque real del Lambda.

### Causa raiz

`server-only` **no es un paquete instalado**: no aparecia en `package.json` ni en
`node_modules`. `tsc --noEmit` (raiz) lo resuelve porque el plugin de TypeScript de Next.js
—`"plugins": [{ "name": "next" }]` en `tsconfig.json`— reconoce ese nombre como caso especial y
le provee tipos sin que exista de verdad; `next build`/`next dev` hacen lo mismo por su lado.
`esbuild`, el empaquetador que usa `defineFunction` de Amplify Gen2 para el Lambda, no tiene
absolutamente ninguna de esas dos cortesias: intenta resolver el nombre como cualquier import y
falla si el paquete no existe en disco.

### Solucion aplicada

`npm install server-only` (el paquete real, publicado por Vercel: un archivo que lanza si
`typeof window !== "undefined"`, del que Next.js *recomienda* depender explicitamente en
proyectos que lo consumen fuera de su propio bundler). Con el paquete presente, `esbuild` lo
resuelve como a cualquier otro modulo de `node_modules` y lo empaqueta sin cambios de codigo en
ningun archivo de `src/lib`.

### Regla para futuro

Que algo tipe y compile con `next build`/`tsc` no prueba que cualquier otro empaquetador del
proyecto lo resuelva igual: Next.js tiene casos especiales que no comparte con nada mas. Antes
de reusar codigo de `src/lib` desde un Lambda de Amplify (o cualquier bundle fuera de Next), hay
que probar el empaquetado real (`amplify/backend.test.ts` ya lo hace) y no solo el typecheck.

## 34) `amplify/tsconfig.json` no comparte el alias `@/` con el raiz

### Problema

Con el barrido reusando `src/lib` por primera vez (Etapa 10), `npm run typecheck` —que corre
`tsc --noEmit` dos veces, una por proyecto— empezo a fallar en la segunda pasada
(`tsc -p amplify/tsconfig.json`) con decenas de `Cannot find module '@/lib/...'`.

### Sintoma

El error solo aparecia bajo `amplify/tsconfig.json`, nunca bajo el `tsconfig.json` raiz.

### Causa raiz

`amplify/tsconfig.json` es un proyecto de TypeScript **independiente** —`compilerOptions.paths`
solo tenia `$amplify/*`, para los recursos generados por `ampx`— y `amplify/barrido/handler.ts`
importa `src/lib` por ruta relativa (no por el alias: ver seccion 33 y el comentario del propio
archivo). El problema es transitivo: esos archivos de `src/lib` usan `@/` **internamente**, en
todo el proyecto, y esa segunda capa de imports es la que `amplify/tsconfig.json` no podia
resolver.

### Solucion aplicada

Agregar `"@/*": ["../src/*"]` a los `paths` de `amplify/tsconfig.json`, apuntando a la misma
carpeta que resuelve el alias del `tsconfig.json` raiz, solo que relativo a `amplify/`.

### Regla para futuro

Reusar codigo de `src/lib` desde `amplify/` (o desde cualquier proyecto de TypeScript con su
propio `tsconfig.json`) exige que ese `tsconfig.json` conozca los mismos alias, aunque el punto
de entrada los evite a proposito con rutas relativas: los alias reaparecen en cuanto se sigue un
import mas adentro.

---

## 35) Un menu que pregunta por una accion con guarda queda oculto para todos

### Problema

El menu de navegacion tenia que mostrar solo las secciones que la persona puede usar, y la
forma natural de lograrlo sin duplicar la matriz de permisos era que cada entrada declarara la
`Accion` de su pantalla y se resolviera con `puedeEjecutar`. La entrada del catalogo del
participante declaraba `convocatoria:ver-publicada`, que es literalmente la accion de esa
pantalla.

### Sintoma

Con esa entrada, el enlace a `/convocatorias` quedaba **oculto para todo el mundo**, incluido
quien tiene los dos permisos de venta. No fallaba nada: simplemente no aparecia.

Lo detecto una prueba de invariante escrita a proposito para esto —"ninguna entrada usa una
accion con guarda contextual"—, no el ojo. Un menu con una entrada de menos no se ve como un
defecto; se ve como un menu.

### Causa raiz

`puedeEjecutar` decide en dos tiempos (D-9): **capacidad** (¿EAS concedio el permiso?) y
**aplicabilidad** (la guarda: ¿el recurso esta en el estado correcto?).
`convocatoria:ver-publicada` lleva `guardaGatingTriple`, que exige `estatusConvocatoria`,
`yaPublicada` y `tipoConvocatoria`.

Un enlace de menu **no tiene recurso**: no hay una convocatoria concreta de la que sacar esos
datos. Y las guardas fallan cerradas por diseno (regla 18): un campo de contexto ausente
deniega. Asi que la respuesta correcta de `puedeEjecutar` sin contexto es "no", siempre — el
mecanismo funcionaba exactamente como debe, y la pregunta era la equivocada.

Es una trampa silenciosa porque la regla 18 es una virtud del sistema. No hay error que
propagar ni excepcion que ver: el `false` es legitimo y la consecuencia es un enlace que no se
dibuja.

### Solucion aplicada

Separar el primer tiempo y darle nombre. `tieneCapacidad({ accion, permisos })` en
`src/lib/auth/permisos.ts` responde solo por la capacidad, y `puedeEjecutar` lo invoca para su
paso 1 — un solo lugar la calcula.

El menu (`src/lib/navegacion.ts`) usa `tieneCapacidad`, y declara acciones **sin guarda**. La
entrada del catalogo pasa a `solicitud:ver-mis-solicitudes`, que exige exactamente los mismos
dos permisos de venta pero no arrastra el gating triple: expresa "¿esta persona compra?", que es
lo que el menu de verdad pregunta. El gating de cada convocatoria lo sigue aplicando la
pantalla, con `puedeEjecutar` completo.

Dos pruebas sostienen la separacion: que ninguna entrada del menu use una accion con guarda, y
que `tieneCapacidad` coincida con `puedeEjecutar` en toda accion sin guarda.

### Regla para futuro

`tieneCapacidad` es para **puertas** —menus, pestanas, listados de secciones—; `puedeEjecutar`
es para **operaciones sobre un recurso**, y no admite sustituto. Antes de resolver visibilidad
con una accion del catalogo, comprobar si tiene guarda: si la tiene, o se le pasa el recurso, o
la pregunta va dirigida a la accion equivocada.

Y no relaja nada: ocultar un enlace es cortesia. La autorizacion que cuenta es la que hace el
servidor al servir la pantalla (principio P-1), que si tiene el recurso delante.

## 36) Auditar el acceso donde se pide, y no donde se entrega, deja un hueco de bypass

### Problema

`api-contracts.md` describia `exportarBitacora` —la Server Action— como quien emite
`BITACORA_EXPORTADA`. Es el patron obvio: la action es donde se decide "se permite exportar",
asi que parecia el lugar natural para registrar que se exporto.

### Sintoma

Ninguno visible en una prueba unitaria de la action: llamada con permiso, devuelve la URL,
escribe el evento, todo en verde. El defecto no esta en lo que la action hace, esta en lo que
**no puede impedir**.

### Causa raiz

La action solo construye una URL (`/api/auditoria/exportar?...`); no hay ningun secreto ni token
en esos parametros —`agregado`, `agregadoId`, `tipo`, fechas— porque no son datos sensibles por
si mismos. Cualquiera con `Autob_Auditar` puede escribir esa URL a mano, sin pasar nunca por la
action, y el Route Handler que la atiende tiene que volver a verificar el permiso de todos modos
(ningun Route Handler hereda proteccion, `api-contracts.md` seccion 7). Si el evento se escribe
en la action, ese camino directo exporta sin dejar rastro: la bitacora de quien miro los datos
sensibles quedaria incompleta, justo lo que la seccion 3 de `trazabilidad-auditoria.md` dice que
tiene que existir ("quien mira los datos sensibles tambien deja rastro").

### Solucion aplicada

Mover la escritura al Route Handler (`src/app/api/auditoria/exportar/route.ts`), en el mismo
punto donde ya se lee la bitacora y se construye el CSV — justo antes de responder con el
archivo. Es el mismo criterio que `COMPROBANTE_DESCARGADO` (`api-contracts.md` seccion 7): el
evento se registra donde el dato **realmente sale**, no donde alguien pidio permiso para
pedirlo. La Server Action `exportarBitacora` se queda delgada: verifica el permiso y devuelve la
URL, sin tocar DynamoDB.

### Regla para futuro

Cuando una Server Action solo devuelve la URL de un Route Handler de descarga, el evento de
auditoria de "se accedio a esto" se escribe en el Route Handler, nunca en la action que la
antecede. Preguntar siempre: *¿puede alguien con el permiso adecuado llegar a este dato sin pasar
por donde creo que se registra el acceso?* Si la respuesta es si, el registro esta en el lugar
equivocado.

## 37) Verificar integridad evento por evento inventa una carrera que nunca ocurrio

### Problema

`verificarIntegridadDeLote` tiene que reconstruir, entre otras cosas, si alguna vez hubo dos
adjudicaciones vigentes simultaneas sobre el mismo lote (comprobacion 3 de
`trazabilidad-auditoria.md` 5.1). La forma obvia de calcularlo es recorrer los eventos en el
orden en que `Query` los devuelve —cronologico, por la `SK`— y llevar un estado.

### Sintoma

Con una reasignacion por vencimiento real —`SOLICITUD_VENCIDA` del turno que vencio y
`LOTE_ADJUDICADO` del turno siguiente, escritos en la **misma** `TransactWriteItems`— el replay
evento por evento marcaba, en algunas corridas y no en otras, "dos adjudicaciones vigentes
simultaneas" entre un turno que ya habia vencido y el que apenas ganaba. La carrera no existio
nunca: fue un artefacto de en que orden se leyeron dos eventos que ocurrieron en el mismo
instante.

### Causa raiz

Los eventos de una misma transaccion comparten `ocurridoEn` al milisegundo
(trazabilidad-auditoria.md 2.2). Su `SK` es `<ocurridoEn>#<eventoId>`, y `eventoId` es un ULID
—monotono creciente en el tiempo, pero con una parte aleatoria dentro del mismo milisegundo—.
Nada garantiza que el evento que libera el turno viejo ordene antes que el que adjudica el turno
nuevo. Si el replay los procesa en el orden equivocado, hay un instante —que solo existe en la
lectura, nunca existio en la base de datos— en el que el turno nuevo ya esta adjudicado y el
viejo todavia no se liberado.

### Solucion aplicada

Agrupar los eventos por `correlacionId` antes de reproducir cualquier cosa, y aplicar los
efectos de un grupo completo —todas las liberaciones antes que la adjudicacion del mismo
grupo— antes de evaluar el siguiente. El orden **entre** grupos si importa y se conserva
(cronologico); el orden **dentro** de un grupo deja de importar, porque es exactamente lo que no
esta garantizado y exactamente lo que no debe importar: son un solo acto atomico.

Verificado por falsificacion: construyendo el mismo escenario con los dos eventos en el orden
contrario dentro del arreglo de entrada, la prueba sigue en verde solo con el agrupamiento; sin
el, el resultado depende del orden y una de las dos permutaciones falla.

### Regla para futuro

Cualquier logica que reconstruya "que paso primero" a partir de la bitacora tiene que agrupar
por `correlacionId` antes de mirar el orden de la `SK`. El orden cronologico entre transacciones
es real y hay que respetarlo; el orden entre eventos de la **misma** transaccion no lo es, y
tratarlo como si lo fuera inventa carreras que la base de datos nunca tuvo.

---

## 38) Las alarmas en la pila de recursos cierran un ciclo entre pilas

### Problema

`AlarmasAutob` (Etapa 12) tenia que crear las alarmas del barrido en `AutobRecursos`, la pila
propia del proyecto donde ya viven la tabla, el bucket y el rol de computo. Es donde parece que
corresponden: son recursos de este sistema, no de Amplify.

### Sintoma

`ampx` —y `backend.test.ts`, que sintetiza la pila— fallaba antes de desplegar nada:

```
WARNING Resources/function1351588B: Circular Dependencies for resource function1351588B.
Circular dependency with [function1351588B -> AutobRecursos78796E31 -> function1351588B]
```

Doce de catorce pruebas del archivo rompian de golpe, todas en `Template.fromStack`.

### Causa raiz

La alarma "el barrido no se ejecuta" cuelga de `funcionBarrido.metricInvocations()`, y esa
metrica va dimensionada por `FunctionName`. Al resolverse produce un `Ref` a la funcion, que vive
en la pila que Amplify crea para `defineFunction`. Es decir: **`AutobRecursos` pasa a referenciar
la pila de la funcion**.

Y la pila de la funcion ya referenciaba `AutobRecursos`, desde la Etapa 10:

```ts
backend.barrido.addEnvironment("AUTOB_TABLE_NAME", tabla.tabla.tableName);
```

Dos pilas que se referencian mutuamente son un ciclo que CloudFormation no puede ordenar.

Lo importante es que **el diagnostico obvio es el equivocado**. Parece un problema del grupo de
logs y de los filtros de metrica, porque son los recursos nuevos que cruzan la frontera. No lo
es: con solo mover los filtros el ciclo persiste, porque basta cualquier referencia a la funcion
—incluida una metrica nativa, que no crea ningun recurso— para cerrarlo.

Tampoco sirve `pila.addDependency(Stack.of(funcion))`: eso declara explicitamente la arista que
ya existia en el sentido contrario.

### Solucion aplicada

Una **tercera pila** para las alarmas, `backend.createStack("AutobAlarmas")`, con lo que las
dependencias vuelven a ir en un solo sentido:

```
AutobAlarmas -> function        (metricas y grupo de logs del barrido)
AutobAlarmas -> AutobRecursos   (metricas de la tabla)
function     -> AutobRecursos   (nombre de la tabla)
```

Los `MetricFilter` se quedan aparte, en la pila del grupo de logs (`Stack.of(logs)`), porque un
filtro en otra pila obligaria a exportar el nombre del grupo por CloudFormation sin ganar nada.
Las alarmas si viven juntas en `AutobAlarmas`: una alarma referencia su metrica por espacio de
nombres y nombre —dos cadenas—, no por recurso, asi que no crea dependencia ninguna.

`backend.test.ts` lo comprueba sintetizando las tres pilas y contando en cual acaba cada cosa.

### Regla para futuro

Antes de crear en `AutobRecursos` cualquier recurso que apunte a la funcion de barrido, recordar
que la funcion ya toma de ahi el nombre de la tabla. La direccion de las dependencias entre pilas
de Amplify es un dato de diseno, no un detalle: **una metrica dimensionada es una referencia**,
aunque no parezca un recurso. Y el sintoma senala el recurso nuevo, no el que cierra el ciclo.

---

## 39) Un filtro de metrica que no coincide con nada no da error: da silencio

### Problema

Las alarmas de "vencimientos sin resolver", "outbox retrasado" y "correos fallidos" (Etapa 12)
cuentan datos que solo el dominio sabe calcular, asi que no existen como metrica nativa de AWS:
salen de `MetricFilter` sobre las lineas que `src/lib/observabilidad` escribe en el grupo de logs
del barrido.

### Sintoma

Ninguno, y ese es el problema. **Dos defectos distintos producen exactamente el mismo resultado
—una alarma que nunca se dispara— y ninguno de los dos falla al desplegar.**

### Causa raiz

Son dos trampas independientes, y las dos se descubrieron leyendo el codigo de Amplify y del
runtime de Lambda, no probando.

**1. El grupo de logs no existe todavia.** `AWS::Logs::MetricFilter` exige que el grupo exista al
crearse, y Lambda crea el suyo en la **primera invocacion**, no al desplegarse. Amplify solo
declara el grupo como recurso de la pila cuando `defineFunction` recibe `logging.retention`
(`backend-function/lib/factory.js`, `createLogGroup`); sin eso no hay a que colgar el filtro.

Ademas, `FunctionResources` solo expone `lambda: IFunction` y `cfnFunction`, y en esta version de
CDK `IFunction` no tiene `logGroup`, asi que el grupo hay que buscarlo en el arbol de
constructos: Amplify lo crea como hermano de la funcion.

**Y no vale recurrir al nombre convencional `/aws/lambda/<funcion>`.** Al declarar un grupo
propio, Amplify se lo pasa a la funcion por `LoggingConfig` y Lambda escribe **ahi**, no en el de
la convencion. Un filtro sobre el nombre convencional se despliega sin queja, apunta a un grupo
vacio y no coincide nunca.

**2. La ruta del campo esta un nivel mas arriba de lo que parece.** Con
`logging: { format: "json" }` el runtime de Lambda **envuelve** lo que se pasa a `console.info`:

```json
{ "timestamp": "...", "level": "INFO", "requestId": "...", "message": { "operacion": "...", "errores": 2 } }
```

Un patron `{ $.errores > 0 }` es sintacticamente valido, se despliega y no coincide con nada. El
correcto es `{ $.message.errores > 0 }`.

### Solucion aplicada

- `logging: { format: "json", level: "info", retention: "1 month" }` en
  `amplify/barrido/resource.ts`. La retencion no es solo higiene de costo: es lo que hace existir
  el grupo como recurso de la pila.
- `grupoDeLogsDelBarrido()` en `backend.ts` busca el `LogGroup` hermano de la funcion y **lanza**
  si no lo encuentra, con un mensaje que nombra las dos causas posibles. `ampx` no despliega y
  `backend.test.ts` falla en la compuerta; lo que no puede pasar es quedarse con alarmas mudas
  (regla 15).
- Todos los patrones usan `$.message.<campo>`, y una prueba de `backend.test.ts` afirma que
  **cada** filtro sintetizado tiene un `MetricValue` que empieza por `$.message.`.
- Cada filtro lleva `defaultValue: 0`. Sin el, una corrida que no coincide no publica ningun punto
  y la alarma oscila entre `OK` e `INSUFFICIENT_DATA` en vez de quedarse en `OK`.

### Regla para futuro

Un filtro de metrica se valida por sintaxis, nunca por coincidencia: hay que probarlo contra una
linea real en la consola de CloudWatch antes de confiar en la alarma que lo usa. Y al elegir la
senal de una alarma, preferir la **metrica nativa** siempre que exista: no depende de que el
codigo funcione, que es justo de lo que la alarma esta ahi para dudar. "El barrido no se ejecuta"
es el caso limite — si el `handler` lanza antes de la primera linea, un filtro de log calla.

---

## 40) `style-src 'unsafe-inline'` no es un pendiente de la CSP: es un limite de Eden

### Problema

La decision del 2026-09-04 dejo `style-src 'unsafe-inline'` en la CSP con una nota explicita de
revisarlo en la Etapa 12. La razon registrada entonces era falta de evidencia: "arriesga romper
visualmente componentes Eden cuyo uso de estilos en linea no se pudo verificar".

### Sintoma

Ninguno visible, y por eso importa: **ni `next build` ni jsdom aplican CSP**. Endurecer la
directiva dejaria la compuerta entera en verde y la aplicacion se dibujaria sin estilos en
produccion. La consola del navegador es el unico lugar donde se veria.

### Causa raiz

Se verifico contra los paquetes instalados, que es evidencia mas fuerte que la documentacion. Son
**dos hechos independientes**, cada uno suficiente por si solo:

1. **Eden no publica ningun archivo `.css`.** Cada componente lleva su hoja como cadena de
   JavaScript y la monta con el izado de hojas de estilo de React 19:

   ```jsx
   jsx("style", { href: "eden-table-Table.css", precedence: "eden", children: Table_default })
   ```

   (`eden-table/lib/es/components/Table/Table.js`). Eso produce un elemento `<style>` en linea en
   el `<head>`, y Eden no expone forma de pasarle un nonce: `style-src-elem` exige
   `'unsafe-inline'`.

2. **Hay atributos `style={{...}}`** en componentes que esta aplicacion usa en casi toda pantalla:
   `TD`, `TH`, `TR` y `SortButton` de `eden-table`; `Hint`, `Select`, `FieldSet` y `SharedInput`
   de `eden-form-parts`; `Item` de `eden-grid`. Eso exige `'unsafe-inline'` tambien en
   `style-src-attr`.

Partir la directiva en `style-src-elem` y `style-src-attr` —la salida elegante aparente— no gana
nada: las dos necesitarian el mismo permiso.

### Solucion aplicada

Se deja `style-src 'self' 'unsafe-inline'` y se **cierra** el pendiente como riesgo aceptado y
documentado, no como tarea diferida. `script-src`, que es la superficie que de verdad importa
contra XSS, conserva el nonce con `'strict-dynamic'` y sin `'unsafe-inline'`.

`src/proxy.test.ts` afirma las dos cosas a la vez —que `style-src` lleva `'unsafe-inline'` y que
`script-src` no— para que nadie lo "endurezca" creyendo que era un descuido.

El endurecimiento real de la Etapa 12 fue por otro lado, en cabeceras que si se pueden cerrar sin
romper nada: `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` y
`Cross-Origin-Resource-Policy`, todas con prueba en `next.config.test.ts`.

### Regla para futuro

Una prueba que afirma un **limite** vale tanto como una que afirma una capacidad, siempre que diga
por que existe el limite. Y antes de endurecer cualquier directiva de CSP, comprobar el `dist` de
la libreria y no su documentacion: aqui la respuesta estaba en una plantilla de JSX compilada, no
en ninguna pagina de Eden.

---

## 41) El paso 1 de T1 choca con la transaccion de T2 y la excepcion escapaba

### Problema

El paso 1 de T1 (`pedirTurno` en `src/lib/fila/solicitarCompra.ts`) es un `UpdateItem` **suelto**:
`ADD contadorTurnos :uno` sobre el item del lote, fuera de transaccion porque
`TransactWriteItems` no devuelve valores y el turno del `ADD` haria falta como clave del `Put` de
la misma transaccion.

### Sintoma

La prueba de carga de la Etapa 12, con 10 lotes y 10 participantes simultaneos, murio con una
excepcion **sin atrapar** que atraveso `solicitarCompra`:

```
TransactionConflictException: Transaction is ongoing for the item
 ❯ pedirTurno src/lib/fila/solicitarCompra.ts:187
 ❯ ejecutarSolicitud src/lib/fila/solicitarCompra.ts:137
```

En produccion eso es un 500 para el participante, en el instante de maxima concurrencia, en lugar
del `conflicto_concurrencia` que el diseno define como "carrera perdida: relee y reintenta".

### Causa raiz

DynamoDB lanza `TransactionConflictException` cuando una escritura **normal** toca un item que en
ese instante participa en un `TransactWriteItems`. Y el item del lote es exactamente eso: T2 lo
condiciona (`attribute_not_exists(adjudicacionActual)`) y lo escribe dentro de su transaccion,
mientras el paso 1 de toda solicitud le hace `ADD`. En `inicioVenta` los dos caminos se cruzan de
forma rutinaria — es el unico punto del sistema donde una escritura suelta comparte item con una
transaccion.

`pedirTurno` solo reconocia un fallo posible:

```ts
} catch (error) {
  if (!esFalloDeCondicion(error)) throw error;   // <- todo lo demas escapa
  return undefined;
}
```

**Por que no se habia visto nunca.** El SDK de AWS reintenta `TransactionConflictException` por su
cuenta: `maxAttempts` vale 3 por omision y tres intentos casi siempre bastan. La prueba de carga
lo desactivo (`maxAttempts: 1`) y el defecto salio a la primera. No es un defecto inventado por la
configuracion de la prueba: con contencion sostenida los tres intentos tambien se agotan, y
entonces el participante recibe un error del servidor en el peor momento posible.

### Solucion aplicada

- `esConflictoDeTransaccion` en `src/lib/data/transacciones.ts`, junto a `esFalloDeCondicion`.
  Vive ahi porque es el modulo que traduce errores de DynamoDB a errores de dominio, y porque hay
  que distinguirlo de su homonimo: el codigo `TransactionConflict` dentro de
  `CancellationReasons` llega cuando pierde **la transaccion**; `TransactionConflictException`,
  cuando pierde la operacion **suelta**.
- `pedirTurno` devuelve ahora `{ turno } | { rechazo: CodigoError }` en lugar de
  `number | undefined`. El cambio de forma no es cosmetico: los dos motivos de rechazo exigen
  respuestas distintas y `undefined` obligaba a quien invoca a suponer cual era. Condicion
  fallida → `motivoDelRechazo` (negocio); conflicto de transaccion → `conflicto_concurrencia`.
- La reserva del paso 0 se libera igual en los dos casos, que ya ocurria y ahora tiene prueba.

Tres pruebas nuevas en `solicitarCompra.test.ts`, incluida la que importa: con un lote `VENDIDO`
**y** un conflicto de transaccion, la respuesta es `conflicto_concurrencia` y no
`lote_no_disponible`. Decirle al participante que el lote no esta disponible cuando el lote sigue
en juego seria una mentira, no un error tecnico.

**Y no era el unico sitio.** Encontrado uno, se reviso el resto: hay cuatro escrituras fuera de
transaccion en `src/lib` y **tres** tocan items que si participan en transacciones. Las otras dos
tenian el mismo agujero, con el agravante de que las dos estan documentadas como "de mejor
esfuerzo" — es decir, el codigo ya declaraba que su fallo no debia importar, y sin embargo dejaba
escapar una excepcion:

- `liberarReserva` (`src/lib/fila/reservas.ts`). El item de la reserva lo borra el paso 2 de T1
  dentro de su transaccion, asi que `depurarYContarReservas` puede chocar al retirar una reserva
  muerta. Como `adjudicarLote` llama a `depurarYContarReservas` **en cada ronda**, la excepcion
  convertia una limpieza opcional en una adjudicacion fallida.
- `incrementarIntento` (`src/lib/correo/procesarOutbox.ts`). El item del mensaje lo tocan
  `marcarEnviado` y `marcarFallido` por transaccion; dos corridas del barrido pueden solaparse
  —cada 5 minutos con 300 s de limite— y chocar. La excepcion abortaba el resto del outbox de la
  corrida por no poder escribir un contador de reintentos.

En los dos casos la correccion es la misma y no cambia la intencion, solo la cumple: un conflicto
de transaccion significa "alguien mas lo esta resolviendo", que es exactamente lo que esos dos
helpers ya decian tolerar. La cuarta escritura suelta —`anotarReserva`— no necesita nada: su
`reservaId` es nuevo por solicitud y nadie mas lo toca.

`reservas.test.ts` es nuevo y fija las cuatro ramas de `liberarReserva`, incluida la que importa
al final: **cualquier otro error si escapa**. Credenciales o red caidas no son "alguien mas ya lo
resolvio", y tragarlas dejaria reservas huerfanas deteniendo adjudicaciones sin que nadie se
entere (regla 15).

### Regla para futuro

Toda escritura fuera de transaccion sobre un item que **si** participa en transacciones tiene que
contemplar `TransactionConflictException`. Son tres en este sistema y estan enumeradas arriba;
antes de agregar una cuarta, comprobar si su item aparece en alguna de las ocho transacciones de
`modelo-datos-dynamodb.md` seccion 6.

Cuidado especial con los helpers "de mejor esfuerzo": el comentario que dice que su fallo no
importa **no** lo hace verdad. Aqui dos de ellos declaraban tolerancia y rethrowaban, que es la
peor combinacion — nadie los revisa porque el comentario tranquiliza.

Y de forma mas general: los reintentos del SDK ocultan clases enteras de defecto. Una prueba de
carga que los desactiva —aunque no sea la configuracion de produccion— es una herramienta de
diagnostico legitima, y aqui pago su costo a la primera corrida. Se conserva detras de
`CARGA_SIN_REINTENTOS=1`.

---

## 42) La primera prueba de carga midio la prueba de carga

### Problema

`carga.integracion.test.ts` (Etapa 12) tenia que medir la apertura de una convocatoria: L lotes
abiertos a la vez, P participantes cada uno, todos disparando `solicitarCompra` simultaneamente.

### Sintoma

Tres corridas seguidas fallaron, cada una por una razon distinta, y **ninguna de las tres era el
sistema**:

1. `TimeoutError: connect ETIMEDOUT 3.218.180.176:443` — ni siquiera llegaba a medir.
2. Con el cupo de sockets subido: `TimeoutError: the request socket did not establish a
   connection within the configured timeout of 15000 ms`, todavia.
3. Con la conexion resuelta: `AssertionError: expected 4 to be 1` en "gana el turno menor de cada
   lote", y un p95 de 15,6 s contra un techo de 10 s.

### Causa raiz

Cuatro causas independientes, y lo unico que tenian en comun era estar en el arnes:

**1. Agotamiento de sockets del propio proceso.** El agente HTTPS de Node trae 50 sockets por
omision. Cien solicitudes son **trescientas** peticiones en vuelo, porque cada `solicitarCompra`
hace tres escrituras. Las que no consiguen socket esperan en cola hasta que expira el `connect`,
y el error resultante —`ETIMEDOUT` contra la IP de DynamoDB— parece un problema de AWS.

**2. `maxAttempts: 1` no era una decision defendible.** Se puso razonando que "un reintento
esconde la contencion". El razonamiento estaba invertido: `maxAttempts` vale 3 **en produccion**,
asi que medir sin reintentos mide una configuracion que el sistema no tiene, y la latencia que
importa es la que percibe el participante con los reintentos incluidos. (Aquella corrida si
encontro un defecto real — seccion 41 — pero como diagnostico, no como forma de medir.)

**3. La afirmacion comparaba dos turnos distintos con el mismo nombre.** Esta es la que mas
enseña. `solicitarCompra` devuelve `{ turno, adjudicacion }`, y son de dos cosas diferentes:
`turno` es el de **quien solicito**, mientras `adjudicacion.turno` es el turno **al que se
adjudico el lote**. No coinciden casi nunca, y por diseno: toda solicitud dispara
`adjudicarLote`, esa funcion premia al turno vivo menor de la fila, y quien la dispara con exito
es el ultimo en aterrizar (`arquitectura-tecnica-aws.md` 4.2 — "el ultimo en aterrizar cierra la
ronda"). La prueba leia el turno del llamador y afirmaba que era el menor: **fallaba con el
sistema comportandose exactamente como debe**.

**4. El techo del p95 no era medible desde esta maquina.** La inspeccion TLS corporativa (riesgo
R11) convierte el establecimiento de trescientas conexiones en el cuello de botella. El p95 de
15,5 s mide el proxy, no DynamoDB — y se ve en la forma de la distribucion: p50 de 1,7 s contra
p95 de 15,5 s es la firma de una cola, no de una base de datos lenta.

**Y la prueba de eso la dio la corrida siguiente**, con el escenario ya corregido y sin tocar
nada mas: mismo sandbox, mismos 10 x 10, y **p50 965 ms, p95 1 296 ms, 62 solicitudes por
segundo** — un factor de diez contra la primera. Lo unico que cambio entre las dos fue que el
agente HTTPS del proceso ya tenia conexiones abiertas.

### Solucion aplicada

- `httpsAgent: { maxSockets: 400 }` y tiempos de espera explicitos.
- Reintentos del SDK como en produccion, con el modo sin reintentos detras de
  `CARGA_SIN_REINTENTOS=1` por si hay que repetir el diagnostico de la seccion 41.
- `Medicion` distingue `turno` de `turnoAdjudicado`, con el comentario que explica por que no son
  lo mismo, y la afirmacion compara el segundo.
- El techo del p95 pasa a 30 s, ajustable con `CARGA_TECHO_P95_MS`, y documentado como detector
  de degradacion catastrofica y **no** como objetivo de rendimiento.

Con eso, la corrida completa: 100 solicitudes concurrentes sobre 10 lotes, **100 aceptadas, 0
rechazadas, exactamente 10 adjudicaciones** —una por lote y siempre al turno menor de su fila—, y
las abstenciones por reservas en vuelo que R18 predice.

### Regla para futuro

Cuando una prueba de carga falla, la primera hipotesis es el arnes y no el sistema: cupo de
conexiones, configuracion del cliente, y sobre todo **que afirma exactamente la asercion**. Aqui
la tercera causa habria pasado por un defecto grave del motor de fila —"no gana el turno menor",
que es la invariante central de la equidad— cuando lo unico roto era que dos campos con nombres
parecidos significaban cosas distintas.

Y **un solo numero de latencia no es una medida**: hay que correr la prueba dos veces y comparar.
Si la segunda corrida da diez veces mejor que la primera, lo que se midio la primera vez fue el
establecimiento de conexiones. Por eso el entregable de esta prueba es su informe —las dos
columnas— y no su veredicto.

---

## 43) `FormField` de Eden no etiqueta un control nativo, y ninguna pantalla lo detectaba

### Problema

La pantalla de auditoria envolvia sus `<select>` y sus `<input type="date">` en el `FormField` de
Eden, con la etiqueta pasada por la prop `label`. Es la receta que aparenta ser correcta y la que
ya estaba escrita en el repositorio.

### Sintoma

Ninguno en ejecucion. Aparecio al escribir la prueba del componente nuevo `FiltrosDeBitacora`:
axe fallo con *"Select element must have an accessible name"* sobre los cinco campos.

### Causa raiz

`FormField` no envuelve a su hijo en el `<label>`: renderiza `<Label htmlFor={id}>` y reparte ese
`id` **por contexto de React** (`IdContext`). Los componentes de Eden lo consumen y se lo ponen a
su `<input>`; un elemento nativo no consume nada, asi que la etiqueta apunta a un `id` que **no
existe en el documento** y el control queda sin nombre accesible. Pasarle un `id` a mano al
elemento nativo tampoco sirve: `FormField` solo adopta el `id` de un hijo cuyo
`type.isInput` sea verdadero, y un `"select"` nativo no tiene esa propiedad.

Por que no se habia visto: los controles nativos dentro de `FormField` estaban **en paginas**, y
el inventario de accesibilidad de la Etapa 12 cubre componentes, no paginas — las paginas son
Server Components asincronos que jsdom no puede montar. El defecto vivia exactamente en el hueco
declarado de esa cobertura.

### Solucion aplicada

Usar los componentes de Eden que si consumen el contexto: `Select` y `DateInput`, con `<option>`
**nativos** dentro del `Select`. Eso ya estaba probado en `/admin/vehiculos` (seccion 23): lo que
no sobrevive la frontera de RSC es el `Option` de Eden, no el `Select`. De paso corrige una
violacion de la regla 10 que el comentario del archivo justificaba con una premisa falsa — decia
que "el `Input` de Eden no admite `type=date`", que es cierto, pero `DateInput` existe.

### Regla para futuro

Un control nativo dentro de un `FormField` es un campo **sin etiqueta**, aunque se vea etiquetado.
Si hace falta un control que Eden no tenga, la etiqueta va con un `<Label htmlFor>` explicito como
hijo, no con la prop `label`. Y todo formulario nuevo vive en un componente con su prueba de axe:
en una pagina, nadie lo comprueba.

---

## 44) El mismo rango de fechas devolvia dos conjuntos distintos de eventos

### Problema

La bitacora tenia un solo modo de consulta —la particion de un agregado (PA-12)— con el rango de
fechas aplicado en memoria. Al agregar la lectura global (PA-13) aparecio un segundo modo, y los
dos tenian que responder lo mismo para el mismo rango.

### Sintoma

No se observo en ejecucion: se detecto al comparar las dos implementaciones. Un evento de las
20:00 de Mexico aparecia en el modo global bajo el dia correcto y **desaparecia** del modo por
identificador con ese mismo rango.

### Causa raiz

Dos fronteras de dia distintas para el mismo concepto. PA-13 particiona por `AUDIT#<dia>` con
`diaDeNegocio`, o sea medianoche de Mexico. El filtro en memoria comparaba `ocurridoEn`
—ISO-8601 UTC— contra la cadena `yyyy-mm-dd` del formulario, lo que pone la frontera en la
medianoche **UTC**: seis horas antes. Las seis horas entre 18:00 y 24:00 de Mexico caian, para el
filtro, en el dia siguiente.

El defecto ya existia antes de PA-13 —el filtro siempre habia comparado contra UTC— pero era
invisible porque no habia una segunda respuesta con la que contrastarlo.

### Solucion aplicada

`eventoCoincideConFiltros` convierte `ocurridoEn` a dia de negocio con `diaDeNegocio` y compara
etiqueta contra etiqueta. El contrato de `FiltrosDeBitacora.desde`/`.hasta` pasa de "ISO-8601 UTC"
a "dia de negocio `yyyy-mm-dd`", y con eso desaparece `finDeRango`, el parche que extendia un
`hasta` sin hora al final del dia UTC. Un `ocurridoEn` ilegible deja de coincidir con cualquier
rango: la bitacora es prueba, y ante un dato que no se puede interpretar se calla en vez de
adivinar.

### Regla para futuro

Cuando dos lecturas responden la misma pregunta de negocio, sus fronteras se comparan **en la
misma unidad**. Aqui la unidad es la etiqueta de dia de negocio, que es la que esta en la clave;
un ISO-8601 UTC y un `yyyy-mm-dd` de Mexico no son comparables aunque las dos sean cadenas que
ordenan bien por separado.

---

## 45) La bitacora no podia responder "toda la actividad de esta persona"

### Problema

Un auditor tiene que poder seguir a un participante o revisar un tipo de evento en un periodo. La
pantalla solo aceptaba "dame la historia de este identificador".

### Sintoma

Reportado al revisar el proceso de auditoria: era dificil encontrar los identificadores con los
que buscar. El sintoma de superficie —hay que teclear un ULID— escondia tres huecos distintos.

### Causa raiz

Tres, y solo el primero era el que se veia:

1. **PA-13 nunca se leyo.** El patron estaba declarado desde la Etapa 0 y `eventos.ts` escribia su
   clave (`AUDIT#<dia>` en GSI2) en cada evento desde la Etapa 5, pero ningun codigo la
   consultaba. Sin esa lectura, toda busqueda exigia conocer de antemano el identificador.
2. **No habia perfil de participante.** El *upsert* que documentan las secciones 8 y 31 nunca se
   implemento, asi que la bitacora solo tenia `actorId` —el `sub` de Okta— y no habia de donde
   sacar un nombre ni un correo con los que poblar una lista de personas.
3. **`actorId` no responde "de quien es este evento".** Un vencimiento, una omision o un
   descongelamiento los firma `SISTEMA`. Buscar por actor habria dado una respuesta que **parece
   completa y no lo es**, que para un auditor es peor que no responder.

### Solucion aplicada

`consultarBitacoraGlobal` (PA-13, una `Query` por dia del rango, acotado a 31 dias),
`registrarPerfil` desde `getSession()` —una vez por proceso y por persona, de mejor esfuerzo— y
`consultarActividadDeParticipante`, que une lo firmado con la historia de las solicitudes de esa
persona y desduplica por `eventoId`.

**Del *upsert* pendiente se implemento solo la mitad.** El diseno original preveia acunar tambien
un `participanteId` propio, un ULID distinto del `sub`. Eso ya no se puede hacer: `actorId` guarda
el identificador vigente cuando se escribio cada evento y la bitacora es append-only, asi que
cambiar la identidad ahora partiria en dos la historia de cada persona —lo anterior con su `sub`,
lo nuevo con su ULID— y sin forma de unirlas. `participanteId` se queda siendo el `sub`.

Y los identificadores dejaron de teclearse: los dos campos son selects poblados desde la bitacora
del rango, con etiquetas legibles resueltas por lectura por lote. Se pueblan **de la bitacora y no
del catalogo de entidades** a proposito: asi toda opcion ofrecida devuelve resultados.

### Regla para futuro

Un patron de acceso declarado y con su clave escrita **no esta implementado**. `eventos.ts` llevaba
dos etapas escribiendo `AUDIT#<dia>` sin que nada lo leyera, y ni la compuerta ni el plan lo
notaron: escribir una clave de indice no cuesta nada visible y su ausencia de lectores no falla.
Al cerrar una etapa que declara un patron, comprobar que existe el servicio que lo consulta.

---

## 46) El truncamiento de la bitacora global descartaba lo mas reciente

### Problema

`consultarBitacoraGlobal` acota cuantos eventos acumula (`LIMITE_DE_EVENTOS_GLOBAL`), porque un
rango de 31 dias puede traer todos los eventos del sistema de un mes y eso no cabe en una pantalla
ni debe caber en un render.

### Sintoma

No lo produjo ninguna prueba: lo delataron los datos reales del sandbox al contar los eventos por
particion de dia antes del recorrido en navegador.

```
2026-09-08 -> 3069 eventos     (la prueba de carga de la Etapa 12)
2026-09-07 ->   52
resto del rango -> 0
```

El rango por defecto trae 3 121 eventos contra un tope de 2 000, asi que la pantalla abre avisando
que trunco — correcto. Lo que no era correcto es **cual mitad se queda**: los eventos del dia mas
reciente no aparecian, y las opciones de los selects se armaban con los 52 del dia anterior.

### Causa raiz

La lectura recorria los dias en orden **ascendente** —el mismo orden en que
`diasDeNegocioEntre` los entrega— y cortaba al llegar al tope. En una bitacora eso es al reves de
lo que se necesita: lo que sobra tiene que ser lo mas viejo. El efecto se amplificaba en los
selects, porque `ordenadas` los presenta por actividad mas reciente y esa era precisamente la que
se habia quedado fuera del cupo.

Que las pruebas no lo vieran tiene una razon concreta: todas afirmaban **cuantos** eventos
devolvia y si avisaba del truncamiento, ninguna **cuales**.

### Solucion aplicada

Recorrer los dias del mas nuevo al mas viejo, cada particion con `ScanIndexForward: false`,
acumular hasta el cupo y voltear una vez al final para presentar cronologico. Sigue sin ordenarse
nada en memoria: un `reverse` no es un `sort`.

Los dias pasan a leerse **en secuencia y no en paralelo**, y no es un costo sino la contrapartida
del orden: en secuencia se deja de consultar en cuanto se llena el cupo — con estos datos, un dia
en vez de treinta y uno—, y el caso lento (recorrer los 31) es exactamente el caso en que casi no
hay datos y cada `Query` es barata.

Se pide **un evento mas** que el cupo restante para poder distinguir "cabe justo" de "no cabe": sin
ese extra, un rango que llena el tope exacto se reportaria como truncado sin serlo y mandaria al
auditor a acotar un rango que ya estaba completo.

### Solucion aplicada, segunda parte

El mismo tope tenia un segundo efecto, y se vio al revisar la pantalla en el navegador. La busqueda
por **tipo de evento** reusaba la lectura sin filtrar del rango —la que arma las opciones de los
selects— y la filtraba en memoria, para ahorrar una consulta. Con truncamiento eso responde de
menos: `LOTE_ADJUDICADO` devolvia **483** filas y con el filtro en DynamoDB devuelve **841**. Y
peor que el numero: las 483 venian marcadas como truncadas, que le dice al auditor "acota el
rango" cuando lo que hacia falta era exactamente lo contrario.

`consultarPorTipoDeEvento` reusa la lectura previa **solo si no trunco** —en ese caso contiene todo
el rango y filtrarla da el mismo conjunto, sin consulta extra— y si trunco vuelve a preguntar con
`FilterExpression`, para que el cupo se llene con eventos del tipo pedido. Cuesta el mismo RCU que
la primera lectura, porque DynamoDB cobra lo leido y no lo devuelto.

### Regla para futuro

Una prueba de truncamiento que solo afirma la **cantidad** no prueba nada: hay que afirmar
**cuales** sobreviven. Y todo tope que se aplique sobre datos ordenados tiene un sentido correcto y
uno incorrecto — hay que escribir en el codigo cual es y por que, porque los dos compilan y los dos
pasan las pruebas de cantidad.

Y una optimizacion que **reusa** un resultado acotado hereda su recorte: solo es valida si ese
resultado estaba completo. Reusar una lectura truncada no ahorra una consulta, cambia la respuesta.

## 47) `satisfies readonly (keyof T)[]` no exige exhaustividad, y una edicion se perdia en silencio

### Problema
`CAMPOS_VEHICULO` y `CAMPOS_CONVOCATORIA` son la lista de campos capturables, y de ellas dependen
dos cosas: `camposModificados` —lo que decide si hay algo que escribir y que campos anota el
evento— y el reenvio de errores del formulario, que recorre la lista para volver a marcar los
controles con el mensaje del servidor.

Al agregar `numeroEconomico` y `numeroDeSerie` al tipo `DatosVehiculo`, la lista se quedo sin
ellos.

### Sintoma
Editar el numero economico de un vehiculo devolvia `{ ok: true }` **sin escribir nada**. Ni la
transaccion ni el evento salian, y la pantalla mostraba "Cambios guardados".

`npm run typecheck` estaba limpio y las 2 073 pruebas pasaban.

### Causa raiz
```ts
export const CAMPOS_VEHICULO = [...] as const satisfies readonly (keyof DatosVehiculo)[];
```

`satisfies` comprueba que **cada elemento sea** una clave valida. No comprueba que esten **todas**.
Es una direccion sola: protege de escribir un campo inexistente y no dice nada de uno olvidado. La
anotacion parece una garantia de correspondencia con el tipo, y solo la mitad lo es.

Lo que lo volvio invisible: `camposModificados` filtra la lista, asi que un campo ausente no
produce error — produce un arreglo mas corto. Cero cambios es un caso legitimo (evitar un evento
"editado" que no edito nada), asi que el camino de "no hay nada que hacer" ya existia y se tomo sin
protestar.

### Solucion aplicada
Los dos campos entraron en `CAMPOS_VEHICULO`, y en `src/lib/domain/{vehiculos,convocatorias}.test.ts`
quedo una prueba que compara la lista contra las claves del literal que devuelve
`normalizar*`, que el compilador **si** obliga a cubrir entero:

```ts
expect([...CAMPOS_VEHICULO].sort()).toEqual(
  Object.keys(normalizarDatosVehiculo(validos)).sort(),
);
```

La referencia no es arbitraria: `normalizarDatosVehiculo` declara su retorno como `DatosVehiculo` y
lo construye con un literal, asi que agregar un campo al tipo rompe **ahi** en compilacion. La
prueba solo traslada esa garantia a la lista.

### Regla para futuro
Una lista de nombres de campos derivada de un tipo necesita una comprobacion de **exhaustividad**,
y `satisfies` no la da. La forma barata es anclarla a un literal completo que el compilador ya
vigile.

Y el sintoma a reconocer: un cambio que devuelve exito sin escribir es peor que un error. Todo
camino de "no hay nada que hacer" merece la pregunta de que pasaria si se tomara por equivocacion —
aqui el precio era una edicion perdida con acuse de recibo.

## 48) React 19 reinicia el formulario al terminar la action, y el rechazo del servidor quedaba sobre campos vacios

### Problema
Los dos formularios de alta muestran los errores del servidor por campo (seccion 26). Con el
`duplicado` de la Etapa 11.2 aparecio un rechazo nuevo: el que **solo** el servidor puede emitir,
porque lo decide un centinela de unicidad dentro de la transaccion. La pantalla tiene que permitir
corregir ese campo y reenviar.

### Sintoma
Tras cualquier rechazo del servidor, **todos los campos quedaban vacios** y los mensajes de error
senalaban campos en blanco. En la convocatoria se perdian ademas la descripcion enriquecida, el
tipo elegido y las seis mitades de fecha y hora; el navegador anadia encima su
`Please fill out this field.` sobre cada requerido.

No lo veia ninguna prueba: las de la seccion 26 comprueban el `validationMessage`, que si llegaba.

### Causa raiz
**React 19 reinicia el formulario cuando la action termina**, y lo reinicia a `defaultValue`. Es
deliberado —lo normal es que una action exitosa deje el formulario limpio— y aplica igual cuando la
action devuelve un error. `defaultValue` venia de `valores`, que en el alta esta vacio.

Con el editor enriquecido hay una segunda causa encadenada: **Lexical solo lee `initialContent` al
montar**. Devolver el contenido capturado en esa prop no alcanza, porque el componente no se
remonta y la prop nueva se ignora en silencio.

### Solucion aplicada
El estado de `useActionState` gana `capturado?: Record<string, string>`: el adaptador devuelve el
`FormData` tal como llego —cadenas crudas, sin normalizar, porque hay que repintar lo que la
persona escribio, incluido un modelo que no es un numero— y el componente lo usa como primera
opcion de `defaultValue`:

```tsx
const inicial = (campo: keyof DatosVehiculo): string =>
  (estado.estado === "error" ? estado.capturado?.[campo] : undefined) ??
  valores[campo]?.toString() ??
  "";
```

Las claves son nombres de **control**, no campos del dominio: `publicadaEnFecha` y `publicadaEnHora`
son dos, porque Eden no tiene un campo combinado de fecha y hora.

Para el editor hace falta forzar el remontaje: un contador de rechazos como `key`.

```tsx
const [intento, setIntento] = useState(0);
useEffect(() => {
  if (estado.estado === "error") setIntento((previo) => previo + 1);
}, [estado]);
...
<RichTextEditor key={intento} initialContent={inicial("descripcionParticipacion", ...)} />
```

### Regla para futuro
Todo formulario con `action` y errores por campo tiene que **devolver lo capturado**; sin eso, la
validacion del servidor es inservible en la practica. Y un componente de terceros que solo lee su
valor inicial al montar necesita `key`, no una prop nueva — la prop no falla, se ignora.

Lo que hizo el defecto invisible: las pruebas afirmaban el **mensaje** y nunca el **valor**. Un
error correctamente senalado sobre un campo vacio pasa cualquier prueba de mensajeria.

## 49) La compuerta empezo a fallar en un archivo distinto en cada corrida

### Problema
Terminada la Etapa 11.2, `npm run verify:rapido` fallaba una o dos pruebas por corrida y
**pasaba** al ejecutar esos mismos archivos por su cuenta.

### Sintoma
Siempre `Test timed out in 5000ms` y siempre en la prueba generica de accesibilidad, pero **en un
archivo distinto cada vez**: `FormularioConvocatoria`, luego `CatalogoConvocatorias`, luego
`FiltrosDeBitacora`. Aparte, `infraestructura.test.ts` cruzaba su limite de 30 s.

### Causa raiz
Dos limites quedaron chicos, y por la misma razon: el trabajo crecio.

`axe` recorre el arbol renderizado con decenas de reglas, y los componentes de Eden montan sus
propias hojas de estilo que jsdom reparsea. El formulario de convocatoria con el editor
enriquecido tarda ~1 s **solo**; con las 128 suites en paralelo, cualquiera de las pesadas cruza
los 5 s por omision. Que el archivo culpable cambiara de corrida es justo lo que delata la
contencion de maquina: si fuera una prueba lenta en particular, fallaria siempre la misma.

Y la sintesis de la pila de CDK pasa de 30 s con los nueve GSIs de la Etapa A —43 s medidos con el
archivo solo—, mientras `backend.test.ts`, que sintetiza lo mismo, ya estaba en 120 s.

### Solucion aplicada
El limite de las dos pruebas genericas se fija **en `genericTests`** y no archivo por archivo: el
defecto era de la utilidad compartida, y ponerlo en cada `vi.setConfig` obligaria a recordarlo cada
vez que un componente engorda. `infraestructura.test.ts` se iguala a los 120 s de
`backend.test.ts`.

### Regla para futuro
Una compuerta que falla **a veces** se empieza a reintentar en vez de leerse, y ese es el peor
resultado posible: el dia que falle de verdad, el reflejo va a ser volver a correrla. Un limite de
tiempo tiene que dejar margen para la contencion, no ajustarse a la medicion de un archivo solo.

Y la senal a reconocer: si el archivo que falla cambia de corrida, no se busca el defecto en ese
archivo.

## 50) Las fotografias dejaron de cargar y no habia ningun error en ninguna parte

### Problema
Al editar un vehiculo con fotografias, la galeria aparecia vacia: los recuadros dibujados y las
imagenes sin cargar. Se reporto como "las ligas parece que estan rotas", que es exactamente lo que
parece desde la pantalla.

### Sintoma
Ningun error. Consola del navegador limpia, nada en el servidor, la pagina 200, el HTML con sus
`<img>` y su `src` firmado con la forma correcta —`Expires`, `Signature`, `Key-Pair-Id`—. Solo
`naturalWidth` en cero.

### Causa raiz
La Etapa 11.2 hizo `npx ampx sandbox delete` y redespliegue para crear los nueve GSIs en una sola
operacion. Eso **crea una distribucion de CloudFront nueva**, con otro dominio, y `.env.local` se
quedo con el de la anterior.

Firmar contra un host que ya no existe no produce un error de firma ni un 403: produce una peticion
que no llega a ningun lado. Medido con `curl`: la distribucion vieja no resuelve a ninguna
direccion —CloudFront conserva el nombre sin direcciones— y la nueva responde `403` a una peticion
sin firma, que es lo correcto.

Y el bucket **si** coincidia, porque se retiene al borrar el sandbox. Es lo que hace el desfase tan
difícil de ver: las fotografias siguen existiendo, con la misma clave, y el codigo que las sirve no
cambio.

### Solucion aplicada
`CLOUDFRONT_DOMAIN` corregido, y `configuracionDeFirma` **compara el entorno con
`amplify_outputs.json` en desarrollo** y falla nombrando la variable, el valor local y el
desplegado. Lo comparado es puro y probado (`desfasesConElSandbox`); leer el archivo se memoriza,
porque la funcion corre una vez por fotografia y por peticion. Sin salidas en disco no reporta
nada: quien trabaja sin sandbox propio no tiene por que ver un error.

**No se corrige el valor sobre la marcha.** Tomar el dominio de `amplify_outputs.json` cuando el
entorno discrepa seria el fallback silencioso que prohibe la regla 15, y dejaria `.env.local`
mintiendo para siempre.

Verificado en el navegador en los dos sentidos: con el dominio viejo la pantalla responde 500 con el
mensaje y **cero** imagenes; con el corregido, 200 y las dos fotografias con `naturalWidth` de
1946 y 640.

### Regla para futuro
Recrear el sandbox invalida todo valor de `.env.local` que apunte a un recurso **reemplazable**: la
distribucion cambia, la tabla cambia, el bucket no. Y de esos, el unico cuyo desfase es **silencioso**
es el dominio de CloudFront — una tabla equivocada lanza `ResourceNotFoundException` en la primera
lectura.

La senal general: una configuracion que se duplica entre dos fuentes necesita una comprobacion que
las enfrente. Si el sintoma del desfase no es un error, la comprobacion no es opcional.

## 51) `KeyConditionExpression` no admite dos condiciones sobre la misma clave

### Problema
La Etapa 11.2 convirtio el rango de fechas de la bitacora en una condicion de **clave** en lugar de
un filtro. El limite superior tenia que ser **exclusivo** —la medianoche del dia siguiente— para no
necesitar el centinela `U+FFFF` que `gsi2.cotaSuperiorPorFecha` usa en PA-05.

La expresion natural para eso son dos comparaciones:

```
cronoSK >= :desdeCrono AND cronoSK < :hastaCrono
```

### Sintoma
`ValidationException: Invalid KeyConditionExpression: KeyConditionExpressions must only contain one
condition per key`, y con ella un 500 en `/auditoria`.

**Ninguna prueba lo detecto.** Las 18 pruebas del lector afirmaban la cadena exacta de la
`KeyConditionExpression` y pasaban en verde: `clienteDynamoFalso` captura comandos, no los evalua,
asi que acepta cualquier expresion — incluida una que DynamoDB rechaza. Aparecio en el primer
recorrido con el navegador.

### Causa raiz
DynamoDB admite **una sola condicion por clave** en una `KeyConditionExpression`. Para un rango de
dos extremos sobre la clave de ordenamiento existe `BETWEEN`, y solo `BETWEEN`.

### Solucion aplicada
`BETWEEN`, y el limite superior sigue siendo exclusivo **sin centinela**:

```
cronoSK BETWEEN :desdeCrono AND :hastaCrono   -- :hastaCrono = medianoche siguiente
```

`BETWEEN` es inclusivo en los dos extremos, pero `cronoSK` es `<ocurridoEn>#<eventoId>` y toda
cadena ordena despues que su propio prefijo: un evento ocurrido exactamente en esa medianoche tiene
`cronoSK` **mayor** que la cota y queda fuera. La misma propiedad que obligaba a inventar un
centinela cuando la cota era el ultimo instante del rango trabaja a favor cuando la cota es la
medianoche siguiente, donde no puede haber ningun evento ambiguo.

### Regla para futuro
Un doble que **captura** comandos no puede validar **expresiones**. Sirve para afirmar que se pide
la particion correcta, con el indice correcto y sin filtro; no dice nada sobre si DynamoDB acepta la
sintaxis. Toda expresion nueva —de clave, de condicion o de filtro— necesita al menos un recorrido
contra la tabla real antes de considerarse terminada.

Es la misma leccion que la seccion 34 con `ampx sandbox`: hay clases de error que la compuerta no
puede ver porque su doble es mas permisivo que el sistema real.

## 52) El sondeo por valor era optimo para el peor caso y pesimo para el normal

### Problema
Las opciones de los dos selects de auditoria salen de los valores **distintos** con actividad en el
rango. Para no leer miles de eventos, GSI7 y GSI8 agrupan por valor antes que por tiempo y se
recorren saltando cada grupo con `ExclusiveStartKey`.

La primera version sondeaba con `Limit: 1`: un item por consulta, y el salto lleva al siguiente
grupo.

### Sintoma
La pantalla tardaba **20 segundos** en cargar, con cualquier filtro y en cualquier modo. Antes del
cambio tardaba entre 1,8 y 4,3 s. Todas las latencias eran casi identicas, que es la senal de un
costo fijo pagado en cada peticion.

### Causa raiz
El calculo del plan —"una consulta por valor distinto"— era correcto en **numero de consultas** y no
contaba la **latencia acumulada**. Con `Limit: 1`, 200 valores distintos son 200 viajes de red
encadenados: a ~80 ms cada uno, 16 segundos. El sondeo estaba afinado para el caso de un grupo
enorme (un lote con 3 288 eventos, que se salta con una consulta) y era el peor posible para el caso
normal, que es mucha gente y muchos vehiculos con pocos eventos cada uno.

Los dias tambien se recorrian en serie: 31 dias mas 200 sondeos, todo encadenado.

### Solucion aplicada
Dos cambios, y el primero es el importante:

1. **Leer una pagina (`Limit: 100`) en vez de un item**, extraer de ella todos los valores distintos
   y aplicar el salto **desde el ultimo grupo de la pagina**. El costo pasa a ser el mejor de los dos
   mundos: nunca mas de una consulta por grupo grande, y hasta cien valores en una sola consulta
   cuando los grupos son chicos. Medido: 60 vehiculos distintos en **una** consulta contra 60.
2. **Los dias en tandas de ocho**, concurrentes, procesadas en orden para no perder el criterio de
   "ultimo dia con actividad primero".

Resultado medido en el sandbox: **20,6 s -> 3,5 s**.

### Regla para futuro
Contar consultas no es medir latencia. N consultas **encadenadas** cuestan N veces el viaje de red,
y ese numero no aparece en ningun analisis de RCU. Cuando un recorrido se optimiza para un caso
extremo, hay que preguntar explicitamente cuanto cuesta el caso normal — aqui el diseno optimo para
"un grupo de 3 288 eventos" era el peor para "200 grupos de 3".

## 53) El barrido fallaba en el 100% de sus invocaciones desde que se desplego

### Problema
El Lambda de barrido (vencimientos + outbox, Etapa 10) se despliega cada 5 minutos via
`amplify/barrido/handler.ts`, que llama a `barridoDeVencimientos()` y `procesarOutbox()`.

### Sintoma
Descubierto siguiendo el propio runbook R-13 contra el sandbox real: la alarma
`barrido-con-errores` estaba en `ALARM`. El log de cada invocacion, sin excepcion, mostraba:

```
Error: This module cannot be imported from a Client Component module. It should only be used from a Server Component.
```

Ocurria en la fase `initStart` del Lambda — antes de que `handler` corriera una sola linea — y por
eso `storedBytes` del grupo de logs se veia en cero durante horas: no es que no hubiera invocaciones,
es que ninguna llegaba a producir un log de aplicacion.

### Causa raiz
El paquete `server-only` decide entre un no-op (`empty.js`) y un `throw` (`index.js`) segun la
condicion de exportacion de su `package.json` con la que se resuelva: `"react-server"` para el
no-op, `"default"` para el `throw`. El build de Next activa `"react-server"`; el Lambda de barrido
se empaqueta con `esbuild` puro via `NodejsFunction` (dentro de `defineFunction`), que no activa esa
condicion y siempre cae en `"default"`.

`barridoDeVencimientos.ts` y `procesarOutbox.ts` — y, transitivamente, 17 archivos de
`src/lib/fila`, `src/lib/data`, `src/lib/correo` y `src/lib/observabilidad` — llevaban
`import "server-only";`. Cualquier invocacion del Lambda cargaba ese import al inicializar el
modulo y reventaba antes de ejecutar nada, siempre, en cualquier entorno donde se desplegara —no
solo este sandbox.

Ninguna prueba lo vio porque Vitest no pasa por el mismo empaquetado: corre el TypeScript
directamente, sin la resolucion de condiciones de `esbuild`, asi que `server-only` nunca llegaba a
decidir entre sus dos ramas en los tests.

Se investigo y se descarto pasarle `--conditions=react-server` al `esbuild` de `defineFunction`:
la opcion publica `bundling` de `defineFunction` solo expone `minify` (`FunctionBundlingOptions` en
`@aws-amplify/backend-function`) — cualquier otra clave se descarta antes de llegar al
`NodejsFunction` de CDK, que si soporta `esbuildArgs` pero no es alcanzable desde aqui.

### Solucion aplicada
Se quito `import "server-only";` de los 17 archivos que el handler del barrido alcanza
transitivamente (el motor de fila, la capa de datos y observabilidad). Los otros 63 archivos de
`src/lib` que llevan la misma guarda **no** se tocaron: ninguno de los 17 es una decision de negocio
particular, son la capa de servicio que cualquier Lambda que hable con la tabla necesita, y ninguno
de ellos lo importa hoy un componente cliente.

### Regla para futuro
`"server-only"` protege la frontera Next.js cliente/servidor, no cualquier empaquetado de Node. Un
codigo que se ejecuta fuera del build de Next —una Lambda de Amplify, un script, un worker— puede
no compartir la condicion de exportacion que hace inofensivo ese import, y la unica forma de saberlo
es mirar los logs de una invocacion real despues de desplegar, porque Vitest no lo va a ver. Antes
de marcar "Lambda desplegada y probada" como hecho, invocarla al menos una vez —o revisar sus logs
si ya tiene un horario— y no solo verificar que la sintesis de CDK no truena.

## 54) Los archivos de 10 MB no podian llegar: el tope real eran 1 MB

### Problema
La aplicacion admite fotografias de vehiculo y comprobantes de pago de hasta 10 MB
(`MAXIMO_BYTES_FOTOGRAFIA` y `MAXIMO_BYTES_COMPROBANTE`), y los valida en el servicio despues de
tener los bytes en memoria.

### Sintoma
Lo encontro una auditoria externa leyendo el codigo, no un usuario, y ese es el dato interesante:
**estaba roto desde siempre para cualquier fotografia de celular**. El framework rechazaba el
cuerpo con un error genérico antes de entrar a la Server Action, asi que no pasaba por las
validaciones de tipo y tamano ni dejaba rastro en la auditoria.

### Causa raiz
Las Server Actions de Next.js tienen un tope de cuerpo de **1 MB por omision**
(`experimental.serverActions.bodySizeLimit`, sin configurar en `next.config.ts`). Ninguna prueba lo
veia porque **ninguna cruza la frontera HTTP**: las pruebas de action llaman la funcion exportada en
proceso y mockean el servicio, y la prueba del tope de tamano vive en la capa de servicio con un
bufer sintetico. `next-action` no aparece en ningun archivo del repo.

### Solucion aplicada
`bodySizeLimit: 11 * 1024 * 1024` en `next.config.ts`, y tres pruebas en `next.config.test.ts` que
atan ese numero a las constantes del dominio.

**El margen de 1 MB sobre los 10 no es holgura, tiene funcion.** El tope se aplica al cuerpo HTTP
crudo, incluidos los 10-20 KB que `multipart/form-data` agrega en fronteras y cabeceras de parte
—asi que `10mb` exacto no alcanzaria para un archivo de 10 MB justos—, y con el margen un archivo
que se pasa del limite del dominio **llega al servidor y lo rechaza la validacion del dominio con su
mensaje propio**, en vez de morir en el framework sin decir cual es el limite.

Se evaluo y se **difirio** la carga directa a S3 con URL prefirmada, que evitaria tener 10 MB en la
memoria del proceso SSR. No es solo trabajo nuevo: `almacenamiento.ts` documenta que la ausencia de
prefirmada es deliberada —con una, el cliente elegiria la clave del objeto— y hay una prueba que lo
fija. Cambiar eso es una decision de arquitectura, no el arreglo de este defecto.

### Regla para futuro
Un limite del framework y un limite del dominio son dos cosas, y el que manda es el menor. Cuando el
dominio declare una cota de tamano, la prueba tiene que atarla a la del transporte: sin eso, subir
`MAXIMO_BYTES_*` deja al framework rechazando en silencio. Y una capacidad que solo se ejercita
llamando al servicio en proceso **no esta probada de punta a punta**; si el defecto vive en el
transporte, hay que mirarlo en el navegador.

## 55) `LastEvaluatedKey` sin recorrer en cinco lecturas de la fila

### Problema
DynamoDB corta cada `Query` en 1 MB de datos **leidos** y entrega el resto tras un
`LastEvaluatedKey`. La misma auditoria encontro cinco funciones de `src/lib/fila` que no lo
recorrian: `adjudicarLote.leerFila`, `cerrarFilaDelLote.leerCerrables`, `leerFilaCompleta`,
`conteosDeFila` y `descongelarSolicitudes`.

### Sintoma
Ninguno observable a la escala actual, con una excepcion importante. Las cuatro primeras exigen
~1 700 solicitudes en **un** lote y la escala real son decenas. La quinta no: esta en otro eje.

### Causa raiz
Dos causas distintas que conviene no mezclar.

**Las cuatro primeras: la excepcion documentada se leyo como regla general.** La seccion 8.2 de
`modelo-datos-dynamodb.md` justifica leer una sola pagina en `leerVencidasDelDia` (PA-10) y
`leerPendientes` (PA-14), y lo hace apoyandose en tres propiedades: GSI4 es disperso, las dos leen de
viejo a nuevo, y el barrido es idempotente cada 5 minutos. **Ninguna de las tres aplica a las
lecturas de fila**: la particion `LOTE#<id>` conserva sus solicitudes terminales para siempre, asi
que una primera pagina truncada no se autocura — vuelve identica en cada corrida. El peor caso es
`adjudicarLote` escribiendo `FILA_AGOTADA` con candidatos vivos detras, o sea la bitacora afirmando
algo falso sobre la equidad de la fila.

**`descongelarSolicitudes` era un defecto de verdad, y su eje es el participante.** Combinaba
`Limit: 100` con un `FilterExpression`, y DynamoDB aplica el `Limit` **antes** de filtrar; sin
`ScanIndexForward` explicito el orden es ascendente sobre `GSI3SK` (`SOL#<solicitadoEn>#<loteId>`).
Resultado: se leian las 100 solicitudes **mas antiguas** de esa persona —las ya terminales— y sus
`CONGELADA` recientes quedaban detras, invisibles. Con mas de 100 solicitudes historicas, R-09
dejaba de devolver turnos **en silencio**: la funcion respondia cero, y un cero no distinguia "no
tenia congeladas" de "no las alcance a ver". No hace falta ningun dato raro para llegar ahi.

La regla que viola esa combinacion **ya era doctrina escrita** del proyecto, en
`barridoDeVencimientos.ts`, `consultarBitacoraGlobal.ts` y `consultarActividadDeParticipante.ts`. El
patron de recorrido estaba resuelto cuatro veces en `src/lib/auditoria/` y nunca se habia extraido.

### Solucion aplicada
`src/lib/data/paginacion.ts`: `paginasDeQuery` (generador), `itemsDeQuery` y `contarConQuery`. Los
cinco lectores pasan por ahi.

- `descongelarSolicitudes` conserva el tope de 100 pero **acotando resultados y no items leidos**.
- `conteosDeFila` **suma el `Count` entre paginas**: `Select: "COUNT"` no exime del corte de 1 MB, y
  paginarlo no trae items, asi que la garantia de R-12 sigue intacta.
- `leerFilaCompleta` gana ademas el `ConsistentRead` que le faltaba —sus dos hermanas ya lo
  llevaban— porque es la lectura contra la que el auditor contrasta la bitacora: una lectura eventual
  puede reportar diferencias que no existen, o dejar invisible la mutacion sin evento que la
  comprobacion 5 existe para atrapar. Esto no lo senalo la auditoria.
- El helper **no lleva tope de paginas**, a proposito: un tope seria el mismo defecto que viene a
  arreglar. Quien necesite acotar trabajo acota resultados, que es lo unico que quien llama sabe
  medir.
- Y **no lleva `import "server-only"`**, porque el Lambda del barrido alcanza `adjudicarLote.ts` y
  este modulo con el (seccion 53).

Las pruebas que faltaban son de dos paginas, con la primera trayendo solo estados terminales: es
justo la forma del caso real, porque son las terminales las que se acumulan al frente de la
particion.

### Regla para futuro
Una excepcion documentada vale **solo** para lo que enumera y por las propiedades que enumera. Antes
de reusar "aqui basta una pagina", hay que comprobar que las tres propiedades de 8.2 se cumplen: si
la lectura no es sobre un indice disperso que se vacia al resolver, o no hay una corrida siguiente
que retome donde quedo, no basta.

Y con `FilterExpression` de por medio, **una pagina puede volver vacia y traer `LastEvaluatedKey`**:
quien se detiene ahi concluye "no hay nada" con datos detras.

## 56) Una venta respondia exito aunque el cierre de la fila hubiera fallado

### Problema
`avalarPago` (T4) confirma la venta en una `TransactWriteItems` y **despues**, fuera de ella, cierra
la fila restante del lote llamando a `cerrarFilaDelLote`. Fuera de la transaccion porque son una
cantidad no acotada y `TransactWriteItems` admite 100.

### Sintoma
El error del cierre se convertia en `cerradas: 0` y la operacion salia como exito. Sin log, sin
metrica y sin valor de retorno distinguible: **nadie podia enterarse**. El tesorero ve la venta
hecha; los participantes ven una posicion en un lote ya vendido.

Y `0` era ambiguo por partida doble, porque `cerrarFilaDelLote` devuelve `exito(0)` legitimamente
cuando no habia nada que cerrar.

### Causa raiz
Un `cierre.ok ? cierre.data : 0` que trataba el fallo como un valor. Que fue descuido y no decision
lo prueba la asimetria dentro del propio repo: `concluirConvocatoria` hace el mismo llamado y
**propaga** el error (`if (!cierre.ok) return cierre;`). Solo `avalarPago` lo descartaba, y el
comentario que hay ahi explica por que el cierre va **fuera** de la transaccion, no por que su fallo
se ignora.

Contradecia la regla 15 de `CLAUDE.md` ("sin fallback silencioso") y la regla 16 (el camino de fallo
no tenia ni una prueba: el mock de `cerrarFilaDelLote` solo se resolvia `ok`).

### Solucion aplicada
Tres cosas, y **ninguna es revertir la venta**: esta confirmada y es correcto que lo este. Revertirla
convertiria un cierre pendiente en una venta deshecha, que es peor.

1. **Se registra.** `registrar("warn", "cerrarFilaDelLote", …)`, con `cerrarFilaDelLote` agregado al
   catalogo cerrado de `OPERACIONES` por el mismo criterio que las dos del barrido: su fallo no lo
   reporta ningun usuario.
2. **El resultado lo delata.** `ResultadoDeAval.cerradas: number` pasa a
   `cierre: { ok: true; cerradas } | { ok: false; error }`. La venta sale `ok` en los dos casos; lo
   que cambia es si quedo trabajo detras.
3. **Se reconcilia en minutos.** El barrido ya recorria los lotes de las convocatorias `PUBLICADA`
   buscando lotes `EN_OFERTA` con fila viva; ahora tambien cierra la fila de los que estan `VENDIDO`
   o `NO_VENDIDO`, donde una fila viva no tiene sentido. Es una condicion mas en el mismo recorrido:
   ninguna lectura extra. De paso cubre el otro modo de fallo — `cerrarFilaDelLote` corta en la
   primera tanda que falla, asi que una fila puede quedar cerrada a medias.

`cerrarFilaDelLote` acepta ahora `ActorDeEvento` y no solo `ActorUsuario`, porque la reconciliacion
la firma `SISTEMA`. Solo reenvia el actor a su evento, y el evento ya admitia los dos.

**La cuenta nueva (`filasCerradas`) no entra en `errores`.** Esa mide vencidas que no se pudieron
resolver y es lo que dispara `vencimientos-sin-resolver`, "el sintoma mas grave del sistema": meter
ahi un cierre fallido cambiaria lo que la alarma significa.

### Regla para futuro
Cuando una operacion irreversible deja trabajo pendiente fuera de su transaccion, hay **tres**
preguntas y no una: si se revierte (aqui no), como se **entera** alguien, y quien lo **repara**.
Contestar solo la primera deja el estado inconsistente y ciego a la vez.

Y ante dos invocadores del mismo helper que tratan su error de forma distinta, la diferencia es un
defecto o una decision documentada. Si no hay comentario que la explique, es un defecto.

## 57) El outbox podia enviar el mismo correo dos veces

### Problema
El barrido despacha el outbox cada 5 minutos, y su limite de ejecucion es de 300 s: dos corridas
**se solapan** y leen la misma lista de `PENDIENTE`. El propio comentario de `procesarOutbox` ya lo
decia.

### Sintoma
Ninguno todavia, y por una razon que conviene no confundir con estar a salvo: CES sigue sin aprobar
(R17), sus credenciales estan vacias y **no sale ningun correo**. El defecto era latente, no
inexistente.

### Causa raiz
`procesarUno` llamaba a CES **antes** de intentar el `Update` condicional a `ENVIADO`. Esa condicion
(`estatus = :pendiente`) garantizaba una sola escritura de estado y un solo evento `CORREO_ENVIADO`
—la bitacora nunca se duplico, dato que la auditoria omitio— pero se evaluaba cuando CES ya habia
aceptado. Dos corridas solapadas mandaban dos correos y solo una lo anotaba.

Y era **probable en el arranque**, no remoto: R17 hace que el outbox acumule pendientes *por diseno*,
asi que la primera corrida real empieza con toda la mora junta, la envia en serie, se pasa de los
300 s y se solapa con la siguiente.

### Solucion aplicada
Una adquisicion con plazo, antes de CES:

```
PENDIENTE --(Update condicional, leaseHasta = ahora + 15 min)--> ENVIANDO --> CES
   ENVIADO (con CORREO_ENVIADO, se retiran GSI4 y leaseHasta)
   PENDIENTE + intentos+1   si el fallo es reintentable
   FALLIDO (con CORREO_FALLIDO)  si no lo es, o si se agotaron los intentos
```

La condicion admite `PENDIENTE` **o** `ENVIANDO con plazo vencido`, que es la unica salida para un
mensaje cuya corrida murio despues de adquirirlo. El plazo es de 15 minutos porque **tiene que ser
mayor que el limite de ejecucion de la funcion**: mas corto, una corrida lenta veria vencer su propia
adquisicion mientras todavia envia.

El item **se queda en GSI4 mientras esta `ENVIANDO`**, para que el plazo vencido sea recuperable. Eso
obligo a un cambio pequeno y necesario: `aMensaje` fijaba `estatus: "PENDIENTE"` como literal —estar
en la particion `OUTBOX_PENDIENTE` *era* la definicion de pendiente, porque el indice es disperso— y
ahora lee el estatus real.

Ademas, **la corrida se acota por tiempo y no por cantidad de mensajes** (`PRESUPUESTO_DE_ENVIO_MS`,
120 s, medido con `performance.now()` por lo mismo que `conTraza`). El limite que hay que respetar es
el de ejecucion, y un tope de mensajes no lo garantiza: con CES lento cien se pasan, con CES rapido
mil no llegan a la mitad. Una corrida truncada es un retraso, no trabajo perdido — la misma doctrina
que 8.2.

**Lo que queda abierto, y no se puede cerrar desde aqui:** si el proceso muere entre que CES acepta y
que se escribe `ENVIADO`, el plazo vence y el mensaje se reenvia. CES no ofrece clave de
idempotencia —responde una confirmacion de envio, o la causa del error— asi que el reintento no
tiene forma de reconocerse como duplicado. El `id` que CES devuelve se guarda como `idExterno`, pero
sirve para rastrear, no para deduplicar. El dano acotado es lo que hace aceptable esa ventana: el
correo es un aviso informativo —monto, plazo y enlace a la pagina del lote—, sin token ni enlace de
pago, asi que un duplicado es molesto y no peligroso.

### Regla para futuro
Un efecto **externo** no lo protege una escritura condicional posterior. Si la llamada al tercero va
antes del `Update` que la registra, la condicion no impide el segundo efecto: solo impide el segundo
**registro**, que es precisamente lo que hace el defecto invisible en la bitacora. Adquirir primero
—con plazo, para no atascar el mensaje si el proceso muere— es el patron.

Y "es idempotente" hay que leerlo preguntando *para quien*: el barrido lo era para DynamoDB y no lo
era para el buzon del participante.

## 58) No se podia crear una convocatoria, y el mensaje senalaba lo que no era

### Problema
Alta de convocatoria con la descripcion de participacion real del negocio, que incluye la direccion
de contacto: "Envie un correo a ventavehiculos@churchofjesuschrist.org". El editor enriquecido tiene
el control de enlace habilitado y el usuario lo uso.

### Sintoma
El formulario no guardaba nunca. Arriba, el aviso generico "Revisa los datos capturados"; debajo del
editor, **"Please fill out this field."** — en ingles — sobre un campo visiblemente lleno. Escribir
mas texto no cambiaba nada, y el contador de caracteres del propio editor confirmaba que habia
contenido.

Son **dos defectos encadenados**, y el segundo es el que hizo el primero indescifrable.

### Causa raiz

**El rechazo: `mailto:` no estaba en la lista blanca.** `ENLACE_ADMISIBLE` de
`htmlDeDescripcion.ts` era `/^(https?:\/\/|\/)/i`. El motivo real viajaba en la respuesta
(`detalles: { descripcionParticipacion: "enlace_no_admitido" }`) y era correcto: la lista blanca
habia quedado **mas estrecha que los controles que el editor habilita**, que es exactamente lo que
la cabecera de ese archivo advierte que no debe pasar — "si se habilita uno mas, hay que agregarlo
aqui o el servidor rechazara lo que el editor acaba de producir". El comentario de la constante
nombraba `javascript:` y `data:` como lo que hay que bloquear, y `mailto:` no ejecuta nada.

**El mensaje enganoso: la descripcion era el unico campo cuyo error del servidor no podia
mostrarse.** Y por dos razones independientes, las dos por como Eden arma el editor. El
`RichTextEditor` monta **dos** `textarea` hermanos: uno con `name`, que serializa el HTML para el
`FormData`, y otro con `required` y el texto plano, que es el que valida el navegador y el que Eden
resuelve con `document.getElementById(id)` para su `onValidate`. Ese segundo **no tiene `name`**.

1. `validarConElServidor` buscaba el motivo con `erroresDelServidor.current[control.name]`, y ahi
   llegaba `""`.
2. El efecto que reevalua los controles al volver del servidor los busca con
   `formulario.elements.namedItem(nombre)`, que devuelve el `textarea` **con** `name`. El evento
   `validate` se despachaba sobre el hermano equivocado: burbujea hacia los ancestros y **nunca
   alcanza a un hermano**, asi que el control que Eden escucha no se reevaluaba.

Con las dos, el `setCustomValidity` nunca llegaba, y lo que quedaba visible era la validacion nativa
del navegador — que decia "rellena este campo" porque es lo unico que sabe decir, no porque el campo
estuviera vacio.

### Solucion aplicada
`mailto:` admitido en `ENLACE_ADMISIBLE`, con su razon escrita; un `validarDescripcionConElServidor`
que nombra el campo en vez de leerlo del control; y el efecto despachando `validate` tambien sobre
`textarea[required]:not([name])`.

Se busca **por forma y no por la clase de Eden**: un `textarea` con `required` y sin `name` es
precisamente "el control que valida un campo cuyo valor vive en otro sitio". Si Eden le pone nombre
algun dia, la prueba falla en vez de que el mensaje desaparezca en silencio.

Son dos funciones planas y no una currificada porque `react-hooks/refs` rechaza que una funcion
creada en render devuelva otra que lee un ref.

### Lo que costo, y por que conviene anotarlo
Dos hipotesis se investigaron y se **descartaron con evidencia** antes de llegar a la real, y las dos
parecian sensatas leyendo el codigo:

- Que Eden no sembrara sus `textarea` desde `initialContent` al montar — `SerializePlugin` usa
  `registerUpdateListener`, que en teoria no dispara al montar. Una prueba lo refuto: en jsdom los
  dos `textarea` quedan poblados.
- Que el HTML de Lexical no pasara la lista blanca por `class`, `dir`, `style` o `<span>`. Se midio
  el HTML real que produce el editor y **es limpio** (`<p>…</p><p>…</p>`), y el validador lo acepta.

Lo que cerro el caso no fue leer codigo: fue **el payload de la peticion rechazada**, con
`detalles` dentro. Un defecto de formulario se diagnostica mirando lo que el servidor contesto,
no adivinando en el cliente.

### Regla para futuro
Dos reglas, y la segunda es la que ahorra tiempo.

**La lista blanca de HTML y los controles del editor son una sola decision en dos archivos.** Al
tocar `CONTROLES_DEL_EDITOR` o `ETIQUETAS_PERMITIDAS`/`ENLACE_ADMISIBLE`, hay que mirar el otro. La
prueba del caso `mailto:` existe para eso.

**Un campo cuyo control de validacion no es el que lleva el `name` necesita su propio camino**, y
conviene sospecharlo de cualquier componente compuesto de una libreria: el `name`, el `id`, el
`required` y el valor pueden estar repartidos en elementos distintos. La comprobacion es barata —
listar los controles del formulario con su `name`, `id` y `required`— y es lo que hubiera senalado
esto en un minuto.

## 59) El pie de una foto de la galeria de Eden es `title`, no `caption`

### Problema
Poner el texto de cada fotografia **debajo de su miniatura** en la pantalla del lote, y quitar el
nombre del vehiculo que aparecia dos veces seguidas.

### Sintoma
`GalleryImageItem` documenta una prop `caption` —"Text to describe or go along with this media
item"—, y pasarsela no pinta nada. Con el nombre del vehiculo como `title` de la galeria, la
pantalla mostraba "Toyota Prius 2021" en un `H3` y otra vez en el `H1` de abajo.

### Causa raiz
Dos hechos que solo estan en el codigo del paquete, no en su documentacion:

- **`MediaThumbnailGallery` lee el `title` de cada hijo** y lo pasa como `description` al
  `Thumbnail`, que es quien lo pinta debajo de la imagen. `caption` viaja unicamente al visor
  ampliado (`MediaModal` lo reenvia a `ItemLayout`); mas aun, `ModalImage` hace
  `delete props.caption` y `delete props.title` antes de renderizar la imagen, asi que por si solas
  ninguna de las dos llega al DOM de la miniatura.
- **El `title` de la galeria se pinta como `H3` *despues* de la tira de miniaturas**, no antes. No
  es un encabezado de seccion: es un pie de la tira. Con el nombre del vehiculo ahi y el `H1` de
  identificacion inmediatamente debajo, el nombre salia duplicado y pegado.

### Solucion aplicada
`title={foto.descripcion}` en cada `GalleryImageItem`; `title=""` en la galeria, con el encabezado
de la seccion puesto por la pagina como un `H2` propio.

**Y `alt=""` cuando la foto tiene pie.** Lo encontro axe, no una revision: `genericTests` fallo con
"Alternative text of images should not be repeated as text". Tenia razon — el lector de pantalla
anunciaba dos veces lo mismo, porque el pie ya es el nombre accesible del boton que abre la foto.
Sin pie, el `alt` sigue siendo el nombre del vehiculo: una imagen sin alternativa **si** es un
defecto. El `alt` y el pie no son dos copias del mismo dato; son la alternativa *o* el texto
visible, nunca los dos.

### Regla para futuro
**En un componente compuesto de Eden, la prop que se ve en pantalla se confirma en su codigo, no en
su lista de props.** La API declarada de `GalleryImageItem` es la de `ModalImage` —el visor—, y la
tira de miniaturas consume otras. Un `grep` de la prop en `node_modules/@churchofjesuschrist/<paq>/lib/es`
cuesta un minuto y dice quien la lee y donde la pinta. Es la misma leccion que el `Option` de
`Select` (seccion 28) y que los dos `textarea` del editor (seccion 58): **el codigo gana siempre**,
tambien sobre la documentacion del propio paquete.

Y **antes de escribir un `dl` con su CSS, buscar el componente**: existe `eden-description-list`
(`DL`/`DT`/`DD`) y hace exactamente eso con los tokens de Unity. La ficha tecnica se habia escrito a
mano con un `.css` propio; se reemplazo y el archivo se borro (regla 10).

## 60) En movil se cortaba la pantalla entera, no solo la galeria

### Problema
Que las pantallas publicas quepan en un telefono (regla 12).

### Sintoma
En una ventana angosta —360 px— la pantalla del lote quedaba cortada **por la derecha**: la tarjeta
"Tu participacion" perdia su borde y su texto, la ficha tecnica se salia, y la tira de miniaturas
mostraba media foto sin forma de llegar a las demas. `document.documentElement.scrollWidth` daba 380
con `clientWidth` de 360, y **todas** las pantallas se salian esos 20 px, no solo esta.

### Causa raiz
Dos desbordes independientes, con la misma mecanica: **un elemento de rejilla aporta su ancho de
`min-content` como minimo de la columna**, y una columna `auto` no baja de ahi aunque el contenedor
sea mas angosto. El contenedor se queda del ancho de la ventana y los hijos se salen.

- `main.detalle-lote` es una rejilla y la galeria es uno de sus hijos. La tira de miniaturas pide
  464 px —cuatro miniaturas de 100 px con sus huecos— asi que la columna crecia a 464 y **arrastraba
  a los demas hijos**: el encabezado, la tarjeta de accion y la ficha median 464 dentro de un `main`
  de 348. El sintoma parecia de la galeria y el efecto era de toda la pagina.
- `.envoltura` es otra rejilla, de tres filas, y el `WorkforceHeader` de Eden no baja de unos
  380 px. De ahi los 20 px que se salian en cualquier pantalla, incluidas las que no tienen galeria.
  Este era **previo** y no lo habia notado ninguna revision.

Lo que enmascaraba el segundo: una captura `fullPage` de Playwright **ensancha el lienzo hasta el
`scrollWidth`**, asi que una pagina que desborda sale entera y bien encuadrada. El defecto solo
aparece con la captura del area visible, o midiendo `scrollWidth` contra `clientWidth`.

### Solucion aplicada
`min-inline-size: 0` en los hijos de las dos rejillas (`.detalle-lote > *` y `.envoltura > *`). Con
el minimo en cero la columna se queda en el ancho disponible, cada hijo se encoge, y la galeria pasa
a usar el desplazamiento horizontal que `ScrollTrack` ya le da —con sus flechas— que es para lo que
Eden la envuelve. No hizo falta tocar la galeria.

Es el mismo remedio que ya llevaban las secciones de `FormularioConvocatoria`, donde se habia
descubierto por el otro camino: un `fieldset` con un campo largo.

### Regla para futuro
**Toda rejilla o flex que contenga algo de ancho intrinseco grande —una tabla, una tira de
miniaturas, un bloque de codigo, una URL sin espacios— necesita `min-inline-size: 0` en sus hijos.**
Es el caso por omision, no la excepcion: `min-width: auto` es el valor inicial y casi nunca es el
que se quiere.

Y **la comprobacion de movil es `scrollWidth` contra `clientWidth`, no una captura**. Una captura
`fullPage` miente por construccion. Dos lineas en el navegador dicen si la pagina desborda y que
elemento lo hace.

## 61) La galeria rebotaba al pulsar su flecha en pantalla angosta

### Problema
Recorrer la tira de miniaturas con las flechas de `ScrollTrack` en un telefono.

### Sintoma
Al pulsar la flecha derecha la tira avanzaba y, a mitad del movimiento, **retrocedia unos pixeles**:
una sensacion de rebote. Ademas, con la tira "desplazada del todo" seguia quedando contenido sin
alcanzar. Solo se notaba en pantalla angosta.

### Causa raiz
`ScrollTrack` le pone al carril `margin-left: 44px` **solo cuando aparece** la flecha izquierda, con
`transition: margin .3s ease-out`. La flecha aparece en cuanto `scrollLeft > 0`, o sea a mitad del
desplazamiento que uno acaba de pedir. Ese margen **estrecha el visor**, y como `scrollLeft` no
cambia, el contenido visible se corre a la derecha: retrocede.

Medido en la galeria del lote a 360 px, con la x de la primera miniatura:

| Momento | Visor | `scrollLeft` | Tope | x de la 1.ª |
| --- | --- | --- | --- | --- |
| Reposo | 226 | 0 | 228 | 48 |
| 80 ms | 226 | 106 | 228 | −58 |
| 200 ms | 218 | 226 | 236 | **−170** |
| 350 ms | 182 | 228 | 272 | **−136** |

34 px de retroceso, a los ~350 ms. Y el tope de desplazamiento sube de 228 a 272 —el visor mas
angosto deja 44 px mas de contenido fuera—, que es por lo que la tira ya no llega al final.

Es proporcional al ancho: los dos huecos de 44 px son 88 de un carril de 270 en un telefono —un
tercio— y 88 de 900 en escritorio, donde ademas suele no haber desborde y el efecto no existe.

### Solucion aplicada
En `globals.css`, reservar **los dos** huecos en cuanto hay desborde, con cualquiera de las dos
flechas presente:

```css
.eden-scroll-track__fade.eden-scroll-track--has-left,
.eden-scroll-track__fade.eden-scroll-track--has-right {
  margin-inline: 44px;
}
```

Asi la geometria no cambia durante la interaccion y no hay nada que rebotar. Sin desborde no hay
clases, los margenes siguen en cero y la tira usa el ancho completo: en escritorio no se pierde
espacio. Verificado a 360 px —`scrollLeft` solo crece, visor y tope constantes— y a 1000 px
—`maxScroll: 0`, margenes en cero—.

**Se descarto superponer las flechas** (margenes en cero y los botones cabalgando sobre la tira),
que daria mas ancho util y tambien fija la geometria: se probo y **las flechas dejan de poderse
pulsar**, la miniatura intercepta el clic. Ninguno de los tres paquetes —`eden-scroll-track`,
`eden-fade`, `eden-media-thumbnail-gallery`— declara un solo `z-index`, asi que arreglarlo seria
rehacer el apilamiento del componente. El precio de reservar es un hueco vacio a la izquierda antes
de desplazar; el de la derecha ya lo reservaba Eden.

### Regla para futuro
**Un ancho que depende del estado del desplazamiento es un rebote esperando ocurrir.** Cuando un
carrusel decide su tamano segun "hay mas contenido hacia ese lado", la decision cambia justo durante
el movimiento. La forma de matarlo es reservar el espacio desde el principio, no acortar la
animacion.

Y **la prueba es la geometria en el tiempo, no la captura**: medir visor, `scrollLeft` y la x de un
elemento a los 80, 200 y 350 ms muestra el retroceso como un numero. A ojo solo se sabe que "algo
salta".

## 62) El panel de desarrollo se veia en escalera

### Problema
El conmutador de identidad simulada lista siete personas con sus permisos debajo del nombre.

### Sintoma
Cada renglon arrancaba en una x distinta —"Gina Gaytan" muy metida, "Dario Duarte" casi al borde—,
como una escalera. El bloque ya tenia `text-align: left`.

### Causa raiz
`.eden-button` es un `inline-flex` con `justify-content: center`, asi que **centra el bloque** de
nombre + permisos dentro del boton. El ancho del bloque es el de su contenido, y el texto de
permisos mide desde "Auditar" hasta "Comprar en venta a empleados · Comprar en venta al publico
general": cada persona tiene un bloque de distinto ancho y por tanto un centrado distinto.

`text-align: left` no lo corregia porque alinea el texto **dentro** del bloque, no el bloque dentro
del boton. Son dos ejes distintos y es facil confundirlos.

### Solucion aplicada
`justify-content: start` en el boton, no en el bloque —asi alcanza tambien a "Dejar de simular",
que es texto suelto—. Verificado: las siete filas arrancan en la misma x.

### Regla para futuro
**Un boton de Eden con un bloque dentro necesita `justify-content` en el boton.** Vale para
cualquier boton con contenido de dos renglones o con icono mas texto. Si lo que se ve es contenido
descentrado y `text-align` no hace nada, el culpable es el `justify-content` del contenedor flex.

## 63) El ADR se recarga hablandole al servidor MCP por stdio, no transcribiendolo

### Problema
El paso 3 del protocolo del ADR es
`manage_adr(project, mode="update", content=<contenido de .claude/adr.md>)`, y hay que ejecutarlo
despues de **cualquier** `index_repository` (seccion 21).

### Sintoma
El ADR pesa ~68 KB. La unica forma aparente de pasarlo por la herramienta es que el agente lo lea
—unos 20 000 tokens— y lo **vuelva a escribir** completo en la llamada, otros 20 000. Ademas de
caro, es **inseguro**: 834 lineas de prosa con guiones largos, flechas, exponentes y acentos
reescritas a mano pueden perder una linea o mutar un caracter, y el fallo es **silencioso** —el
espejo queda corrupto y nadie se entera hasta que alguien lo lee meses despues—.

Y `manage_adr(mode="update")` **sin** `content` no sirve de atajo: devuelve el ADR almacenado en vez
de recargarlo del disco, y su respuesta se pasa del limite de tokens de un resultado.

### Causa raiz
`codebase-memory-mcp` es un servidor **stdio local**
(`~/.local/bin/codebase-memory-mcp.exe`, declarado en `~/.claude.json`), no un servicio remoto. Un
servidor stdio se puede invocar desde la terminal como cualquier proceso: el protocolo es JSON-RPC
delimitado por saltos de linea sobre `stdin`/`stdout`. Que el agente sea un cliente MCP no obliga a
que **toda** llamada pase por su contexto.

### Solucion aplicada
Un script que lanza el ejecutable, hace el saludo (`initialize` mas
`notifications/initialized`) y envia `tools/call` con el contenido **leido del disco**. El texto
nunca entra ni sale del contexto del agente, asi que no hay transcripcion posible: la carga es
exacta por construccion, y cuesta una llamada a la terminal en vez de 40 000 tokens.

El mismo script con `--verificar` pide `mode="get"` y compara **byte a byte** contra
`.claude/adr.md`. Eso convierte "creo que se subio bien" en un hecho comprobado: 68 547 bytes en los
dos lados, identicos.

### Regla para futuro
**Un servidor MCP de stdio es un proceso, y el contenido grande se le pasa desde el disco.** Cuando
una herramienta MCP pide como argumento algo que ya existe en un archivo —un documento, un volcado,
un lote de datos—, leerlo para volver a escribirlo es el camino caro y el unico que puede corromper
el dato. Comprobar en `~/.claude.json` si el servidor es `stdio`: si lo es, el atajo existe.

Y **toda carga masiva se cierra verificandola en la direccion contraria**. Subir y comparar cuesta
una llamada mas; sin ella, la unica prueba de que el espejo esta bien es que la subida no dio error,
que es justo lo que un truncamiento silencioso tambien parece.

## 64) El barrido volvio a caerse por `server-only`, y ahora hay una prueba que lo impide

### Problema
Que el Lambda del barrido arranque. Es la seccion 53 otra vez, reintroducida por la Etapa 13.

### Sintoma
Ninguno visible desde el repositorio: la compuerta en verde con 2 200 pruebas. Lo encontro un
recorrido del grafo de importaciones hecho a mano mientras se preparaba otro cambio —
`src/lib/fila/cerrarFilaDelLote.ts` lleva `import "server-only"` y el handler lo alcanza:

```
amplify/barrido/handler.ts
  -> src/lib/fila/barridoDeVencimientos.ts
    -> src/lib/fila/cerrarFilaDelLote.ts
```

Como el `throw` de ese paquete ocurre **al importar el modulo** y no al llamarlo, la funcion falla
en el arranque: el 100% de las invocaciones, igual que la primera vez.

### Causa raiz
La Etapa 13 agrego `reconciliarLotesPublicados` al barrido, y ese reconciliador **llama a
`cerrarFilaDelLote`**. La arista de importacion es nueva; el archivo, viejo. La correccion de la
seccion 53 habia quitado la guarda de los 17 archivos que el handler alcanzaba **en ese momento**,
y nada impedia que la lista creciera.

Es una clase de defecto que ninguna prueba del repositorio podia ver, y por dos razones a la vez:
Vitest no pasa por el empaquetado `esbuild` de `defineFunction`, y **todo el repositorio hace
`vi.mock("server-only", () => ({}))`**, que es justo lo que neutraliza el sintoma.

### Solucion aplicada
Quitar la guarda de `cerrarFilaDelLote.ts`, y **`amplify/barrido/alcance.test.ts`**: recorre el
cierre transitivo de importaciones desde el handler —resolviendo el alias `@/` y las rutas
relativas— y falla si algun archivo alcanzado lleva la guarda, **nombrando la cadena completa** que
llevo hasta el. No ejecuta nada: lee archivos como texto, que es la unica forma de verlo sin AWS.

Lleva dos afirmaciones mas que la principal, y las dos importan: que el recorrido encuentra decenas
de archivos —si el resolutor se rompiera, la comprobacion pasaria sobre una lista vacia— y que los
archivos de `src/lib` **fuera** del alcance del barrido si conservan la guarda, para que quitarla
"por consistencia" no pase inadvertido.

Verificada por mutacion: devolviendo la guarda a `cerrarFilaDelLote.ts`, la prueba falla e imprime
la cadena `handler -> barridoDeVencimientos -> cerrarFilaDelLote`.

### Regla para futuro
**Una restriccion sobre un conjunto que puede crecer necesita una prueba que recorra el conjunto, no
una lista escrita a mano.** "Estos 17 archivos no llevan la guarda" es un hecho con fecha de
caducidad: caduca la primera vez que alguien agrega una llamada. Lo que no caduca es "ninguno de los
que el handler alcance".

Y **si un `vi.mock` global neutraliza un sintoma, ninguna prueba unitaria va a encontrar ese
defecto.** El mock de `server-only` es necesario —sin el no se puede probar nada de `src/lib` en
Node— asi que la comprobacion tiene que vivir fuera de la ejecucion: analisis estatico del grafo.

## 65) Las variables de la consola de Amplify no llegan al Lambda del barrido

### Problema
Declarar `APP_ENV=pruebas` en un despliegue para que el barrido descarte los correos cuando no hay
configuracion de CES (seccion 63 de este documento y D-18).

### Sintoma
Ninguno todavia: se encontro leyendo `amplify/backend.ts` al responder **donde** se configura cada
variable, antes de desplegar. De haber llegado al ambiente de pruebas, el sintoma habria sido el
barrido fallando en el 100% de sus invocaciones — el mismo que la seccion 53 y la 64, por tercera vez
y por una causa distinta.

### Causa raiz
**Las variables de entorno de la consola de Amplify (*App settings > Environment variables*) llegan
al contenedor de build y al computo SSR de Next, pero no a una funcion creada con
`defineFunction`.** Esa funcion es un recurso de CDK en su propia pila: solo recibe lo que
`backend.ts` le pasa con `addEnvironment`.

`backend.ts` le pasaba `AUTOB_TABLE_NAME`, los cuatro `CES_*` y `APP_BASE_URL`. **`APP_ENV` no**,
porque se agrego para la aplicacion web y nadie miro el otro consumidor. El resultado habria sido:
la aplicacion web en `pruebas` y el barrido leyendo `undefined` -> `produccion` -> `throw` al faltar
CES, que es exactamente lo que el descarte de correos venia a evitar.

Lo que lo hace facil de pasar por alto es que **las dos mitades del sistema leen la misma variable
por caminos distintos**, y solo una es visible desde la consola.

### Solucion aplicada
`backend.barrido.addEnvironment("APP_ENV", process.env.APP_ENV ?? "produccion")`. Se resuelve en
sintesis desde el entorno del build, asi que el valor se sigue escribiendo **una sola vez** en la
consola; lo que cambia es que ahora tambien viaja al Lambda.

El respaldo es `produccion` y no `pruebas`: la omision tiene que cerrar. Y la prueba de sintesis
afirma el **valor** literal y no `Match.anyValue()`, porque un `anyValue()` dejaria pasar justo el
error que importa — que el respaldo fuera `pruebas`.

Consecuencia operativa, anotada en R-14: cambiar `APP_ENV` en la consola exige **redesplegar** para
que el Lambda vea el valor nuevo. El suyo se fija al sintetizar.

### Regla para futuro
**Al agregar una variable de entorno, preguntar quien mas la lee.** Este sistema tiene dos
ejecutores —el computo SSR de Next y el Lambda del barrido— y comparten `src/lib`, asi que un modulo
nuevo que lea `process.env` puede acabar en los dos. La consola solo configura uno.

La comprobacion es barata: buscar el modulo en el grafo de importaciones del handler
(`amplify/barrido/alcance.test.ts` ya lo recorre) y, si esta, agregar el `addEnvironment` **y su
afirmacion** en `amplify/backend.test.ts`.

## 66) El lock estaba desincronizado y solo lo delato el build: la compuerta no corre `npm ci`

### Problema
Que el build de Amplify instale dependencias.

### Sintoma
El build #3 del primer despliegue fallo con:

```
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and package-lock.json
          or npm-shrinkwrap.json are in sync.
npm error Missing: @opentelemetry/core@2.0.0 from lock file   (x4)
```

Todo verde en local: compuerta completa, 2 219 pruebas, `build` de Next. El desfase llevaba en el
repositorio **desde el 2026-09-08** —comprobado reponiendo el `package-lock.json` de commits
anteriores y corriendo `npm ci --dry-run` sobre cada uno— sin que nada lo delatara.

### Causa raiz
**`npm install` y `npm ci` no tienen el mismo contrato, y la compuerta solo ejercitaba el primero.**
`npm install` reconcilia `package.json` con el lock sobre la marcha y no se queja; `npm ci` exige que
coincidan **exactamente** y aborta si no. El desarrollo diario usa `install`; el despliegue usa `ci`.

Lo que faltaba eran cuatro entradas anidadas de `@opentelemetry/core@2.0.0`: varios paquetes de
Amplify —`@opentelemetry/resources` y `sdk-trace-base` dentro de `data-construct` y de
`graphql-api-construct`— lo piden con **version exacta**, y el lock solo tenia 2.8.0 y 2.11.0. Un
`npm install` resuelve eso sin escribir las entradas exactas; `npm ci` no lo perdona.

Es el mismo patron que las secciones 53, 64 y 65 de este documento: **un defecto que la compuerta
local no puede ver porque no ejercita el mismo camino que el despliegue.** Cuarta vez en el proyecto.

### Solucion aplicada
`npm install --package-lock-only`, que recalcula el lock sin tocar `node_modules`. El arreglo fue
quirurgico —**110 inserciones y 0 eliminaciones**: solo agrego las entradas que faltaban, sin subir
ni quitar ninguna version—, asi que no hay riesgo de arrastrar una actualizacion no querida.

Y para que no vuelva: **`scripts/verificar-lock.mjs`**, que corre `npm ci --dry-run` y falla
reproduciendo la salida de npm con los paquetes que faltan. Cuesta ~10 s sobre una compuerta de ~90 s
y va **primero** en `verify:rapido`, porque es lo mas barato y lo que invalida el resto. Tambien
disponible solo, como `npm run verify:lock`.

Verificado en las dos direcciones: exit 0 con el lock arreglado, exit 1 nombrando los cuatro
paquetes con el lock anterior repuesto.

### Regla para futuro
**Si el despliegue ejecuta un comando que la compuerta no ejecuta, ese comando es un hueco.** Aqui
era `npm ci`. La pregunta que lo encuentra —y que conviene hacerse al escribir cualquier
`amplify.yml` o pipeline— es: *que corre alla que no corra aca*. Cada respuesta es un fallo que se
va a descubrir minutos despues de empujar, no antes.

**Y una nota sobre `shell: true` en Windows**, que costo un intento: quitarlo para evitar el aviso
DEP0190 rompe el script con `spawnSync npm.cmd EINVAL`. Desde el endurecimiento de CVE-2024-27980,
Node **se niega** a lanzar un `.cmd` sin shell. Con npm en Windows el shell no es una comodidad: es
obligatorio, y el aviso de deprecacion es ruido que hay que aceptar.

## 67) Artifactory bloquea versiones de dependencias transitivas, y `npm ci` aborta en la primera

### Problema
Que el `npm ci` del despliegue termine de descargar.

### Sintoma
Con el lock ya sincronizado (seccion 66), el build siguiente corrio 100 s y fallo distinto:

```
npm error code E403
npm error 403 Forbidden - GET .../npm-ics/immutable/-/immutable-3.7.6.tgz
npm error 403 ... a package version that is forbidden by your security policy
```

**Y localmente funcionaba**, porque `node_modules` ya tenia `immutable@3.7.6` de antes de la
politica. El `npm ci --dry-run` del guardian tampoco lo veia: resuelve metadatos y **no descarga
tarballs**.

### Causa raiz
El Artifactory de la organizacion rechaza versiones por politica de seguridad, y no solo la que
fallo. Probando el tarball con el token —el mismo que funciona— se ve el patron:

| Paquete | 403 | Permitido |
| --- | --- | --- |
| `immutable` | 3.7.6, 3.8.2, 4.3.7 | **5.1.9** |
| `lodash` | 4.17.21, 4.17.23 | **4.18.1** |

O sea: **bloquea todo por debajo de un umbral**, no una version puntual. Las dos llegan por el
**codegen de GraphQL de Amplify** —`@ardatan/relay-compiler`, `@graphql-codegen/plugin-helpers`—,
que entra como dependencia **de desarrollo** de `@aws-amplify/backend-cli` y que en este proyecto
**nunca se ejecuta**: no hay recurso de datos GraphQL, `defineBackend({ barrido })` a secas.

Y `npm ci` **aborta en el primer 403**, asi que cada paquete bloqueado cuesta un ciclo de build
completo si se descubren de uno en uno.

### Solucion aplicada
`overrides` en `package.json` con la version mas baja que la politica admite: `immutable@^5.1.9` y
`lodash@^4.18.1`. Forzar un rango que el consumidor no pide es admisible aqui porque el consumidor
es codigo muerto en este proyecto, y en los dos casos es el mismo major.

**Y en vez de descubrirlos de a uno, se escanean todos.** Un script recorre los ~1 300 tarballs
distintos del lock con `HEAD` y el token, con concurrencia, y lista los que no responden 200. Tarda
unos segundos y sustituye N ciclos de build de ~3 min. Tras los dos overrides: ninguno bloqueado.

**Detalle que costo un paso extra:** `npm install` y `npm install --package-lock-only` **no producen
el mismo lock**. El primero reconcilia contra `node_modules` y descarto otra vez las entradas
exactas de `@opentelemetry/core@2.0.0` que `npm ci` exige — lo atrapo el guardian de la seccion 66
en la misma sesion en que se escribio. Despues de cualquier `npm install` hay que normalizar con
`--package-lock-only`.

### Regla para futuro
**Una dependencia que instala no es una dependencia que se pueda descargar en otra red.** Lo que
valida el token es el acceso; lo que valida la politica es cada tarball, y las dos preguntas son
distintas. Antes de un despliegue nuevo, escanear el lock completo: es barato y convierte N fallos
en serie en una sola respuesta.

**Y `node_modules` local es un cache que miente.** Un paquete instalado antes de que la politica
existiera sigue funcionando en la maquina para siempre. La unica comprobacion honesta es contra el
registro, no contra el disco.

## 68) Los nombres de alarma son unicos por cuenta: el segundo entorno no podia desplegarse

### Problema
Desplegar la pila del ambiente de pruebas en una cuenta donde ya existia un sandbox personal.

### Sintoma
`npm ci` y toda la creacion de recursos pasaron —tabla, bucket, CloudFront, Lambda, su horario— y al
llegar a la pila de alarmas:

```
amplify-...-AutobAlarmasE9514B0F-... | CREATE_FAILED | AWS::CloudFormation::Stack |
  Validation failed with 6 error(s). Call DescribeEvents to retrieve the full list of issues
```

Rollback de la pila entera. **Seis errores y seis alarmas**, y en los eventos de la pila anidada no
habia **ni un evento de recurso**: solo `DetailedStatus: VALIDATION_FAILED` sobre la pila. O sea que
CloudFormation rechazo antes de intentar crear nada.

### Causa raiz
**Los nombres de alarma de CloudWatch son unicos por cuenta y region**, no por pila. El prefijo era
`this.node.id` —la constante `"Alarmas"`—, asi que los seis nombres eran identicos en todo
despliegue. El sandbox personal los habia creado primero:

```
aws cloudwatch describe-alarms --alarm-name-prefix "Alarmas-"
  -> Alarmas-barrido-sin-ejecutar, -barrido-con-errores, -vencimientos-sin-resolver,
     -outbox-retrasado, -correos-fallidos, -contencion-de-transacciones
```

**Ninguna sintesis podia anticiparlo**, y esto es lo que hace al caso distinto de las secciones 53,
64, 65 y 66: alli faltaba ejercitar un camino; aqui la plantilla es **correcta**. Se confirmo
volcando la plantilla de la rama y pasandola por `aws cloudformation validate-template`, que no
reporta nada. Lo que colisiona no es el codigo: es el **estado de la cuenta**, que por definicion no
esta en el repositorio.

### Solucion aplicada
`prefijoDeNombres` como opcion **obligatoria** de `AlarmasAutob` —no opcional con respaldo, para que
no se pueda volver a una constante sin darse cuenta—, y `backend.ts` la deriva del contexto que
inyecta `ampx`: `<namespace>-<nombre>-<tipo>`, o sea `d2i0gloex3vqjp-main-branch` para una rama y
`icsmxautobwebapp-CesarLima-sandbox` para un sandbox.

**Deterministas y no aleatorios** a proposito: un nombre con parte aleatoria cambiaria en cada
recreacion de la pila y dejaria los runbooks apuntando a alarmas que ya no existen. Los runbooks ya
citaban las alarmas como `...-barrido-sin-ejecutar`, con prefijo variable, asi que no hubo que
tocarlos.

La prueba de sintesis afirma que los seis nombres empiezan por la identidad del backend **y que
siguen siendo seis distintos**. Verificada por mutacion: devolviendo el prefijo a `"Alarmas"`, falla.

### Regla para futuro
**Un nombre fisico que AWS exige unico por cuenta no puede salir de una constante del codigo.** La
lista es conocida y corta: alarmas de CloudWatch, buckets de S3, roles y politicas de IAM, tablas,
temas de SNS, grupos de logs. Si el nombre no lleva la identidad del entorno, el codigo funciona
hasta el dia en que alguien despliega un segundo entorno en la misma cuenta — y entonces falla en el
despliegue, no en la compuerta.

**Y el diagnostico de una pila anidada que "falla la validacion" sin eventos de recurso empieza en la
cuenta, no en la plantilla.** El atajo que lo resolvio en dos comandos: volcar la plantilla y pasarla
por `validate-template` —si pasa, el codigo no es el problema— y luego buscar en la cuenta los
nombres fisicos que esa pila quiere crear.

## 69) La imagen de Amplify trae Node 22 y la compuerta exige el LTS activo

### Problema
Que la fase `frontend` del despliegue ejecute la compuerta de calidad.

### Sintoma
El despliegue **completo** del backend salio bien —tabla, bucket, CloudFront, Lambda, horario,
alarmas— y despues `npm run test` fallo en **155 milisegundos**:

```
> festack-scripts test
Error: the active LTS version of node is required (currently 24).
```

`npm run typecheck` habia pasado justo antes, lo que despista: `tsc` no comprueba la version de Node
y `festack-scripts` si.

### Causa raiz
La imagen `amplify:al2023` trae **Node v22.18.0** y el proyecto declara `engines.node: "24"`.
`festack-scripts` compara contra el LTS activo y aborta antes de ejecutar una sola prueba.

El mismo desfase ya venia avisando durante `npm ci`, y se habia pasado por alto: decenas de
`npm warn EBADENGINE current: { node: 'v22.18.0' }`. Un aviso que se repite tantas veces deja de
leerse, que es exactamente como se pierde.

### Solucion aplicada
`nvm install` al principio de **las dos** fases de `amplify.yml`, con la version tomada de
`engines.node`:

```yaml
- nvm install $(node -p "require('./package.json').engines.node")
```

Tres decisiones dentro de eso:

- **Se deriva de `package.json` y no se escribe `24`.** Duplicar la version la dejaria derivando en
  silencio el dia que el proyecto suba de major, que es precisamente el fallo que acaba de ocurrir
  pero al reves.
- **Va antes del primer `npm ci` de cada fase**, no solo antes de las pruebas. Instalar con una
  version y ejecutar con otra es lo que producen los `EBADENGINE`.
- **En las dos fases**, porque cada una es un shell propio: la de `backend` tambien instala y
  sintetiza.

Se agrega `node -v` al inicio de la fase de build: una linea en el registro que dice con que version
corrio, para no volver a deducirlo de los avisos.

### Regla para futuro
**La version de Node del contenedor de build no es la del desarrollador, y nadie avisa.** Cualquier
proyecto con `engines` estricto tiene que fijarla en el `amplify.yml`; si no, funciona hasta que una
herramienta comprueba la version — y la que lo comprobo aqui fue la compuerta, o sea lo ultimo antes
de publicar.

**Y un aviso repetido cientos de veces es un aviso invisible.** Los `EBADENGINE` estaban en los
registros de los builds #2 a #5 y nadie —yo incluido— los leyo, porque venian entre cientos de lineas
de `npm warn`. Cuando un build falla, conviene buscar `EBADENGINE` explicitamente en el log antes de
descartar el entorno.

## 70) La suite pasaba en local y fallaba en el build: dependia del entorno

### Problema
Que la compuerta de calidad de la fase `frontend` refleje lo que dice la compuerta local.

### Sintoma
Con Node ya en 24, las pruebas **ejecutaron** y fallaron **doce** veces, en dos grupos que parecian
uno:

```
× el barrido recibe APP_ENV, y por omision es produccion
× nombra todas las variables que faltan        (x3, cloudfrontSigner)
× lanza si alguien pone FULL en un despliegue sin habilitar
× con ENABLE_DEV_TOOLS ausente usa EAS real
FAIL amplify/auditoriaInmutable.integracion.test.ts
FAIL src/lib/fila/fila.integracion.test.ts
FAIL src/lib/data/identificadoresUnicos.integracion.test.ts
  AccessDenied: ... not authorized to perform: sts:AssumeRole
```

### Causa raiz

**Grupo 1 — nueve pruebas dependian de que una variable NO estuviera.** Afirman cosas como "sin
`APP_ENV` la guarda lanza" o "sin las tres variables de CloudFront se nombra la que falta", y no
declaraban la ausencia: la heredaban del shell. En local funcionaba porque esas variables viven en
`.env.local`, que Vitest no carga. En el build **si estan**, porque son variables de la app de
Amplify: `APP_ENV=pruebas`, `ENABLE_DEV_TOOLS=FULL`, las de CloudFront.

Lo grave no era el build rojo. Era que **las guardas de seguridad pasaban en local por la razon
equivocada**: la mitad de las casillas de la matriz de `identidad-autorizacion.md` 4.1.2 era
inalcanzable con esas variables puestas. Una prueba que depende del entorno no prueba lo que dice.

**Grupo 2 — las pruebas de integracion se activaron en el build.** Su condicion era
`existsSync(amplify_outputs.json)`, y **la fase `backend` genera ese archivo**: `ampx
pipeline-deploy` lo escribe en el espacio de trabajo. Asi que en la fase siguiente la condicion se
cumplia, tres suites se activaban y fallaban al asumir el rol de computo SSR con `AccessDenied` —
correctamente: el rol del contenedor de build **no debe** poder asumir el rol de la aplicacion.

### Solucion aplicada

**Grupo 1 — un `setupFile` que borra las variables que deciden**
(`src/utils/entornoHermetico.ts`), sumado a los tres de festack. Se borran y no se fijan: la
ausencia es el estado por omision que las guardas tienen que tratar bien (regla 18), y cada prueba
que necesita un valor lo declara con `vi.stubEnv`. La lista es explicita y acotada — las de
autorizacion, las de firma de CloudFront y `ALARMAS_CORREO`—, no "todas las del proyecto".

**Grupo 2 — la condicion pasa a ser `puedeUsarBackendReal`** (`src/utils/backendUtilizable.ts`),
que exige las salidas **y** no estar en el contenedor de Amplify (`AWS_APP_ID`, que ese contenedor
define y ninguna maquina de desarrollo tiene). Reemplaza siete copias de la misma condicion.

Se descarto gatear por `CI`: `verify:rapido` la define para omitir el chequeo de desactualizados,
asi que apagaria estas pruebas en la compuerta local — y la regresion de concurrencia de la regla 16
vive precisamente ahi. Lo que hay que detectar no es "hay automatizacion", es "este proceso no puede
asumir el rol".

**Verificado corriendo la suite completa con el entorno del build**:
`AWS_APP_ID=... APP_ENV=pruebas ENABLE_DEV_TOOLS=FULL CLOUDFRONT_...=... npx vitest run`
-> 2 181 pruebas en verde, 7 suites de integracion omitidas. Y sin esas variables, las de
integracion siguen corriendo: 27 en verde contra DynamoDB real.

### Regla para futuro
**La compuerta local no prueba lo que el despliegue prueba si el entorno difiere, y difiere
siempre.** La forma barata de cerrarlo es correr la suite una vez con las variables del despliegue
puestas — literalmente el comando de arriba. Doce fallos que costaron dos ciclos de build se veian
en 70 segundos.

**Y una prueba que afirma "sin X pasa Y" tiene que borrar X, no suponer que falta.** Suponerlo la
vuelve una prueba sobre la maquina de quien la escribio. El sintoma es el peor posible: verde donde
no importa y rojo donde si, o —peor— verde en los dos sitios por razones distintas.

## 71) `APP_BASE_URL` con barra final rompe el callback de Okta, y vacia no caia al respaldo

### Problema
Apuntar la aplicacion desplegada a su propio dominio.

### Sintoma
Ninguno todavia: se encontro revisando la variable recien puesta en la consola, antes de probar el
login. El valor pegado del navegador llevaba **barra final**:
`https://main.d2i0gloex3vqjp.amplifyapp.com/`.

### Causa raiz
Los dos consumidores de `APP_BASE_URL` concatenan una ruta que **ya empieza con `/`**:

- `plantillas.ts` arma `${base}/convocatorias/<id>/lotes/<id>` para el enlace del correo.
- `auth0.ts` la pasa como `appBaseUrl`, y el SDK arma `${appBaseUrl}/auth/callback`.

Con barra final salen `https://host//convocatorias/...` y `https://host//auth/callback`. El primero
es cosmetico; **el segundo no coincide con la URL de callback registrada en Okta** y el login falla
con un error de redirect que no menciona la barra en ningun sitio.

Y al escribir la prueba del respaldo aparecio un segundo defecto, **preexistente**:
`process.env.APP_BASE_URL ?? "http://localhost:3000"` usa `??`, que solo atrapa `undefined`. Una
variable **borrada** en la consola queda como cadena vacia, pasa el `??` y deja `base = ""`: de ahi
salen rutas sin host. Es el caso mas probable de los dos, porque vaciar un campo es justo lo que se
hace al corregir un valor.

### Solucion aplicada
`urlBaseDeLaApp()` en `src/lib/entorno.ts` —sin `server-only`, porque el Lambda del barrido la
alcanza por la plantilla del correo—, usada por los dos consumidores. Recorta espacios, trata la
cadena vacia como ausente y quita las barras finales. Normalizar no oculta nada: las dos formas
designan la misma URL. Lo que si seria ocultar es inventar un dominio, y por eso el respaldo sigue
siendo `localhost`, que en un despliegue se ve de inmediato.

### Regla para futuro
**Una variable de configuracion que se concatena necesita normalizarse en el codigo, no en la
consola.** El valor lo pega una persona desde un navegador, que agrega la barra; confiar en que no
lo haga es confiar en que nadie use copiar y pegar.

**Y en configuracion, vacio no es lo mismo que ausente para `??`.** Donde el respaldo importe, la
comprobacion es de valor cierto (`valor ? valor : respaldo`) y no de nulidad. `requerido()` de
`auth0.ts` ya lo hacia bien con `if (!valor)`; esta linea no.

## 72) 500 en cada peticion: las variables de la consola no llegan al computo SSR

### Problema
Que la aplicacion desplegada responda.

### Sintoma
Build en `SUCCEED`, backend desplegado, y **500 en cada peticion**. En
`/aws/amplify/<appId>`:

```
⨯ Error: Falta configuracion de autenticacion requerida: AUTH0_DOMAIN
    at Object.<anonymous> (../../var/task/.next/server/middleware.js:7:3)
```

`AUTH0_DOMAIN` **si estaba** en la consola de Amplify —comprobado, 22 caracteres— y el Lambda del
barrido **si** habia recibido las suyas. La contradiccion aparente es lo que despista.

### Causa raiz
Dos hechos que juntos explican todo, y los dos se comprobaron en vez de suponerse:

1. **Las variables de la consola de Amplify llegan al contenedor de build, no al computo SSR.** Es
   la misma frontera de la seccion 65 (el Lambda), con el agravante de que aqui no hay un
   `addEnvironment` donde arreglarlo.
2. **Next no incrusta `process.env.X` por su cuenta.** Comprobado: compilando con
   `AUTH0_DOMAIN=MARCADOR-UNICO` y buscando el marcador en `.next/server`, **no aparece en ningun
   archivo**. Queda como lectura en ejecucion, y en ejecucion no esta.

Y la razon de que **nada de esto se vea en local**: `next start` carga `.env.local`, que esta en
`.gitignore` y por tanto no existe en el build. La maquina de quien desarrolla tiene las variables
por un camino que el despliegue no tiene — el mismo patron de la seccion 70, ahora en produccion en
vez de en las pruebas.

### Solucion aplicada
El bloque `env` de `next.config.ts` con una **lista explicita** de las variables que el servidor lee.
Next las sustituye en compilacion. Comprobado con marcador: quedan en cuatro chunks de
`.next/server` y en **cero** archivos de `.next/static`, o sea que no viajan al navegador.

Lo que las mantiene fuera del cliente no es este bloque sino que solo se lean desde modulos con
`import "server-only"`; el bloque respeta esa frontera, no la relaja.

**La lista es explicita y no un `env | grep`**, que era la receta mas corta: un barrido arrastraria
`NODE_AUTH_TOKEN` —credencial de Artifactory que no pinta nada en el artefacto desplegado— y las
credenciales de AWS del contenedor. Una prueba afirma que ninguna de esas ocho entra.

Una variable **vacia se omite** en vez de incrustarse como `""`: incrustada pasaria una guarda de
"esta puesta" y fallaria mas tarde con un valor absurdo; omitida, la lectura queda en ejecucion y
`requerido()` la nombra.

### Regla para futuro
**`.env.local` es la razon por la que "en mi maquina si funciona", y es invisible.** Esta en
`.gitignore` —correctamente— asi que el despliegue nunca la ve, y `next start` **si** la carga en
local: el mismo comando da resultados distintos en los dos sitios sin que nada lo diga. Al preparar
un despliegue, la pregunta es *que hay en `.env.local` que el entorno desplegado no tenga*.

**Y el sintoma "la variable esta puesta pero el proceso no la ve" ya salio dos veces** en este
proyecto, con dos causas distintas: el Lambda (65) y el computo SSR (esta). La generalizacion:
**la consola de Amplify configura el build, y cada consumidor fuera del build necesita su propio
camino** — `addEnvironment` para una funcion de CDK, el bloque `env` para el servidor de Next.

## 73) La lista blanca, otra vez mas estrecha que los controles del editor

### Problema
Escribir la descripcion de la participacion con el editor enriquecido: un enlace y una lista.

### Sintoma
Con texto simple, guarda. Con un enlace, el formulario responde **"El formato del texto tiene
elementos que no se admiten"** —el motivo `etiqueta_no_admitida`, distinto del
`enlace_no_admitido` de la seccion 58— y despues **no se recupera**: borrar todo y escribir una
sola letra sigue mostrando el mismo mensaje.

Y lo que mas despisto: **el mismo ejercicio pasaba en la maquina de desarrollo y fallaba en el
ambiente desplegado.**

### Causa raiz
Tres atributos que el editor emite por su cuenta y que la validacion no admitia. El primero se
encontro leyendo el paquete; los otros dos, **leyendo el HTML real que el navegador mando**:

| Atributo | Quien lo pone |
| --- | --- |
| `target="_blank"` y `rel="noopener"` en `<a>` | El exportador de `LinkNode` cuando se marca la casilla "abrir en pestana nueva" (`eden-rich-text-editor/lib/es/utils/html.js`) |
| `title` en `<a>` | Lexical, junto al `href`, sin que haya control que lo pida |
| `value` en `<li>` | Lexical, en **cada** elemento de lista, tambien en listas con vinetas |

La validacion admitia **un solo atributo y solo en `<a>`**: `HREF` exigia que el resto de la
etiqueta fuera exactamente `href="..."`. Habia incluso una prueba que fijaba ese rechazo, y parecia
una decision de seguridad cuando era una suposicion sobre el editor.

**La diferencia entre maquinas no era de entorno.** Era que solo una de las dos pruebas llevaba una
lista con vinetas, y `<li value="1">` es lo que caia. Se perdio una ronda de diagnostico buscando
una diferencia entre desarrollo y produccion que no existia.

Es la **tercera vez** que esta lista queda por detras de lo que el editor produce —antes fue
`mailto:` (seccion 58)— y la cabecera del propio archivo ya advertia que eso no debe pasar: *"como
el editor va con `availableControls` restringido, un usuario honesto nunca produce algo fuera de
esta lista"*. La advertencia estaba escrita; lo que faltaba era comprobarla.

### Solucion aplicada
Los atributos pasan a declararse **por elemento** (`ATRIBUTOS_POR_ETIQUETA`), con el patron de
valor de cada uno: en `<a>`, `target` solo `_blank`, `rel` solo combinaciones de `noopener` y
`noreferrer`, y `title` texto sin `<` ni `>`; en `<li>`, `value` solo digitos. `href` sigue
aparte porque su fallo tiene motivo propio.

**La propiedad que habia que conservar es que lo no reconocido caiga**, y por eso el patron va
anclado al principio y el resto se consume en bucle: un `matchAll` global habria reconocido los
atributos buenos e **ignorado la basura entre ellos**. Hay prueba de un `onclick=alert(1)` sin
comillas junto a un `href` valido.

Y la prueba que mas vale del archivo es la descripcion **real** que fallo, entera, como fixture: no
un caso inventado sino el texto que una persona escribio.

### Regla para futuro
**Una lista blanca de marcado se verifica contra el codigo del editor, no contra la intuicion.** La
pregunta no es "que etiquetas parecen razonables" sino "que emite exactamente el exportador de este
paquete". Y cuando una prueba fija un rechazo, conviene anotar de donde salio el caso: la que
afirmaba "rechaza cualquier atributo que no sea href" parecia seguridad y era una suposicion.

**Y ante "en mi maquina funciona", la primera pregunta es que dato entra, no que entorno corre.** Se
gasto una ronda comparando desarrollo con produccion cuando la diferencia estaba en el contenido: una
lista con vinetas. Lo resolvio pedir el HTML que el navegador mandaba — la misma leccion de la
seccion 58, que costo lo mismo aprender dos veces.

### Pendiente
El mensaje **no dice que elemento sobra**, y por eso cada caso de estos cuesta una ronda de ida y
vuelta con el payload. Nombrar el atributo ofensor en la respuesta convertiria el diagnostico en leer
la pantalla; exige llevar texto libre por `detalles`, que hoy solo transporta claves de diccionario.
