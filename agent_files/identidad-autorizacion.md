# Identidad y Autorizacion

Como se sabe **quien** entra (autenticacion), **que tipo de participante** es, y **que puede
hacer** (autorizacion).

La matriz exhaustiva de permisos vive en `permission-matrix.md`. Este documento explica el
mecanismo; aquel es la tabla de decision.

---

## 1. Principio rector

> La identidad la afirma Okta. El rol lo afirma EAS. **La aplicacion no inventa ninguno de los
> dos, y si no puede obtenerlos, falla de forma explicita.**

Corolario directo de la regla 15 de `CLAUDE.md`: no hay fallback silencioso. Un EAS caido
produce un error visible, nunca un usuario con lista de roles vacia que parece un participante
legitimo sin permisos.

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

> **El proxy no autoriza.** Distingue publico de autenticado, nada mas. Las decisiones por rol
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
  roles: Rol[];                 // desde EAS
  tipoParticipante: TipoParticipante;  // EMPLEADO | OTRO_USUARIO
};
```

`getSession()` devuelve `Sesion` o `null`. Nunca lanza por ausencia de sesion; lanza si EAS
falla (ver 4.2).

Secuencia:

1. `auth.getSession()` → identidad de Okta (`sub`, `email`, `name`). Si no hay, devuelve `null`.
2. Upsert del participante en DynamoDB por `oktaSub` → obtiene `participanteId` estable.
3. Consulta de roles a EAS.
4. Derivacion del `tipoParticipante` (seccion 5).

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

## 4. Roles — EAS

### 4.1 Adaptador conmutable

`src/lib/auth/eas.ts` elige entre implementacion real y simulada segun `ENABLE_DEV_TOOLS`:

| Valor | Efecto |
| --- | --- |
| `OFF` | Solo EAS real. **Unico valor admisible en produccion** |
| `MOCK_USERS` | Roles simulados (por variable de entorno), para desarrollar sin EAS |
| `FULL` | Pensado para simulacion e impersonacion interactiva de rol; hoy se comporta igual que
  `MOCK_USERS` — la impersonacion (UI para elegir el rol simulado) no tiene pantalla todavia y se
  construye cuando exista una que la necesite |

`src/lib/auth/devMode.ts` expone `exigirModoSeguro()`, que **lanza** si `NODE_ENV=production` y
el modo no es `OFF`. Se invoca justo antes de usar el mock (en `eas.ts`), no al importar el
modulo — importar tambien ocurre durante `next build`, y ahi no debe lanzar. Es una salvaguarda
deliberada: el modo de desarrollo nunca debe poder activarse por accidente en produccion.

La impersonacion solo funciona si **ya existe una sesion real de Okta**. Nunca sustituye la
autenticacion, solo el rol.

### 4.2 Adaptador real

`src/lib/auth/easAdapter.ts` consulta el perfil del usuario por su `oktaSub`, con
`Authorization: Bearer ${EAS_API_KEY}` y **timeout de 5 segundos** vía `AbortController`.

Reglas firmes:

- **Sin fallback silencioso.** Fallo de red, timeout o respuesta invalida producen un error, no
  una lista vacia. Un usuario sin permisos y un EAS caido deben verse distintos.
- Un usuario **puede** tener varios roles. `roles` es siempre un arreglo.
- El resultado se cachea por la duracion de la peticion, no entre peticiones: un rol revocado
  debe surtir efecto en la siguiente navegacion.

> El endpoint real de EAS puede no estar disponible al inicio del proyecto. En ese caso el
> adaptador real se deja escrito con la firma definitiva y se trabaja con `MOCK_USERS`. Lo que
> **no** se hace es que el adaptador real devuelva datos falsos como respaldo.

---

## 5. Tipo de participante

`EMPLEADO` u `OTRO_USUARIO`. Determina a que convocatorias se accede (R-02 de `proyecto.md`).

**Lo resuelve el servidor.** Nunca llega del cliente, ni de un parametro, ni de una cookie.

Orden de resolucion:

1. Si los roles de EAS incluyen `EMPLEADO` → `EMPLEADO`.
2. En caso contrario → `OTRO_USUARIO`.

Un `EMPLEADO` es superconjunto: ve las convocatorias de empleados **y** las de publico general.
Un `OTRO_USUARIO` solo las de publico general.

> Si mas adelante la senal de empleado debe venir de otra fuente — dominio del correo, atributo
> de directorio — se cambia **solo esta funcion**. Por eso vive aislada y no se deduce en linea
> dentro de cada consulta.

---

## 6. Autorizacion — `puedeEjecutar`

`src/lib/auth/permisos.ts`. Funcion **pura**: sin I/O, sin red, sin base de datos.

```ts
puedeEjecutar({ accion, roles, contexto }): { permitido: true }
                                          | { permitido: false; razon: RazonDenegacion }
```

- `accion` — identificador de `permission-matrix.md`, con formato `dominio:verbo`.
- `roles` — los de la sesion.
- `contexto` — lo que hace falta para las guardas: identidad del actor (`participanteId`,
  `tipoParticipante`), datos del recurso (`creadoPor`, `titularId`, `tipoConvocatoria`, y un
  `estatus` por tipo de entidad — `estatusVehiculo`, `estatusConvocatoria`, `estatusSolicitud`),
  y ventanas de tiempo o consultas **ya resueltas por quien invoca** (`ventaAbierta`,
  `dentroDePlazo`, `tieneSolicitudViva`, etc. — el catalogo completo esta en
  `src/lib/auth/permisos.ts`, tipo `Contexto`). `puedeEjecutar` nunca calcula fechas ni consulta
  la fila: solo compone resultados que ya le llegaron evaluados.

Que sea pura es lo que la hace exhaustivamente probable: los casos allow y deny de los seis
roles se cubren sin levantar infraestructura.

**El llamador inyecta el contexto.** `puedeEjecutar` no lee la convocatoria para saber quien la
creo: quien la invoca ya la tiene cargada. Esto evita una lectura extra y mantiene la funcion
determinista.

### 6.1 Guarda estandar en Server Actions

```ts
const exigirPermiso = async (accion: Accion, contexto: Contexto) => {
  const sesion = await getSession();
  if (!sesion) return { error: "unauthorized" as const };
  const decision = puedeEjecutar({ accion, roles: sesion.roles, contexto });
  if (!decision.permitido) return { error: "forbidden" as const };
  return { sesion };
};
```

Toda Server Action empieza asi. La action **nunca lanza**: devuelve `{ ok: false, error }`.

### 6.2 Razones de denegacion

`unauthorized` (sin sesion), `forbidden` (rol insuficiente), `not_owner` (no es su solicitud),
`self_approval` (intenta aprobar lo propio), `wrong_participant_type` (convocatoria de
empleados), `invalid_state` (transicion no valida desde el estatus actual).

Se distinguen para la bitacora y para dar mensajes utiles. **Al cliente se le devuelve siempre
la razon generica**, salvo cuando informarla no revela nada — `wrong_participant_type` se
convierte en 404 por R-01.

---

## 7. Flujo de aprobacion de convocatoria

Implementa R-05 de `proyecto.md`: **separacion de funciones**.

1. El `ADMINISTRADOR` crea la convocatoria. Se registra `creadoPor`.
2. La envia a aprobacion → `EN_APROBACION`. Deja de ser editable.
3. Un `APROBADOR_CONVOCATORIA` la ve en su bandeja y dictamina.
4. **La guarda `self_approval` rechaza si `contexto.creadoPor === sesion.participanteId`**,
   aunque el usuario tenga los dos roles. Se valida en el servidor; ocultar el boton no basta.
5. Aprobar → `APROBADA`. Rechazar → vuelve a `BORRADOR` **con motivo obligatorio**, que queda en
   la bitacora.
6. Publicar es un acto separado del `ADMINISTRADOR`, posterior a la aprobacion.

---

## 8. Errores frecuentes a evitar

| Error | Por que importa |
| --- | --- |
| Autorizar en `proxy.ts` | No tiene contexto; produce reglas incompletas y duplicadas |
| Confiar en `tipoParticipante` enviado por el cliente | Da acceso a convocatorias de empleados a cualquiera |
| Devolver lista de roles vacia cuando EAS falla | Convierte una caida en una denegacion silenciosa e indepurable |
| Ocultar el boton y no validar en el servidor | La Server Action sigue siendo invocable directamente |
| Filtrar convocatorias en el cliente | Los datos ya viajaron; el gating debe ocurrir en la consulta |
| Devolver 403 en lugar de 404 para lo no publicado | Revela la existencia de convocatorias no publicadas |
| Cachear roles entre peticiones | Una revocacion tardaria en surtir efecto |
| Enviar el objeto `Sesion` completo a un componente cliente | Expone correo e identificadores sin necesidad |
