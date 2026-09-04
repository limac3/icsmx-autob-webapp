# Matriz de Permisos

Tabla de decision de `puedeEjecutar()` en `src/lib/auth/permisos.ts`. **Este documento es la
fuente; el codigo es su traduccion.** Si ambos discrepan, se corrige el codigo.

El mecanismo esta en `identidad-autorizacion.md`. Las reglas de negocio que sustentan las
guardas estan en `proyecto.md`.

---

## Abreviaturas de rol

| Clave | Rol |
| --- | --- |
| **ADM** | `ADMINISTRADOR` |
| **APR** | `APROBADOR_CONVOCATORIA` |
| **EMP** | `EMPLEADO` |
| **OTR** | `OTRO_USUARIO` |
| **TES** | `OPERADOR_TESORERIA` |
| **AUD** | `AUDITOR_CUMPLIMIENTO` |

Leyenda: **✅** permitido · **❌** denegado · **⚠️** permitido **solo si** se cumple la guarda
de la ultima columna.

Nomenclatura de accion: `dominio:verbo` en kebab-case. El prefijo agrupa por entidad y evita
colisiones al crecer el catalogo.

---

## 1. Vehiculos

| Accion | ADM | APR | EMP | OTR | TES | AUD | Guardas |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `vehiculo:crear` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| `vehiculo:editar` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | No si el vehiculo esta `RESERVADO` o `VENDIDO` |
| `vehiculo:ver-catalogo` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | Catalogo administrativo, no el publico |
| `vehiculo:retirar` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | Solo si esta `DISPONIBLE` |
| `vehiculo:subir-fotografia` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | No si esta `VENDIDO` |
| `vehiculo:eliminar-fotografia` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | No si esta `VENDIDO`; no se puede dejar sin fotografia principal |

> El aprobador ve el catalogo porque necesita revisar los vehiculos de la convocatoria que
> dictamina. No puede modificarlos.

---

## 2. Convocatorias — administracion

| Accion | ADM | APR | EMP | OTR | TES | AUD | Guardas |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `convocatoria:crear` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| `convocatoria:editar` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | Solo en `BORRADOR`. Fechas coherentes (R-14) |
| `convocatoria:ver-administracion` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | — |
| `convocatoria:incluir-vehiculo` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | Solo en `BORRADOR`; el vehiculo debe estar `DISPONIBLE` (R-10) |
| `convocatoria:retirar-vehiculo` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | Solo en `BORRADOR`; el lote sin solicitudes vivas |
| `convocatoria:enviar-a-aprobacion` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | Desde `BORRADOR`; al menos un lote; fechas validas |
| `convocatoria:aprobar` | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | Desde `EN_APROBACION` y **`creadoPor !== participanteId`** (R-05) |
| `convocatoria:rechazar` | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | Desde `EN_APROBACION`; **motivo obligatorio**; misma guarda de auto-aprobacion |
| `convocatoria:publicar` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | Solo desde `APROBADA` |
| `convocatoria:ocultar` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | **Denegado si existe cualquier solicitud** (R-06) |
| `convocatoria:reactivar` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | Solo desde `OCULTA`; vuelve a `BORRADOR` |
| `convocatoria:concluir` | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | Desde `PUBLICADA`, pasado `finVenta` o sin solicitudes vivas |

> **`convocatoria:aprobar` esta denegada para ADM incluso teniendo ambos roles.** La guarda es
> por identidad, no por rol: es el unico caso de la matriz donde tener el rol correcto no basta.

---

## 3. Convocatorias — participacion

| Accion | ADM | APR | EMP | OTR | TES | AUD | Guardas |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `convocatoria:ver-publicada` | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | **Gating triple** (R-01): `PUBLICADA` **y** `publicadaEn <= ahora` **y** tipo compatible |
| `lote:ver-detalle` | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | La convocatoria debe pasar el gating triple |

**El gating triple se aplica a todos, sin excepcion administrativa.** Un `ADMINISTRADOR` que
quiera revisar una convocatoria no publicada usa `convocatoria:ver-administracion`, no la vista
publica. Mantener una sola puerta sin atajos es lo que hace la regla auditable.

**Compatibilidad de tipo:**

| Tipo de convocatoria | `EMPLEADO` | `OTRO_USUARIO` |
| --- | :-: | :-: |
| `PUBLICO_GENERAL` | ✅ | ✅ |
| `EMPLEADOS` | ✅ | ❌ → **404** |

Un `OTRO_USUARIO` que pida por URL directa una convocatoria de empleados recibe **404**, no 403
(R-01): un 403 confirmaria que existe.

---

## 4. Fila y solicitudes

| Accion | ADM | APR | EMP | OTR | TES | AUD | Guardas |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `solicitud:crear` | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | Venta abierta (`inicioVenta <= ahora < finVenta`); gating triple; sin solicitud viva propia en el lote (R-07) |
| `solicitud:ver-mi-lugar` | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | Solo la propia. DTO limitado a `miTurno`, `miPosicion`, `tamanoFila` (R-12) |
| `solicitud:ver-mis-solicitudes` | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | Filtrado por `titularId` en la consulta, no despues |
| `solicitud:cancelar` | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | `titularId === participanteId`; estado `EN_FILA`, `CONGELADA` o `ADJUDICADA` |
| `fila:ver-completa` | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | **Solo AUD**, y solo desde la vista de auditoria |

> **`ADMINISTRADOR` no puede solicitar compra ni ver una fila completa.** Quien configura la
> venta no participa en ella ni conoce el orden: es la separacion que sostiene la equidad del
> proceso. Si una persona necesita ambas cosas, participa con una cuenta sin rol
> administrativo.
>
> `fila:ver-completa` es la unica accion que expone identidades de terceros. Esta reservada al
> auditor y no tiene contraparte en ninguna pantalla de participante.

---

## 5. Pago y tesoreria

| Accion | ADM | APR | EMP | OTR | TES | AUD | Guardas |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `comprobante:subir` | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | `titularId === participanteId`; estado `ADJUDICADA`; **dentro del plazo** (`ahora <= venceEn`) |
| `comprobante:descargar` | ❌ | ❌ | ⚠️ | ⚠️ | ✅ | ✅ | Participante: **solo el propio**. TES y AUD: cualquiera |
| `tesoreria:ver-bandeja` | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | AUD en solo lectura |
| `pago:avalar` | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | Estado `EN_VERIFICACION` |
| `pago:rechazar` | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | Estado `EN_VERIFICACION`; **motivo obligatorio** (R-16) |

> `comprobante:descargar` es la guarda mas facil de olvidar: sin `titularId === participanteId`,
> cualquier participante autenticado podria descargar el comprobante de otro cambiando el
> identificador de la URL. Es un Route Handler, no una Server Action, y **debe verificar el
> permiso por su cuenta** — no hereda ninguna proteccion.

---

## 6. Auditoria

| Accion | ADM | APR | EMP | OTR | TES | AUD | Guardas |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `auditoria:ver-bitacora` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | — |
| `auditoria:ver-fila-historica` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | Reconstruye turnos e identidades de un lote |
| `auditoria:exportar` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | La exportacion misma se audita |

**`AUDITOR_CUMPLIMIENTO` tiene denegada toda accion de mutacion de la aplicacion, sin
excepcion.** No es una consecuencia de no aparecer con ✅ en las tablas anteriores: es una
invariante que debe probarse explicitamente.

---

## 7. Invariantes verificables por prueba

Cada una es un test que debe existir. No son comentarios.

1. **`AUDITOR_CUMPLIMIENTO` no puede mutar nada.** Recorrer el catalogo completo de acciones y
   afirmar que toda accion de mutacion devuelve `permitido: false`.
2. **Ningun rol administrativo puede solicitar compra.** `ADM`, `APR`, `TES` y `AUD` reciben
   denegacion en `solicitud:crear`.
3. **Auto-aprobacion denegada.** Un usuario con `ADMINISTRADOR` y `APROBADOR_CONVOCATORIA` no
   puede aprobar una convocatoria cuyo `creadoPor` sea el mismo.
4. **`OTRO_USUARIO` y las convocatorias de empleados.** Denegado en `convocatoria:ver-publicada`
   y en `solicitud:crear` sobre convocatorias `EMPLEADOS`.
5. **Propiedad del comprobante.** Un participante no puede descargar ni subir el comprobante de
   una solicitud ajena.
6. **Cobertura total de la matriz.** Un test recorre el producto cartesiano rol x accion y
   verifica que cada celda coincide con este documento. Una accion nueva sin entrada en la
   matriz hace fallar la prueba — es lo que impide que el catalogo y la tabla se separen con el
   tiempo.
7. **Cerrado por omision.** Una accion desconocida devuelve `permitido: false`, nunca `true`.

---

## 8. Reglas de mantenimiento

- Accion nueva → primero se agrega **aqui**, despues al codigo.
- La matriz es **cerrada por omision**: lo que no esta explicitamente permitido, esta denegado.
- Las guardas contextuales nunca se implementan en la UI. La UI oculta; el servidor decide.
- Un cambio en esta tabla obliga a revisar `api-contracts.md`, donde cada action declara la
  accion de permiso que exige.
