# Estrategia de Aplicacion

Principios, capas y decisiones arquitectonicas. El **que** esta en `proyecto.md`; aqui esta el
**como** y, sobre todo, **por que asi y no de otra forma**.

---

## 1. Principios

### P-1 — El servidor decide, el cliente presenta

Ninguna decision de negocio ocurre en el navegador. El orden de la fila, la visibilidad de una
convocatoria, la validez de una transicion y el vencimiento de un plazo se resuelven en el
servidor. La UI puede ocultar lo que no aplica, pero **ocultar no es validar**: toda Server
Action es invocable directamente por quien sepa hacerlo.

### P-2 — Las reglas puras se separan del acceso a datos

Todo lo decidible sin I/O vive en `src/lib/domain/` y se prueba sin red, sin AWS y sin reloj
real. Es lo que permite cubrir las fronteras dificiles —el instante exacto de apertura, el
cambio de horario, el limite del plazo— de forma determinista y en milisegundos.

### P-3 — Las garantias se delegan a la base de datos

Una regla de negocio critica no se sostiene con una validacion en codigo: se sostiene con una
escritura condicional. Leer y despues decidir es una carrera; condicionar la escritura no lo es.
Aplicado a R-07, R-08, R-09 y R-10 mediante items centinela.

### P-4 — Fallar fuerte y visible

Sin fallback silencioso (regla 15). Un EAS caido, un DynamoDB inaccesible o un S3 que no
responde producen un error explicito. Degradar en silencio convierte una caida en un
comportamiento incorrecto indistinguible del normal.

### P-5 — Auditable por construccion

La bitacora no se agrega al final: se escribe en la misma transaccion que la mutacion. Una
funcionalidad sin evento de auditoria esta incompleta, no "pendiente de instrumentar".

### P-6 — Mobile-first de verdad

Se disena primero la pantalla angosta. CardView en movil, tabla en escritorio. El participante
tipico entra desde el telefono, muchas veces en el momento exacto de la apertura de venta.

---

## 2. Capas

```
src/app/<ruta>/page.tsx      Server Component: sesion -> permiso -> lectura -> serializar
src/app/actions/<area>.ts    Server Action delgada: sesion + puedeEjecutar + delega
src/lib/<feature>/<verbo>.ts Servicio: acceso a datos, devuelve { ok, data } | { ok, error }
src/lib/domain/*.ts          Reglas puras, sin I/O
src/lib/data/*.ts            Cliente DynamoDB, claves, helpers de transaccion
src/components/*.tsx         Componentes planos, con .css y .test.tsx colocados
```

**Regla de dependencia:** cada capa conoce solo la de abajo. Las paginas y las actions **no
hablan con DynamoDB**; pasan por `src/lib/<feature>`. `src/lib/domain` no importa nada de
`src/lib/data`: si una regla necesita leer algo, ese algo se le pasa como argumento.

### 2.1 Un archivo por operacion

`src/lib/convocatorias/publicarConvocatoria.ts`, no un `convocatoriasService.ts` con quince
metodos. Cada archivo lleva su `.test.ts` al lado.

Facilita encontrar la operacion por nombre, mantiene los tests pequenos y evita que un cambio
en una operacion obligue a releer las otras catorce.

### 2.2 Inyeccion de dependencias

Todo servicio recibe sus dependencias como segundo parametro opcional:

```ts
export const solicitarCompra = async (input: Entrada, deps: Deps = {}) => {
  const cliente = deps.cliente ?? clienteDynamo;
  const ahora = deps.ahora ?? (() => new Date());
  // ...
};
```

`ahora` inyectable es lo que hace probables las fronteras de tiempo sin manipular el reloj del
sistema. Patron tomado de `icsmx-camp-webapp`, donde ya esta en produccion.

### 2.3 `src/lib/observabilidad/` es transversal, no una capa

El registro operativo (Etapa 12) no encaja en la pila de 2 y no se le forzo un sitio: lo importan
`src/lib/data` —`ejecutarTransaccion` deja constancia de por que se cancelo una transaccion— y
`src/lib/<feature>` —`conTraza` envuelve las operaciones criticas—, que son dos capas distintas.

Lo que **si** respeta es la unica frontera que importa aqui: **`src/lib/domain` no lo importa**.
El dominio sigue siendo funciones puras sin efectos (P-2), y escribir una linea de registro es un
efecto. Una regla que quisiera "dejar constancia" esta pidiendo que quien la invoca lo haga con
su resultado.

Es la misma clase de modulo que `src/lib/estadoAplicacion.ts`: utilidad transversal de un solo
proposito, sin estado y sin I/O mas alla de la salida estandar.

**No recibe el reloj por `deps`**, y es la excepcion que confirma 2.2: `conTraza` mide con
`performance.now()`. El `ahora` inyectable esta **congelado** por invocacion a proposito —un
instante por acto, para que el item y su evento cuenten la misma historia—, asi que medir una
duracion con el daria siempre cero. Una duracion no es un dato de negocio y no tiene que ser
reproducible.

---

## 3. Forma de retorno

**Los servicios y las Server Actions nunca lanzan.** Devuelven un resultado discriminado:

```ts
type Resultado<T> =
  | { ok: true; data: T }
  | { ok: false; error: CodigoError; detalles?: Record<string, string> };
```

Con TypeScript `strict`, el compilador obliga a comprobar `ok` antes de tocar `data`. Un caso de
error olvidado es un error de compilacion, no un fallo en produccion.

Vive en `src/types/resultado.ts` desde la Etapa 4, junto a los constructores `exito` y `fallo`.

### 3.1 Codigos de error

`unauthorized`, `forbidden`, `not_found`, `validation_failed`, `invalid_state`,
`already_in_queue`, `lote_no_disponible`, `adjudicacion_activa`, `plazo_vencido`,
`conflicto_concurrencia`, `dependencia_no_disponible`.

Son **estables**: se traducen en `src/dictionaries/` y se prueban. `not_found` cubre tambien lo
que existe pero no debe revelarse (R-01).

`conflicto_concurrencia` merece mencion aparte: no es un fallo del usuario sino una carrera
perdida. La UI lo trata releyendo y reintentando, no mostrando un error rojo.

### 3.2 Lo que si lanza

Solo lo irrecuperable: configuracion ausente al arrancar, `ENABLE_DEV_TOOLS` distinto de `OFF` en un
despliegue que no lo habilito explicitamente (`arquitectura-tecnica-aws.md` 6), o un fallo de
infraestructura que la capa superior no puede manejar. Llegan al `error.tsx` mas cercano.

---

## 4. Server Components y Server Actions

**Server Components por defecto** (regla 1). `"use client"` solo para hooks, estado local o
eventos de navegador, y en el componente mas pequeno posible — un boton interactivo dentro de
una pagina de servidor, no la pagina entera.

**Server Actions para todas las mutaciones** (regla 2). Route Handlers **solo** para:

| Caso | Por que no puede ser action |
| --- | --- |
| Descarga del comprobante | Devuelve un flujo binario con cabeceras propias |
| `GET /api/health` | Lo consume la infraestructura, no el navegador |
| Callbacks de autenticacion | Los atiende el middleware del SDK; no se escribe codigo |

**Un Route Handler no hereda ninguna proteccion**: verifica sesion y permiso por su cuenta.

### 4.1 Anatomia de una Server Action

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

La action es **delgada**: sesion, permiso, delegacion, invalidacion de cache. Sin logica de
negocio ni acceso a datos. Los identificadores del actor se toman **de la sesion, nunca del
input** — aceptar un `participanteId` del cliente permitiria actuar en nombre de otro.

---

## 5. Cache

El punto mas delicado del proyecto en Next.js, y el riesgo R4.

### 5.1 Prohibicion

**Nada que dependa de `publicadaEn` puede entrar a cache estatica** (regla 14). Una convocatoria
programada que se filtra antes de tiempo destruye la equidad.

Aplica a: listado de convocatorias visibles, detalle de convocatoria y detalle de lote.

### 5.2 Que si se cachea

| Contenido | Estrategia |
| --- | --- |
| Fotografias y estaticos | CloudFront, cache larga con clave versionada |
| Ficha del vehiculo | `cacheLife` medio con `revalidateTag("vehiculo:<id>")` |
| Listado de convocatorias visibles | Dinamico, o `cacheLife` corto con `revalidateTag` al publicar |
| Estado de la fila | **Nunca.** Siempre dinamico |
| Diccionarios | Cache larga |

### 5.3 URLs firmadas de CloudFront

Se firman **en SSR, en cada peticion** (regla 13). Nunca se persisten en DynamoDB ni se generan
dentro de un bloque `"use cache"`.

Una URL firmada es una credencial con vencimiento: cachearla la reparte entre usuarios y la
deja viva mas alla de su proposito; persistirla la convierte en un permiso permanente.

**El vencimiento se redondea a una cubeta de una hora**, no se cuenta desde el instante de la
peticion: `floor(ahora / 1h) * 1h + 1h + 1h de gracia`. Asi la URL queda byte-identica durante
toda la hora en curso **para todos los usuarios**, y el cache del navegador por fin acierta —
antes la firma cambiaba en cada render y volver al catalogo re-descargaba todo. De paso, la
validez minima sube de 10 minutos a una hora, que es lo que arreglaba las "fotos que no se ven":
el visor ampliado de Eden se monta al hacer clic, no al renderizar, asi que leer una ficha y
abrir las fotos once minutos despues daba 403 garantizado.

El redondeo es sobre el epoch, **no** sobre la hora local: una cubeta de una hora es agnostica de
zona y la regla 9 no interviene aqui. Sin esta nota alguien lo "arregla" con `Intl`.

> **Que se determine no relaja la regla 13.** La URL sigue firmandose en SSR en cada peticion y
> sigue sin poder persistirse ni entrar en un bloque `"use cache"`. Que dos peticiones de la misma
> hora produzcan la misma cadena es una propiedad del calculo, no un permiso para guardarla: el
> dia que se cambie la cubeta, lo persistido queda firmado con una regla que ya no existe.
>
> Lo que si se paga, explicito: una URL filtrada vale hasta dos horas en vez de diez minutos. Lo
> que protege el acceso es el gating triple del servidor (regla 8), no el vencimiento, y el objeto
> expuesto es la foto de un vehiculo en venta, sin PII. Los comprobantes de pago no entran por
> este camino. Residuo honesto: una pestana abierta tres horas sigue rompiendose — se eleva el
> piso, no se elimina el modo de fallo.

El destino correcto de este camino son las **cookies firmadas**, que harian las URLs estables para
siempre. Hoy no se pueden: `cloudfront.net` y `amplifyapp.com` estan en la Public Suffix List, asi
que ningun navegador acepta una cookie para ese dominio. Lo que lo volveria viable es servir la
distribucion desde un subdominio del mismo dominio registrable que la aplicacion.

### 5.4 Las imagenes se normalizan en la subida

**El original no se conserva.** `agregarFotografia` decodifica lo que llega, hornea la orientacion
EXIF, produce tres variantes WebP de 480 / 1280 / 2048 px de ancho y guarda solo esas. El byte que
subio el operador no queda en ninguna parte.

Tres razones, en orden de peso:

1. **Peso.** Antes se servia el original a todas las superficies, incluida la tira de miniaturas de
   100x100 px: una foto de celular de 8 MB se descargaba entera para pintarse en un cuadrito, y con
   veinte fotografias por vehiculo el detalle de un lote pasaba de 100 MB.
2. **Privacidad.** El EXIF de una foto de celular publica las coordenadas GPS del patio donde se
   tomo. Decodificar y recomprimir lo elimina; `.rotate()` conserva la orientacion, que es lo unico
   de ese bloque que hace falta.
3. **Confianza en el `contentType`.** El que llega viene de `File.type`, o sea del navegador.
   Decodificando se sabe **que es de verdad** y se puede rechazar la discrepancia. La lista blanca
   de tipos se queda como guarda barata antes de gastar CPU, y sigue siendo lo que impide que un
   SVG decodifique: librsvg esta dentro de libvips.

**Sincrono, dentro de la Server Action**, y no en un Lambda disparado por `s3:ObjectCreated`. Lo
asincrono es la arquitectura correcta a largo plazo, pero exige un estado `PROCESANDO`, una UI de
espera y un camino de fallo sin usuario a quien reportarlo; hoy la galeria se repinta con la foto
ya puesta. El costo medido es de unos 400 ms por variante.

**WebP y no AVIF**, medido sobre la misma foto de 12 MP: WebP 385 ms por variante, AVIF 8 647 ms —
catorce veces el CPU por un 10 % menos de bytes. WebP tiene soporte universal desde 2020 y no
necesita `<picture>`.

La consecuencia que sostiene la cache de la seccion 5.3: **los bytes de una fotografia son
inmutables**. Se borra, nunca se reemplaza, asi que las claves de S3 son estables y
`Cache-Control: immutable` es correcto. La descripcion no es parte de los bytes —vive en el item de
DynamoDB y editarla no toca S3—. "Reemplazar la foto" es borrar y volver a subir, con `fotoId`
nuevo, jamas un `PutObject` sobre la misma clave.

---

## 6. Decisiones arquitectonicas

### D-1 — Amplify Gen2 y DynamoDB

**Decidido:** Amplify Gen2 como IaC y hosting SSR, DynamoDB single-table.

**Alternativa descartada:** Terraform + ECS Fargate + Azure Pipelines con PostgreSQL y Prisma,
que es el precedente real de la organizacion (`icsmx-camp-webapp`).

**Razon:** decision explicita del proyecto. DynamoDB aporta ademas escrituras condicionales y
contadores atomicos, que encajan de forma directa con la fila y la auditoria append-only.

**Riesgo asumido:** la organizacion no tiene precedente de Amplify y su pipeline corporativo no
lo contempla (riesgo R1 en `plan-ejecucion.md`). La mitigacion es que la frontera esta limpia:
todo el acceso a datos pasa por `src/lib/data/`, asi que migrar el IaC no toca la aplicacion.

### D-2 — Single-table

**Alternativa descartada:** una tabla por entidad.

**Razon:** las lecturas son jerarquicas y una sola `Query` resuelve cada pantalla. Sobre todo,
permite escribir la mutacion y su evento de auditoria en la misma `TransactWriteItems`, que es
lo que hace cumplible la regla 4.

### D-3 — El lote como entidad de la fila

**Alternativa descartada:** la fila sobre el vehiculo.

**Razon:** un vehiculo se reoferta en varias convocatorias. Con la fila sobre el lote, cada
reoferta empieza limpia sin arrastrar historia, y el auditor conserva las dos por separado.

### D-4 — TypeScript strict

**Alternativa descartada:** JavaScript con JSDoc, como el proyecto hermano.

**Razon:** el dominio es de estados y transiciones. Las uniones discriminadas y el chequeo de
exhaustividad convierten una transicion no contemplada en un error de compilacion.

**Costo:** el preset `festack-scripts` no esta ejercitado sobre TypeScript en la organizacion
(riesgo R9); se verifica temprano en la Etapa 1.

### D-5 — El turno en la clave de ordenamiento

**Alternativa descartada:** guardar `turno` como atributo y ordenar al leer.

**Razon:** con `SOL#<turno:010d>` la fila llega **ya ordenada**. No existe ningun punto del
codigo donde se pueda ordenar mal, porque nunca se ordena. Es la diferencia entre una convencion
que hay que recordar y una propiedad estructural.

### D-6 — Correo por outbox

**Alternativa descartada:** enviar el correo dentro del flujo de adjudicacion.

**Razon:** el proveedor de correo no participa en la transaccion de DynamoDB. Enviarlo en linea
significaria o adjudicar sin notificar, o fallar la adjudicacion por un problema de correo. El
outbox desacopla: la adjudicacion es atomica y el envio se reintenta aparte.

El argumento no dependia del proveedor, y por eso sobrevivio al cambio de SES a **CES**
(servicio REST corporativo, ver `arquitectura-tecnica-aws.md` 2.5): con un tercero remoto por
HTTP la razon solo se vuelve mas fuerte.

### D-7 — Barrido mas verificacion perezosa

**Alternativa descartada:** solo el barrido programado.

**Razon:** si el barrido se cae, toda fila con una adjudicacion vencida queda bloqueada (riesgo
R6). Con verificacion perezosa, cualquier lectura de una fila con adjudicacion vencida la
resuelve en el momento. El barrido pasa a ser red de seguridad, no unico mecanismo.

**Costo:** una lectura puede provocar una escritura. Es aceptable y acotado: solo ocurre cuando
hay algo realmente vencido, y es idempotente.

### D-8 — Idioma del dominio en espanol

Entidades, estados y acciones se nombran en espanol (`solicitarCompra`, `EN_FILA`,
`convocatoria:aprobar`). Las APIs de framework y librerias siguen en ingles.

**Razon:** las reglas se discuten con el negocio en espanol. Traducir `convocatoria` a `campaign`
introduce una capa de interpretacion donde la precision importa. Coincide ademas con el
`CLAUDE.md` del proyecto hermano.

### D-9 — Autorizacion por permisos: la aplicacion no codifica politica

`puedeEjecutar` decide con **permisos**, no con roles. EAS no expone roles: se le pregunta por
nombres de permiso y responde un booleano por cada uno. La aplicacion declara **que permiso exige
cada accion** y **bajo que condiciones del recurso aplica**; quien tiene ese permiso lo decide la
organizacion en EAS.

**Razon:** la politica organizacional cambia sin avisar y a distinto ritmo que el codigo. Hoy
quien administra no compra; manana puede cambiar. Con permisos, ese cambio es una reconfiguracion
en EAS y este repositorio no se toca. Con roles, seria un despliegue.

**Division de responsabilidades:**

| Decide | Quien | Por que |
| --- | --- | --- |
| Capacidad — "¿puede operar tesoreria?" | EAS | Conoce los roles y caracteristicas de la persona |
| Aplicabilidad — "¿esta solicitud esta en `EN_VERIFICACION`?" | La aplicacion | EAS no conoce el recurso ni el momento |

**Alternativas descartadas:**

- **RBAC con la lista de roles en el codigo** (lo que habia hasta la Etapa 2). Se descarto porque
  EAS no puede entregar roles, y porque congelaba politica organizacional en el repositorio. Tenia
  ademas un defecto concreto: unir los roles de una persona concedia acciones que la matriz
  negaba, y la causa raiz era que `EMPLEADO` era a la vez permiso de compra y discriminador del
  tipo de participante.
- **RBAC con exclusiones explicitas** (`deny-override`: "quien administra nunca compra"). Se
  descarto por lo mismo: es politica organizacional escrita en el codigo. Ademas volveria
  imposible de expresar el caso legitimo de que la organizacion quiera permitirlo.
- **Un permiso por accion** (33 permisos). Se descarto por costo de configuracion en EAS y porque
  fragmenta capacidades que en la practica se conceden juntas. Se eligio granularidad de
  capacidad: siete permisos, en `permission-matrix.md` seccion 1.

---

## 7. Testing

| Capa | Enfoque |
| --- | --- |
| `src/lib/domain/` | Puro. Sin mocks. Fronteras de tiempo y transiciones invalidas |
| `src/lib/auth/permisos.ts` | Puro. Allow y deny por permiso; matriz completa y guardas cerradas por omision |
| `src/lib/<feature>/` | Cliente falso inyectado por `deps`. Cabecera `// @vitest-environment node` + `vi.mock("server-only")` |
| Motor de fila | **Concurrencia real** contra DynamoDB local o sandbox. N solicitudes en paralelo |
| Componentes | `getTestContext()` + `genericTests()` con axe |

Los helpers de test se toman de `icsmx-camp-webapp`, adaptados a TypeScript.

**Todo test de concurrencia se ejecuta varias veces.** Uno que pasa una vez no prueba nada: las
carreras son intermitentes por definicion.
