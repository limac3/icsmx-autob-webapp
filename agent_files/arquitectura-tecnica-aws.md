# Arquitectura Tecnica — AWS

Topologia, componentes y flujos de ejecucion. Las decisiones y su justificacion estan en
`estrategia-aplicacion.md`; las claves y transacciones, en `modelo-datos-dynamodb.md`.

---

## 1. Topologia

```
                    Okta (OIDC)
                        │
                        ▼
  Navegador ──▶ Amplify Hosting (Next.js 16 SSR)
                        │
      ┌─────────────────┼──────────────────┬──────────────┐
      ▼                 ▼                  ▼              ▼
  DynamoDB           S3 (privado)         CES           EAS
  tabla unica            │              (correo)      (roles)
      ▲                  ▼
      │            CloudFront ──▶ fotografias con URL firmada
      │
  Lambda programada (barrido de vencimientos)
```

Todo el backend se declara con **Amplify Gen2** (`defineBackend` + constructos CDK) en
`amplify/`. La aplicacion nunca habla con AWS desde el navegador: el unico componente que
alcanza el cliente son las fotografias, y llegan por CloudFront con URL firmada.

---

## 2. Componentes

### 2.1 Amplify Hosting — SSR

Ejecuta Next.js 16 App Router. Server Components y Server Actions corren aqui, con un rol de
ejecucion propio.

Variables sensibles (`AUTH0_CLIENT_SECRET`, `AUTH_SECRET`, `EAS_API_KEY`, llave privada de
CloudFront) se inyectan como secretos, nunca en el repositorio.

**El build no debe requerir secretos.** Se usa el patron `required()` descrito en
`identidad-autorizacion.md`, seccion 2.1.

### 2.2 DynamoDB

Tabla unica, modo **bajo demanda**, PITR activado, cifrado en reposo. Cuatro GSIs (seccion 3 de
`modelo-datos-dynamodb.md`).

Bajo demanda porque la carga es a rafagas: la apertura de una convocatoria concentra casi toda
la escritura del ciclo.

### 2.3 S3

Bucket privado para fotografias y comprobantes, **sin acceso publico**, cifrado y versionado.

```
vehiculos/<vehiculoId>/<fotoId>.<ext>
comprobantes/<solicitudId>/<archivoId>.<ext>
```

Los dos prefijos se tratan distinto: las fotografias se sirven por CloudFront; **los
comprobantes nunca**. Un comprobante de pago es un documento sensible y se entrega solo por el
Route Handler de descarga, que verifica permiso y audita el acceso.

### 2.4 CloudFront

Distribucion con **Origin Access Control** hacia S3 — el bucket sigue privado. Solo el prefijo
`vehiculos/`.

URLs firmadas con vigencia corta, generadas en SSR en cada peticion. La llave privada vive en
secretos; la **publica se versiona** en `amplify/claves/cloudfront-publica.pem`, porque no es
un secreto y porque rotarla invalidaria de golpe todas las URLs firmadas vigentes. Si falta,
el backend falla al sintetizar en vez de crear una distribucion sin grupo de llaves de
confianza, que serviria las fotografias a cualquiera que conociera la URL.

El acotamiento al prefijo `vehiculos/` es `originPath`, no una regla de comportamiento: una
peticion a `/x.jpg` resuelve `s3://<bucket>/vehiculos/x.jpg`, de modo que `comprobantes/` es
inalcanzable por esta distribucion aunque alguien lo intente.

### 2.5 CES — Church Email Service

Correos transaccionales. **No se usa SES.** CES es un servicio REST corporativo: se le hace
`POST` de un JSON con los datos del mensaje y se autentica con `Authorization: Basic`.

La consecuencia arquitectonica es que **el correo no es infraestructura**. No hay identidad que
verificar, ni DKIM que activar, ni plantilla que declarar en CloudFormation, ni permiso de IAM
que otorgar: solo una URL y unas credenciales que llegan como secretos. La plantilla del mensaje
pasa a ser codigo de la aplicacion en vez de un recurso de AWS.

Se consume **solo desde el procesador del outbox**, nunca desde el flujo de adjudicacion (D-6).
Que sea un servicio externo por HTTP refuerza D-6 en vez de debilitarlo: un tercero remoto
tiene mas formas de fallar que un servicio de AWS, y ninguna puede tocar la transaccion.

> CES **aun no esta aprobado** para este proyecto (riesgo R17). El procesador del outbox se
> construye en la Etapa 10; hasta entonces no hay integracion que probar.

### 2.6 Lambda programada — barrido

Se ejecuta cada pocos minutos y realiza dos tareas:

1. Consulta GSI4 (`VENCE#<dia>`) las adjudicaciones vencidas y aplica T5.
2. Consulta GSI4 (`OUTBOX_PENDIENTE`) y envia los correos pendientes.

**Idempotente:** cada operacion es condicional, asi que dos ejecuciones simultaneas o una
repetida no producen doble efecto. Se puede reejecutar sin miedo (`runbooks.md`).

### 2.7 EAS

Servicio externo de roles. Se consulta por HTTPS con `AbortController` y timeout de 5 segundos.
Sin fallback silencioso (P-4).

---

## 3. Politica de cache

Riesgo R4 — el punto mas delicado de la arquitectura.

| Ruta | Estrategia | Por que |
| --- | --- | --- |
| `/convocatorias` | Dinamica o `cacheLife` corto + `revalidateTag` | Depende de `publicadaEn` y del tipo de participante |
| `/convocatorias/[id]` | Igual | Idem |
| `/convocatorias/[id]/lotes/[loteId]` | Ficha del vehiculo cacheable; estado de fila dinamico | Se separan con `Suspense` |
| Estado de la fila | **Nunca cacheado** | Cambia con cada solicitud |
| `/admin/*` | Nunca cacheado | Contenido no publicado |
| Fotografias | CloudFront, cache larga | Inmutables por clave |

### 3.1 La regla

**Ninguna respuesta que dependa de `publicadaEn` o de los permisos de venta puede ser estatica.**

Dos razones distintas y ambas suficientes: una convocatoria programada no puede filtrarse antes
de su hora, y una respuesta cacheada para quien tiene `Autob_Venta_a_empleados` no puede servirse
a quien no lo tiene.

El patron es envolver la parte dependiente de sesion o de tiempo en `Suspense` con lectura
dinamica, dejando estatico solo el armazon.

### 3.2 Invalidacion

| Evento | Etiquetas |
| --- | --- |
| Publicar convocatoria | `convocatorias:visibles`, `convocatoria:<id>` |
| Editar vehiculo | `vehiculo:<id>` y las convocatorias que lo incluyen |
| Cambio en la fila | `lote:<loteId>` |
| Concluir convocatoria | `convocatorias:visibles`, `convocatoria:<id>` |

> **`revalidateTag` no cubre la publicacion programada.** Si `publicadaEn` esta en el futuro, no
> hay ninguna accion humana en ese instante que dispare la invalidacion. Por eso el listado de
> convocatorias visibles **no puede depender solo de etiquetas**: necesita lectura dinamica o
> una `cacheLife` mas corta que la precision exigida a la hora de publicacion.
>
> Es el error facil de cometer: publicar dispara `revalidateTag` y todo parece correcto en
> pruebas, hasta que una convocatoria programada aparece tarde en produccion.

---

## 4. Flujos criticos

### 4.1 Ver convocatorias

```
Navegador → proxy.ts (sesion) → page.tsx
    → getSession() → oktaSub + permisos EAS → tipos de convocatoria permitidos
    → listarConvocatoriasVisibles(tiposPermitidos, ahora)
        → Query GSI2 CONV_ESTATUS#PUBLICADA, GSI2SK <= ahora, filtro por tipo
    → DTO sin datos de otros participantes → render
```

El gating triple ocurre **dentro de la consulta** (R-01). Lo que no se recupera no se puede
filtrar mal despues.

### 4.2 Solicitar compra

```
Cliente → Server Action solicitarCompra(loteId)
    → getSession()  +  puedeEjecutar("solicitud:crear")
    → servicio:
        1. GetItem centinela de fila        (atajo contra doble clic, no autoridad)
        2. Put RESERVA#<reservaId>          (marca la ventana; va ANTES del contador)
        3. UpdateItem ADD contadorTurnos    (condicion: venta abierta) → turno
        4. TransactWriteItems: solicitud + centinela + evento + Delete de la reserva
           (si 3 o 4 fallan: borrar la reserva, de mejor esfuerzo)
    → intentar adjudicacion (T2), siempre
    → revalidateTag(`lote:<id>`)
```

> **"Siempre", y antes decia "si la fila estaba vacia".** Con la abstencion por reservas, esa
> optimizacion produce un bloqueo: si A (turno 1) y B (turno 2) llegan juntos, A ve la fila
> vacia e intenta adjudicar pero se abstiene porque B esta en vuelo, y B ya no intenta porque
> la fila no estaba vacia. Nadie adjudica hasta el barrido. Intentar siempre es barato —una
> `Query` consistente y, si hay reservas, nada mas— y es lo unico que garantiza que el ultimo en
> aterrizar cierre la ronda.

### 4.3 Adjudicar

```
Leer reservas del lote (Query consistente, RESERVA#) ANTES que la fila
  ├─ alguna vigente → abstenerse; la disparara quien termine despues
  └─ vencidas       → borrarlas

Recorrer la fila en orden de turno (Query, ScanIndexForward: true)
  Para cada solicitud EN_FILA:
      TransactWriteItems T2
        ├─ falla item 1 → el lote ya se adjudico → abortar
        ├─ falla item 3 → el candidato ya tiene adjudicacion → CONGELADA, siguiente
        ├─ TransactionConflict → otro proceso adjudica → releer y reintentar con jitter
        └─ exito        → encolar correo en outbox
  Fila agotada → evento FILA_AGOTADA, lote queda EN_OFERTA
```

### 4.4 Vencimiento

Dos caminos hacia el mismo resultado, deliberadamente redundantes (D-7):

```
Camino A — barrido programado
  Lambda cada N minutos → Query GSI4 VENCE#<dia>, GSI4SK <= ahora → T5

Camino B — verificacion perezosa
  Al leer una fila cuya adjudicacion vigente ya vencio → T5 antes de responder
```

Ambos ejecutan la misma transaccion condicional, asi que competir entre si es inofensivo: el
segundo en llegar falla la condicion y no hace nada.

### 4.5 Correo

```
T2 / T5 encolan mensaje en OUTBOX  (misma transaccion, evento CORREO_ENCOLADO)
Barrido → Query GSI4 OUTBOX_PENDIENTE
    → CES → exito: CORREO_ENVIADO y se retiran las claves GSI4
           → fallo: reintento con retroceso; agotados, CORREO_FALLIDO
```

El correo **nunca** bloquea ni revierte una adjudicacion.

---

## 5. Seguridad

| Aspecto | Medida |
| --- | --- |
| Transporte | HTTPS obligatorio, HSTS |
| Cabeceras | CSP con nonce, `X-Content-Type-Options`, `Referrer-Policy`, Permissions-Policy |
| Secretos | Gestor de secretos de Amplify. Nunca en el repositorio |
| S3 | Sin acceso publico; fotografias solo por CloudFront con OAC; comprobantes solo por Route Handler |
| DynamoDB | Rol de minimo privilegio, con **`Deny` explicito de `UpdateItem`/`DeleteItem` sobre `AUDIT#`** |
| Sesion | Cookie `httpOnly` y `secure`; duracion absoluta acotada |
| Rutas autenticadas | `Cache-Control: no-store` desde `proxy.ts` — en la practica es toda ruta: no hay contenido publico/anonimo en esta aplicacion (ni el catalogo publicado exige rol, seccion 3 de `permission-matrix.md`) |
| Subidas | Tipo y tamano validados en servidor; nombre de archivo generado, nunca el del cliente |

**CSP con nonce (Etapa 2, `src/proxy.ts`):** nonce distinto por peticion en `script-src`, con
`'strict-dynamic'`. `style-src` conserva `'unsafe-inline'` — el uso de estilos en linea de Eden no
esta verificado y endurecerlo sin una pasada visual completa es mas riesgo que beneficio; se
revisa en la Etapa 12.

`style-src` y `font-src` autorizan ademas **`https://foundry.churchofjesuschrist.org`**. No es una
concesion opcional: `<Fonts>` de `@churchofjesuschrist/eden-fonts` monta una hoja de estilo remota
de ese origen y desde ahi se descargan los woff2. Con `'self'` a secas el navegador bloqueaba las
dos cosas y la aplicacion se dibujaba con tipografia de respaldo — un defecto que **ni `next build`
ni jsdom pueden ver**, porque ninguno aplica CSP.

El nonce por peticion **obliga a renderizado dinamico en toda la aplicacion** (Next.js no puede
inyectar un nonce en una pagina generada en build). Esto no estorba la seccion 3: `cacheLife` y
`revalidateTag` siguen operando dentro de una respuesta dinamica, solo que ya no hay paginas
completamente estaticas que perder.

### 5.1 La politica IAM que mas importa

```json
{
  "Effect": "Deny",
  "Action": ["dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"],
  "Resource": "<tabla>",
  "Condition": {
    "ForAnyValue:StringLike": { "dynamodb:LeadingKeys": ["AUDIT#*"] }
  }
}
```

Un `Deny` explicito no se puede sobrescribir con un `Allow`, asi que ningun permiso posterior
reabre esta puerta.

**Hasta donde llega — y hasta donde no.** Esta politica impide *modificar* y *borrar* un evento.
**No impide reescribirlo**: un `PutItem` con la misma clave reemplaza el item completo, y
`PutItem` tiene que quedar permitido porque es justo lo que la regla 4 obliga a escribir en la
misma transaccion que la mutacion. No hay condicion de IAM que distinga un `Put` que crea de uno
que reemplaza.

Por eso la inmutabilidad se sostiene en **dos** mecanismos, no en uno:

| Amenaza | Que la contiene |
| --- | --- |
| Codigo que intenta `UpdateItem` o `DeleteItem` sobre un `AUDIT#` | Este `Deny` de IAM |
| Codigo con un error que reescribe un evento existente | `ConditionExpression: attribute_not_exists(PK)` en todo `Put` de evento (`modelo-datos-dynamodb.md` seccion 6) |
| Codigo que deliberadamente omite la condicion | **Ninguno de los dos.** Exige un sumidero append-only fuera del alcance de la aplicacion — riesgo R20, se resuelve en la Etapa 11 |

Las tres filas estan comprobadas contra AWS real en
`amplify/auditoriaInmutable.integracion.test.ts`, incluida la segunda columna vacia de la tercera:
hay una prueba que **confirma que la sobrescritura tiene exito** sin la condicion.

`BatchWriteItem` se incluye porque tambien puede borrar, y omitirlo dejaria abierta justo la
puerta que se intenta cerrar.

Cubre tambien las transacciones sin nombrarlas: `TransactWriteItems` **no es una accion de
IAM**, se autoriza con las acciones de item subyacentes, asi que un `Update` sobre un `AUDIT#`
dentro de una transaccion cae en este mismo `Deny`. `PutItem` queda fuera a proposito — es
justo lo que la regla 4 exige escribir en la misma transaccion que la mutacion.

**Implementada** en `amplify/permisos.ts` (Etapa 3), con dos `Deny` mas por la misma logica:
`dynamodb:PartiQLUpdate`/`PartiQLDelete`, que son acciones distintas y tambien mutan; y
`s3:DeleteObject` sobre `comprobantes/*`, porque un comprobante de pago es evidencia y que no
haya permiso de borrado lo vuelve una garantia en vez de un descuido.

La misma funcion aplica los permisos al rol de computo SSR y al de la funcion de barrido. Que
los compartan es deliberado: dos listas separadas se desincronizan, y la que se olvide seria
justo la que deja escribir la bitacora.

Se verifica en dos niveles. `amplify/infraestructura.test.ts` sintetiza la pila y comprueba que
la politica existe con las acciones y la condicion exactas —corre sin AWS, en segundos—; y
`amplify/auditoriaInmutable.integracion.test.ts` asume el rol real contra un sandbox y confirma
que IAM **rechaza de verdad** el `Update` y el `Delete`, que acepta el `Put`, y que el mismo rol
si modifica items que no son de la bitacora (sin esa ultima comprobacion, un `Deny` demasiado
amplio pasaria inadvertido).

---

## 6. Entornos

| Entorno | Backend | Datos | `ENABLE_DEV_TOOLS` |
| --- | --- | --- | --- |
| Local | `npx ampx sandbox` personal | Desechables | `MOCK_USERS` o `FULL` |
| Desarrollo | Rama compartida | De prueba | `MOCK_USERS` |
| Produccion | Rama principal | Reales | **`OFF` obligatorio** |

`devMode.ts` **lanza un error de arranque** si `NODE_ENV=production` y el valor no es `OFF`.

> En esta maquina, `npx ampx sandbox` y los SDK de AWS fallan sin `NODE_EXTRA_CA_CERTS` por la
> inspeccion TLS corporativa (riesgo R11). El sintoma parece un problema de credenciales o de
> red. Ver `desafios-implementacion.md`.

---

## 7. Observabilidad

| Senal | Uso |
| --- | --- |
| Registro estructurado | Una linea por operacion, con `correlacionId` compartido con la bitacora |
| Metricas | Solicitudes por lote, adjudicaciones, vencimientos, correos fallidos, cancelaciones de transaccion |
| Trazas | Operaciones criticas: solicitar, adjudicar, vencer |

**Alarmas:**

- El barrido no se ejecuta (riesgo R6).
- Correos en el outbox mas antiguos que un umbral.
- Tasa de `TransactionCanceledException` por encima de lo normal — indica contencion inesperada.
- Adjudicaciones con `venceEn` pasado que siguen vigentes: **si esta alarma se dispara, los dos
  caminos de vencimiento fallaron**, y es el sintoma mas grave del sistema.

El registro operativo es **distinto** de la bitacora de auditoria. Aquel es para depurar y
caduca; esta es para probar y no caduca.
