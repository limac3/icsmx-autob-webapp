# icsmx-autob-webapp

Aplicacion web para la **venta de vehiculos obsoletos de flotilla** mediante convocatorias
de venta con fila de adjudicacion por orden de llegada (FIFO) y trazabilidad auditable.

> Estado: **etapas 0 a 6 completadas**, mas el prototipo concurrente de la fila. Hay identidad y
> autorizacion por permisos, infraestructura Amplify Gen2 desplegable, las reglas puras de
> dominio con la capa de acceso a datos, el motor de fila validado contra DynamoDB real —turnos
> unicos, orden estricto y un solo ganador bajo concurrencia—, el **catalogo de vehiculos
> administrable** con su galeria de fotografias servida por CloudFront con URL firmada, y el
> **ciclo completo de la convocatoria**: borrador, inclusion de vehiculos como lotes, aprobacion
> por alguien distinto de quien la creo, publicacion, ocultamiento y conclusion.
> El plan de ejecucion vive en [agent_files/plan-ejecucion.md](agent_files/plan-ejecucion.md).

---

## Que hace

Un administrador registra vehiculos (marca, version, modelo/anio, nivel de equipamiento,
especificacion y condiciones mecanicas, detalles esteticos, kilometraje, fotografia principal
y fotografias adicionales) y los agrupa en **convocatorias de venta**.

Cada convocatoria define fecha y hora de publicacion, fecha y hora de inicio de venta,
fecha y hora de fin de venta, horas para liquidacion del pago, tipo (empleados o publico
general), descripcion de participacion y estatus (borrador, aprobada, publicada, concluida,
oculta). Pasa por aprobacion antes de publicarse.

Cuando llega la hora de inicio de venta, los participantes autenticados solicitan la compra.
Las solicitudes forman una **fila estrictamente ordenada por turno asignado en el servidor**:
el primero obtiene la adjudicacion y recibe los datos de pago. El resto ve unicamente su
numero de lugar y el tamano de la fila — nunca los nombres de los demas.

El cobro ocurre en un sistema externo. El adjudicado adjunta aqui su comprobante de pago,
la solicitud pasa a verificacion y un operador de tesoreria avala el pago y marca el vehiculo
como vendido. Si se excede el plazo de liquidacion sin comprobante, o si tesoreria declara que
el pago no se realizo, la solicitud se cancela y el vehiculo se **adjudica automaticamente al
siguiente de la fila**, notificandolo por correo.

Los vehiculos no vendidos al concluir una convocatoria de empleados pueden incluirse en una
convocatoria posterior para publico general.

## Perfiles

| Perfil | Capacidad principal |
| --- | --- |
| `ADMINISTRADOR` | Alta de vehiculos y fotografias, creacion de convocatorias, inclusion de vehiculos |
| `APROBADOR_CONVOCATORIA` | Aprueba o rechaza convocatorias antes de su publicacion |
| `EMPLEADO` | Participa en convocatorias de empleados y de publico general |
| `OTRO_USUARIO` | Participa solo en convocatorias de publico general |
| `OPERADOR_TESORERIA` | Avala o rechaza comprobantes de pago, marca el vehiculo como vendido |
| `AUDITOR_CUMPLIMIENTO` | Consulta de solo lectura de la bitacora completa para verificar equidad y orden |

## Stack

| Capa | Tecnologia |
| --- | --- |
| Framework | Next.js 16 App Router + React 19, **TypeScript** (`strict`) |
| UI | Eden (`@churchofjesuschrist/eden-*`), mobile-first, MCP de Eden habilitado |
| Identidad | Okta OIDC via `@auth0/nextjs-auth0` v4 + EAS para **permisos** (no roles) |
| Datos | DynamoDB (single-table design) via `@aws-sdk/lib-dynamodb` |
| Archivos | S3 + CloudFront con URLs firmadas |
| Correo | CES (Church Email Service, REST corporativo) con patron outbox |
| Infra / IaC | AWS Amplify Gen2 (`defineBackend` + constructos CDK) y Amplify Hosting SSR |
| Calidad | `@churchofjesuschrist/festack-scripts` (ESLint + Stylelint + Prettier + Vitest 4 + axe) |

## Comandos

```bash
npm run dev        # servidor de desarrollo (puerto 3000)
npm run format     # aplica Prettier (ejecutar antes de verify si hubo cambios)
npm run typecheck  # tsc --noEmit
npm run test       # Vitest
npm run verify:rapido  # compuerta completa sin el chequeo de desactualizados (~50 s)
npm run prototipo:fila # prototipo concurrente de la fila contra el sandbox (R18, ~2 min)
npm run verify     # lo anterior + chequeo de paquetes desactualizados (~2.5 min)
npm run build      # build de produccion
npx ampx sandbox   # backend Amplify Gen2 personal (DynamoDB + S3 + Lambdas)
```

## Configuracion local

```bash
cp .env.local.example .env.local
```

Variables minimas: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH_SECRET`,
`APP_BASE_URL`, `AUTOB_TABLE_NAME`, `AUTOB_MEDIA_BUCKET`, `CLOUDFRONT_*`, `AWS_REGION`,
`CES_FROM_ADDRESS`, `ENABLE_DEV_TOOLS`. El detalle esta en `.env.local.example`.

El registro de npm es el Artifactory privado (`.npmrc` + `NODE_AUTH_TOKEN`).

## Documentacion

Toda la documentacion de contexto para agentes de IA y para el equipo vive en `agent_files/`.
Empieza por [agent_files/plan-ejecucion.md](agent_files/plan-ejecucion.md) y por
[CLAUDE.md](CLAUDE.md).
