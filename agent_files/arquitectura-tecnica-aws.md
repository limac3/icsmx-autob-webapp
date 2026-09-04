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
  DynamoDB           S3 (privado)         SES           EAS
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
secretos.

### 2.5 SES

Correos transaccionales. Identidad y dominio verificados; DKIM activo.

Se consume **solo desde el procesador del outbox**, nunca desde el flujo de adjudicacion (D-6).

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

**Ninguna respuesta que dependa de `publicadaEn` o del `tipoParticipante` puede ser estatica.**

Dos razones distintas y ambas suficientes: una convocatoria programada no puede filtrarse antes
de su hora, y una respuesta cacheada para un `EMPLEADO` no puede servirse a un `OTRO_USUARIO`.

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
    → getSession() → oktaSub + roles EAS → tipoParticipante
    → listarConvocatoriasVisibles(tipoParticipante, ahora)
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
        2. UpdateItem ADD contadorTurnos    (condicion: venta abierta) → turno
        3. TransactWriteItems: solicitud + centinela + evento
    → si la fila estaba vacia: intentar adjudicacion (T2)
    → revalidateTag(`lote:<id>`)
```

### 4.3 Adjudicar

```
Recorrer la fila en orden de turno (Query, ScanIndexForward: true)
  Para cada solicitud EN_FILA:
      TransactWriteItems T2
        ├─ falla item 1 → el lote ya se adjudico → abortar
        ├─ falla item 3 → el candidato ya tiene adjudicacion → CONGELADA, siguiente
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
    → SES → exito: CORREO_ENVIADO y se retiran las claves GSI4
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
`'strict-dynamic'`. `style-src` se deja con `'unsafe-inline'` a proposito — Eden es una libreria
externa cuyo uso de estilos en linea no esta verificado (sin acceso al MCP de Eden en el entorno
de desarrollo); endurecerlo sin poder revisar cada componente visualmente es mas riesgo que
beneficio. Revisar en la Etapa 12, cuando haya oportunidad de una pasada visual completa.

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

Es la unica garantia de inmutabilidad que **no depende de que el codigo este bien escrito**. Un
`Deny` explicito no se puede sobrescribir con un `Allow`.

`BatchWriteItem` se incluye porque tambien puede borrar, y omitirlo dejaria abierta justo la
puerta que se intenta cerrar.

Debe existir prueba de integracion que confirme que el `Put` funciona y que el `Update` y el
`Delete` son rechazados (Etapa 3).

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
