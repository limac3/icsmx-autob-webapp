# src/lib

Servicios y reglas de negocio, organizados por caracteristica: `src/lib/<feature>/<verbo>.ts`.

Excepcion: `src/lib/domain/` no habla con datos — son reglas puras, sin I/O (fechas, ventanas,
plazos, transiciones de estado). `src/lib/data/` es el unico lugar que conoce DynamoDB.

Convenciones completas en `/AGENTS.md` y en `agent_files/estrategia-aplicacion.md`.
