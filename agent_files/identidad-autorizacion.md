# Identidad y Autorizacion

Como se sabe **quien** entra (autenticacion), **que permisos** trae, y **que puede hacer sobre
cada recurso** (autorizacion).

La matriz exhaustiva de permisos vive en `permission-matrix.md`. Este documento explica el
mecanismo; aquel es la tabla de decision.

---

## 1. Principio rector

> La identidad la afirma Okta. Los permisos los afirma EAS. **La aplicacion no inventa ninguno de
> los dos, y si no puede obtenerlos, falla de forma explicita.**

Corolario directo de la regla 15 de `CLAUDE.md`: no hay fallback silencioso. Un EAS caido
produce un error visible, nunca un usuario con el conjunto de permisos vacio que parece un
participante legitimo sin acceso.

Segundo corolario, igual de importante: **la aplicacion tampoco inventa politica**. Quien puede
hacer que en la organizacion se configura en EAS; aqui solo se declara que permiso exige cada
accion y bajo que condiciones del recurso aplica.

---

## 2. Autenticacion — Okta OIDC

Se usa `@auth0/nextjs-auth0` v4 como cliente OIDC generico apuntando a **Okta**, no a un tenant
de Auth0. Es el mismo patron ya en produccion en `icsmx-camp-webapp`.

### 2.1 Cliente

`src/lib/auth/auth0.ts` instancia un `Auth0Client` de `@auth0/nextjs-auth0/server`.

Variables: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH_SECRET`,
`APP_BASE_URL`. Scope `openid profile email offline_access`.

**Patron obligatorio del helper `required()`:** durante `next build` no hay secretos
disponibles, y el modulo se importa igualmente al analizar rutas. El helper devuelve un valor de
relleno fuera de produccion y durante la fase de build, y **solo lanza** en produccion en
tiempo de ejecucion. Sin esto, el build falla en CI.

### 2.2 Rutas de autenticacion

**No se crean archivos bajo `src/app/api/auth/`.** El middleware del SDK v4 intercepta
`/auth/login`, `/auth/callback`, `/auth/logout` y `/auth/profile`. Crear Route Handlers propios
los duplicaria y romperia el flujo.

Es una de las tres excepciones a la regla 2 de `CLAUDE.md` — y ni siquiera requiere codigo.

### 2.3 `src/proxy.ts`

Next.js 16 renombro `middleware` a **`proxy`**. El archivo es `src/proxy.ts`.

Responsabilidades, en orden:

1. `await auth.middleware(request)` — atiende las rutas de autenticacion y refresca la sesion.
2. Resolver el idioma y exponerlo como cabecera para los Server Components.
3. En rutas autenticadas, fijar `Cache-Control: no-store` y generar el nonce de CSP.

El `matcher` excluye `_next/static`, `_next/image`, `favicon.ico`, `robots.txt` y `sitemap.xml`.

> **El proxy no autoriza.** Distingue publico de autenticado, nada mas. Las decisiones por permiso
> se toman en el Server Component o en la Server Action, con la sesion completa a la vista. Un
> middleware no puede conocer el contexto — de que convocatoria se trata, si la solicitud es del
> propio usuario — y autorizar ahi produciria reglas incompletas y duplicadas.

---

## 3. La sesion

`src/lib/auth/session.ts`, marcado con `import "server-only"`.

```ts
type Sesion = {
  participanteId: string;       // identificador interno estable
  oktaSub: string;              // claim `sub` de Okta
  correo: string;
  nombre: string;
  permisos: ReadonlySet<Permiso>;              // desde EAS
  tiposDeConvocatoriaPermitidos: TipoConvocatoria[];  // derivado de los permisos de venta
};
```

**La sesion no lleva roles.** EAS no los expone (seccion 4), asi que la aplicacion nunca los ve
fuera del simulador de desarrollo.

`getSession()` devuelve `Sesion` o `null`. Nunca lanza por ausencia de sesion; lanza si EAS
falla (ver 4.2).

Secuencia:

1. `auth.getSession()` → identidad de Okta (`sub`, `email`, `name`). Si no hay, devuelve `null`.
2. Upsert del participante en DynamoDB por `oktaSub` → obtiene `participanteId` estable.
3. Consulta de permisos a EAS — **una sola, con el catalogo completo** (seccion 4.3).
4. Derivacion de `tiposDeConvocatoriaPermitidos` (seccion 5).

El paso 2 existe porque el `sub` de Okta es largo y opaco; se necesita un identificador propio
para las claves de DynamoDB y para la bitacora, y un lugar donde registrar la primera vez que
el participante entro.

### 3.1 Uso

- **Server Component:** `const sesion = await getSession(); if (!sesion) redirect(...)`.
- **Server Action:** siempre `getSession()` primero, `puedeEjecutar()` despues, y solo entonces
  delegar al servicio. Nunca al reves.

Nunca se envia el objeto `Sesion` completo al cliente. Los componentes reciben solo lo que
necesitan mostrar.

---

## 4. Permisos — EAS

**EAS no expone roles.** La aplicacion le envia nombres de permiso y recibe un **booleano por
cada uno**; los roles y caracteristicas del usuario viven dentro de EAS, que calcula los permisos
con sus propias reglas internas.

Eso fija el reparto de responsabilidades del sistema: **EAS decide la capacidad, la aplicacion
decide la aplicabilidad** (seccion 0 de `permission-matrix.md`). La consecuencia practica es que
ninguna politica organizacional se escribe aqui. "Un administrador no compra" es cierto hoy
porque EAS no le concede permisos de venta, no porque el codigo se lo impida.

**`Autob_Adjudicar_Convocatorias`** se suma en la Etapa 15 (R-23): habilita la bandeja del
adjudicador y la adjudicacion manual del ganador. Como los otros siete, **su nombre esta pendiente
de confirmar con el equipo de EAS** (riesgo R19); hasta entonces se trabaja con el simulador, donde
lo concede el rol `ADJUDICADOR`.

Que ese rol no reciba permisos de venta es la misma conveniencia de desarrollo que rige para el
administrador —quien decide quien gana no compite por lo que reparte— y, como aquella, **es
configuracion de EAS y no una regla programada**.

### 4.1 Adaptador conmutable

`src/lib/auth/eas.ts` elige entre implementacion real y simulada segun `ENABLE_DEV_TOOLS`:

| Valor | Efecto |
| --- | --- |
| `OFF` | Solo EAS real. **Unico valor admisible en produccion** |
| `MOCK_USERS` | Permisos simulados a partir de un rol, para desarrollar sin EAS |
| `FULL` | `MOCK_USERS` mas el **conmutador de identidad simulada** de la seccion 4.1.1: elegir con quien se recorre la aplicacion, sin reiniciar y por navegador |

La simulacion razona en **roles** porque es como piensa el equipo, y los traduce a permisos con
la tabla de la seccion 8 de `permission-matrix.md`. `DEV_TOOLS_MOCK_ROLES` elige los roles;
`DEV_TOOLS_MOCK_PERMISOS` se salta la tabla y fija permisos sueltos para casos borde que ningun
rol representa.

> **El concepto de rol no sale del simulador.** Solo tres archivos lo conocen:
> `rolesSimulados.ts` (la tabla), `personasSimuladas.ts` (el roster) y `eas.ts` (que lee
> `DEV_TOOLS_MOCK_ROLES`). Ningun archivo del negocio importa `Rol`.
>
> La compuerta de la Etapa 2.1 enunciaba esto como "ningun archivo fuera de `rolesSimulados.ts`",
> y **eso nunca fue cierto**: `eas.ts` lo importa desde el primer dia. El `grep` a mano no lo
> delato. Lo que la invariante protege no es un archivo, es la frontera entre `src/lib/auth` y el
> negocio, y desde la Etapa 2.2 la verifica `rolesSimulados.test.ts` recorriendo el arbol de
> fuentes — no una revision manual.

`src/lib/auth/devMode.ts` expone `exigirModoSeguro()`, que **lanza** si el modo no es `OFF` en un
despliegue compilado que no lo haya habilitado explicitamente. Se invoca justo antes de usar el mock
(en `eas.ts`), no al importar el modulo — importar tambien ocurre durante `next build`, y ahi no
debe lanzar. Es una salvaguarda deliberada: el modo de desarrollo nunca debe poder activarse por
accidente en produccion.

El entorno lo declara `APP_ENV` (`produccion` | `pruebas`), y **ausente o desconocido se asume
`produccion`**. Esa asimetria es la propiedad que importa: olvidar la variable deja las herramientas
bloqueadas, no abiertas (regla 18).

#### 4.1.1 Impersonacion de identidad — modo `FULL`

Simular permisos no alcanza para recorrer la aplicacion, y la razon es concreta: **hay guardas
que no dependen de ningun permiso, sino de la identidad.**

1. `convocatoria:aprobar` deniega `self_approval` cuando `creadoPor === participanteId`. Quien
   crea una convocatoria no puede aprobarla — es la regla, no un defecto—, asi que el dictamen
   **no se puede recorrer** con una sola identidad, por muchos permisos que se le concedan.
2. La fila FIFO no tiene orden con un solo participante. Sin turno 2 no hay congelamiento, ni
   reasignacion por cancelacion, ni vencimiento que reasigne a nadie.

`DEV_TOOLS_MOCK_ROLES` no resuelve ninguna de las dos: cambia los permisos, no el
`participanteId`, que sale del `sub` de Okta. De ahi el modo `FULL`.

**Roster cerrado, no captura libre.** `src/lib/auth/personasSimuladas.ts` declara siete personas
en codigo, y la cookie `autob_persona_simulada` **solo lleva el `id`**, validado contra ese
roster: un valor desconocido se ignora. La consecuencia es la que importa — la cookie no puede
inyectar una identidad ni un permiso arbitrarios, como maximo elige entre esas siete filas. Por
eso no hay campos de texto en la interfaz. Para combinaciones que ningun rol representa sigue
estando `DEV_TOOLS_MOCK_PERMISOS`.

| Persona | Permisos que recibe | Para que sirve en las pruebas |
| --- | --- | --- |
| Ana Alcantara | administrar vehiculos y convocatorias | alta, inclusion de lotes, publicacion, conclusion |
| Beto Berrones | aprobar convocatorias | dictaminar lo que creo Ana, sin auto-aprobacion |
| Carla Cordero | venta a empleados y en general | primer turno de la fila |
| Dario Duarte | venta a empleados y en general | segundo turno: congelamiento y reasignacion |
| Elena Estrada | solo venta en general | comprobar que la tercera pata del gating **deniega** |
| Fabio Fuentes | operar tesoreria | avalar y rechazar comprobantes |
| Gina Gaytan | auditar | solo lectura, sin ninguna mutacion |

Dos detalles del roster que no son cosmeticos: el `participanteId` lleva prefijo `dev-`, para que
al leer un evento de la bitacora del sandbox sea evidente que el actor era simulado; y los
correos estan en un dominio `.invalid`, reservado por el RFC 2606 para nombres que no pueden
existir, de modo que un despacho accidental del outbox (Etapa 10) no alcance a nadie real.

**La cookie es por navegador, no por servidor.** Es lo que hace util al conmutador: dos ventanas
—o una normal y una de incognito— son dos participantes simultaneos, y con eso la fila se puede
recorrer a mano.

La impersonacion solo funciona si **ya existe una sesion real de Okta**. Nunca sustituye la
autenticacion, solo los permisos y la identidad de negocio: `getSession()` exige la sesion de
Okta **antes** de mirar la cookie, y `oktaSub` conserva el valor real — es el unico dato que
sigue respondiendo quien esta conduciendo la sesion. La barra lo muestra a proposito, porque
confundir "con quien navego" con "con quien inicie sesion" es la forma mas facil de depurar la
pantalla equivocada.

Tres condiciones se exigen **las tres** para cambiar de persona (`src/app/actions/devTools.ts`):
modo `FULL`, `NODE_ENV` distinto de `production` y sesion real de Okta. La action **no pasa por
`puedeEjecutar`**, y no debe: no hay permiso que cubra "elegir con quien navego", y crearlo seria
codificar en EAS una herramienta de desarrollo (regla 17).

#### 4.1.2 Tabla de verdad de `ENABLE_DEV_TOOLS` x `APP_ENV`

Las dos variables juntas deciden si la autorizacion de una peticion es **real** o **simulada**, y
esa es la decision mas consecuente de la configuracion. La tabla es la especificacion, y
`src/lib/auth/modoYEntorno.test.ts` la recorre **completa** —las 40 combinaciones, incluidos los
valores invalidos y ausentes— para que no pueda quedar en buena intencion.

Tres desenlaces posibles, y ninguno mas:

| Desenlace | Que hace la aplicacion |
| --- | --- |
| **EAS** | Autorizacion real. `eas.ts` consulta EAS con el `oktaSub` de la sesion |
| **SIMULADO** | Autorizacion simulada. No se consulta EAS; los permisos salen de `DEV_TOOLS_MOCK_ROLES`/`DEV_TOOLS_MOCK_PERMISOS` |
| **LANZA** | La peticion falla con un error explicito. La aplicacion queda inservible hasta que se corrija la configuracion — es el fallo cerrado |

**En un despliegue compilado** (`NODE_ENV=production`, que es lo que Amplify Hosting usa en **toda**
rama):

| `ENABLE_DEV_TOOLS` | `APP_ENV` ausente | `APP_ENV=produccion` | `APP_ENV=pruebas` | `APP_ENV` invalido |
| --- | --- | --- | --- | --- |
| ausente | EAS | EAS | EAS | EAS |
| `OFF` | EAS | EAS | EAS | EAS |
| invalido (p. ej. `ON`) | EAS | EAS | EAS | EAS |
| `MOCK_USERS` | **LANZA** | **LANZA** | SIMULADO | **LANZA** |
| `FULL` | **LANZA** | **LANZA** | SIMULADO | **LANZA** |

**En local** (`NODE_ENV` distinto de `production`), `APP_ENV` es irrelevante:

| `ENABLE_DEV_TOOLS` | Cualquier `APP_ENV` |
| --- | --- |
| ausente, `OFF`, o invalido | EAS |
| `MOCK_USERS` o `FULL` | SIMULADO |

Lo que la tabla garantiza, y conviene leerlo como propiedades y no como casillas:

1. **Solo una casilla de un despliegue da SIMULADO por cada modo simulado**, y exige que las **dos**
   variables esten puestas a proposito. Ninguna omision llega ahi.
2. **`ENABLE_DEV_TOOLS=OFF` es EAS en toda la fila**, sin importar `APP_ENV`. Declarar el entorno
   como pruebas no enciende nada por si solo.
3. **Un valor invalido de `ENABLE_DEV_TOOLS` es EAS, no LANZA.** Cae del lado seguro con un aviso en
   el registro. Ojo con la consecuencia practica: `ENABLE_DEV_TOOLS=ON` **no habilita nada** —los
   tres valores son `OFF`, `MOCK_USERS` y `FULL`— y el sintoma sera que la aplicacion intenta
   consultar EAS de verdad.
4. **Un valor invalido de `APP_ENV` es LANZA, no SIMULADO.** `production` en ingles es el error
   probable y cae del lado seguro.
5. **La impersonacion es un subconjunto estricto de SIMULADO**: solo el modo `FULL`, y solo donde ese
   modo no lanza. `MOCK_USERS` nunca lee la cookie.

En las cinco filas de un despliegue, **la unica forma de tener autorizacion simulada es escribir dos
valores correctos**. No hay ninguna casilla donde una variable ausente, vacia o mal escrita conceda
mas de lo que concede `OFF`.

### 4.2 Adaptador real

`src/lib/auth/easAdapter.ts` consulta los permisos del usuario por su `oktaSub`, con
autenticacion por `EAS_API_KEY` y **timeout de 5 segundos** via `AbortController`.

Forma de la interaccion:

```
peticion   → { oktaSub, permisos: ["Autob_Administrar_Vehiculos", ...] }
respuesta  ← { "Autob_Administrar_Vehiculos": true, "Autob_Auditar": false, ... }
```

> **Contrato pendiente de confirmar con el equipo de EAS** (riesgo R19). Lo que ya esta
> confirmado por el operador es la semantica: se pregunta por permisos, se responde un booleano
> por permiso. Los nombres exactos, la ruta y la forma del sobre HTTP pueden cambiar; por eso el
> parseo vive aislado en este archivo y nada mas deberia necesitar cambios.

Reglas firmes:

- **Sin fallback silencioso** (regla 15 de `CLAUDE.md`). Fallo de red, timeout o respuesta
  invalida producen un error, no un conjunto vacio. Un usuario sin permisos y un EAS caido deben
  verse distintos.
- **Un permiso que se pidio y no viene en la respuesta es una violacion de contrato**, no un
  `false`. Tratarlo como negativo convertiria un cambio de contrato en "usuario sin permisos", que
  es indepurable: se veria como un problema de configuracion del usuario y no del despliegue.
- Un usuario **puede** tener varios permisos; ninguno excluye a otro.

### 4.3 Una sola consulta por peticion

Se pregunta por **el catalogo completo de permisos de la aplicacion en una sola llamada**, y el
resultado se memoiza con `cache()` de React durante la peticion. Preguntar permiso por permiso
multiplicaria las llamadas por cada pantalla.

El cache es **por peticion, nunca entre peticiones**: un permiso revocado debe surtir efecto en
la siguiente navegacion.

---

## 5. Tipos de convocatoria accesibles

Sustituye al antiguo `tipoParticipante`. Determina a que convocatorias se accede (R-02 de
`proyecto.md`), y ahora sale directamente de los permisos:

| Permiso | Habilita el tipo |
| --- | --- |
| `Autob_Venta_a_empleados` | `EMPLEADOS` |
| `Autob_Venta_en_general` | `PUBLICO_GENERAL` |

**Lo resuelve el servidor.** Nunca llega del cliente, ni de un parametro, ni de una cookie.

Un empleado recibe los dos permisos y ve ambos tipos; quien no lo es recibe solo el segundo. La
antigua regla "`EMPLEADO` es superconjunto de `OTRO_USUARIO`" desaparece del codigo: pasa a ser
una decision de configuracion de EAS, que es donde se puede cambiar sin desplegar.

> Antes esto se derivaba de que la lista de roles incluyera `EMPLEADO`. Esa derivacion era la
> causa raiz del defecto de composicion de roles que encontro la revision: `EMPLEADO` era a la
> vez un permiso de compra y el discriminador del tipo de participante, asi que un administrador
> necesitaba el rol de comprador solo para poder *ver*. Ver `desafios-implementacion.md`.

---

## 6. Autorizacion — `puedeEjecutar`

`src/lib/auth/permisos.ts`. Funcion **pura**: sin I/O, sin red, sin base de datos.

```ts
puedeEjecutar({ accion, permisos, contexto }): { permitido: true }
                                             | { permitido: false; razon: RazonDenegacion }
```

- `accion` — identificador de `permission-matrix.md`, con formato `dominio:verbo`.
- `permisos` — los de la sesion, ya resueltos por EAS.
- `contexto` — lo que hace falta para las guardas: identidad del actor (`participanteId`),
  datos del recurso (`creadoPor`, `titularId`, `tipoConvocatoria`, y un `estatus` por tipo de
  entidad — `estatusVehiculo`, `estatusConvocatoria`, `estatusSolicitud`), y ventanas de tiempo o
  consultas **ya resueltas por quien invoca** (`ventaAbierta`, `dentroDePlazo`,
  `tieneSolicitudViva`, etc. — el catalogo completo esta en `src/lib/auth/permisos.ts`, tipo
  `Contexto`). `puedeEjecutar` nunca calcula fechas ni consulta la fila: solo compone resultados
  que ya le llegaron evaluados.

Decide en dos tiempos, en este orden:

1. **Capacidad** — la accion exige uno de los permisos que declara la matriz. Si ninguno esta en
   la sesion → `forbidden`.
2. **Aplicabilidad** — la guarda contextual de la accion. Es lo que EAS no puede saber.

**Toda precondicion booleana de una guarda exige `=== true` para permitir.** Un `undefined`
deniega. Lo contrario —rechazar solo `=== false`— convierte un campo de contexto olvidado en un
permiso concedido, que es exactamente el fallo abierto que encontro la revision de la Etapa 2.1.
La invariante 8 de `permission-matrix.md` lo prueba recorriendo el catalogo entero.

Que sea pura es lo que la hace exhaustivamente probable: los casos allow y deny de cada permiso
se cubren sin levantar infraestructura.

**El llamador inyecta el contexto.** `puedeEjecutar` no lee la convocatoria para saber quien la
creo: quien la invoca ya la tiene cargada. Esto evita una lectura extra y mantiene la funcion
determinista.

### 6.1 Guarda estandar en Server Actions

```ts
const exigirPermiso = async (accion: Accion, contexto: Contexto) => {
  const sesion = await getSession();
  if (!sesion) return { error: "unauthorized" as const };
  const decision = puedeEjecutar({ accion, permisos: sesion.permisos, contexto });
  if (!decision.permitido) return { error: "forbidden" as const };
  return { sesion };
};
```

Toda Server Action empieza asi. La action **nunca lanza**: devuelve `{ ok: false, error }`.

### 6.2 Razones de denegacion

`unauthorized` (sin sesion), `forbidden` (sin el permiso que exige la accion), `not_owner` (no es
su solicitud), `self_approval` (intenta aprobar lo propio), `sin_permiso_de_tipo` (convocatoria
de un tipo para el que no tiene permiso de venta), `invalid_state` (transicion no valida desde el
estatus actual).

Se distinguen para la bitacora y para dar mensajes utiles. **Al cliente se le devuelve siempre
la razon generica**, salvo cuando informarla no revela nada — `sin_permiso_de_tipo` se
convierte en 404 por R-01.

---

## 7. Flujo de aprobacion de convocatoria

Implementa R-05 de `proyecto.md`: **separacion de funciones**.

1. Quien tiene `Autob_Administrar_Convocatorias` la crea. Se registra `creadoPor`.
2. La envia a aprobacion → `EN_APROBACION`. Deja de ser editable.
3. Quien tiene `Autob_Aprobar_Convocatorias` la ve en su bandeja y dictamina.
4. **La guarda `self_approval` rechaza si `contexto.creadoPor === sesion.participanteId`**,
   aunque el usuario tenga los dos permisos. Se valida en el servidor; ocultar el boton no basta.
5. Aprobar → `APROBADA`. Rechazar → vuelve a `BORRADOR` **con motivo obligatorio**, que queda en
   la bitacora.
6. Publicar es un acto separado, posterior a la aprobacion, de quien administra convocatorias.

> Este es el ejemplo canonico de por que EAS no basta y la aplicacion sigue teniendo guardas:
> EAS puede afirmar que alguien tiene la capacidad de aprobar, pero no puede saber quien creo
> **esta** convocatoria. La capacidad la concede EAS; la aplicabilidad la decide el codigo.

---

## 8. Errores frecuentes a evitar

| Error | Por que importa |
| --- | --- |
| Autorizar en `proxy.ts` | No tiene contexto; produce reglas incompletas y duplicadas |
| Confiar en un tipo de convocatoria o permiso enviado por el cliente | Da acceso a convocatorias de empleados a cualquiera |
| Devolver el conjunto de permisos vacio cuando EAS falla | Convierte una caida en una denegacion silenciosa e indepurable |
| Tratar como `false` un permiso que se pidio y no vino | Un cambio de contrato se disfraza de "usuario sin acceso" |
| **Escribir en el codigo quien puede hacer que** | Congela politica organizacional en el repositorio; cambiarla exigiria desplegar en vez de configurar EAS |
| Rechazar solo `=== false` en una precondicion de guarda | Un campo de contexto olvidado queda permitido: falla abierto |
| Ocultar el boton y no validar en el servidor | La Server Action sigue siendo invocable directamente |
| Filtrar convocatorias en el cliente | Los datos ya viajaron; el gating debe ocurrir en la consulta |
| Devolver 403 en lugar de 404 para lo no publicado | Revela la existencia de convocatorias no publicadas |
| Cachear permisos entre peticiones | Una revocacion tardaria en surtir efecto |
| Enviar el objeto `Sesion` completo a un componente cliente | Expone correo e identificadores sin necesidad |
