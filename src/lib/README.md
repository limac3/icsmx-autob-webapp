# src/lib

Servicios y reglas de negocio, organizados por caracteristica: `src/lib/<feature>/<verbo>.ts`.

Excepcion: `src/lib/domain/` no habla con datos — son reglas puras, sin I/O (fechas, ventanas,
plazos, transiciones de estado, validacion de vehiculo). `src/lib/data/` es el unico lugar que
conoce DynamoDB, y `src/lib/media/` el unico que conoce S3 y CloudFront.

| Carpeta | Que vive aqui |
| --- | --- |
| `auth/` | Sesion, EAS, `puedeEjecutar` y la guarda `exigirPermiso` |
| `data/` | Cliente de DynamoDB, claves, transacciones, identificadores, eventos de bitacora |
| `domain/` | Reglas puras, sin I/O ni reloj propio |
| `media/` | Objetos en S3 y firma de URLs de CloudFront |
| `fila/` | Motor de fila. Hoy solo el prototipo de R18; la Etapa 8 escribe el resto |
| `vehiculos/` | Servicios del catalogo, un archivo por operacion |

Convenciones completas en `/AGENTS.md` y en `agent_files/estrategia-aplicacion.md`.
