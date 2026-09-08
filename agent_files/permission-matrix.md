# Matriz de Permisos

Tabla de decision de `puedeEjecutar()` en `src/lib/auth/permisos.ts`. **Este documento es la
fuente; el codigo es su traduccion.** Si ambos discrepan, se corrige el codigo.

El mecanismo esta en `identidad-autorizacion.md`. Las reglas de negocio que sustentan las
guardas estan en `proyecto.md`.

---

## 0. Principio: EAS decide la capacidad, la aplicacion decide la aplicabilidad

**EAS no responde roles. Responde un booleano por permiso.** La aplicacion le pregunta por
nombres de permiso; EAS los calcula con sus propias reglas internas a partir de los roles y
caracteristicas del usuario.

De ahi sale la division que estructura este documento:

| Decide | Quien | Ejemplo |
| --- | --- | --- |
| **Capacidad** — si esta persona puede hacer esta clase de cosa | **EAS** | "¿puede operar tesoreria?" |
| **Aplicabilidad** — si esta cosa se puede hacer *sobre este recurso, ahora* | **la aplicacion** | "¿esta solicitud esta en `EN_VERIFICACION`?" |

La aplicacion **nunca** codifica politica organizacional. No hay listas de roles permitidos ni
exclusiones por rol: si manana la organizacion decide que un administrador tambien puede
comprar, eso se configura en EAS y **este repositorio no cambia**.

Una accion puede admitir **varios permisos alternativos** (columna "Permiso", separados por `o`).
Eso no reintroduce el problema de unir roles: cada permiso es una capacidad que la organizacion
concedio explicitamente en EAS.

La columna "Guardas" es la parte que **si** vive en el codigo, porque EAS no puede conocerla —
estado de la maquina, propiedad del recurso, auto-aprobacion y plazos.

Nomenclatura de accion: `dominio:verbo` en kebab-case. El prefijo agrupa por entidad y evita
colisiones al crecer el catalogo.

---

## 1. Catalogo de permisos

> **Pendiente de confirmacion con el equipo de EAS.** Los nombres son una propuesta a
> granularidad de capacidad, no una por accion. Hasta que el operador confirme nombres y
> contrato del endpoint, el adaptador real no se cierra y se trabaja con `ENABLE_DEV_TOOLS`
> (riesgo R19 de `plan-ejecucion.md`).

| Permiso | Habilita |
| --- | --- |
| `Autob_Administrar_Vehiculos` | Alta, edicion, retiro y fotografias de vehiculos |
| `Autob_Administrar_Convocatorias` | Ciclo completo de la convocatoria salvo el dictamen |
| `Autob_Aprobar_Convocatorias` | Aprobar y rechazar convocatorias |
| `Autob_Venta_a_empleados` | Ver y participar en convocatorias `EMPLEADOS` |
| `Autob_Venta_en_general` | Ver y participar en convocatorias `PUBLICO_GENERAL` |
| `Autob_Operar_Tesoreria` | Bandeja, aval, rechazo y descarga de cualquier comprobante |
| `Autob_Auditar` | Bitacora, fila completa, exportacion y lectura de tesoreria |

**Un empleado recibe los dos permisos de venta.** Eso reemplaza la antigua regla "`EMPLEADO` es
superconjunto de `OTRO_USUARIO`" sin ningun caso especial en el codigo: la relacion de
superconjunto pasa a ser una decision de configuracion de EAS.

---

## 2. Vehiculos

| Accion | Permiso | Guardas |
| --- | --- | --- |
| `vehiculo:crear` | `Autob_Administrar_Vehiculos` | — |
| `vehiculo:editar` | `Autob_Administrar_Vehiculos` | No si el vehiculo esta `RESERVADO` o `VENDIDO` |
| `vehiculo:ver-catalogo` | `Autob_Administrar_Vehiculos` o `Autob_Administrar_Convocatorias` o `Autob_Aprobar_Convocatorias` o `Autob_Auditar` | Catalogo administrativo, no el publico |
| `vehiculo:retirar` | `Autob_Administrar_Vehiculos` | Solo si esta `DISPONIBLE` |
| `vehiculo:subir-fotografia` | `Autob_Administrar_Vehiculos` | No si esta `VENDIDO` |
| `vehiculo:eliminar-fotografia` | `Autob_Administrar_Vehiculos` | No si esta `VENDIDO`; no se puede dejar sin fotografia principal |

> Quien aprueba y quien audita ven el catalogo porque necesitan revisar los vehiculos de la
> convocatoria que dictaminan o fiscalizan. Ninguno de esos permisos los deja modificar.

---

## 3. Convocatorias — administracion

| Accion | Permiso | Guardas |
| --- | --- | --- |
| `convocatoria:crear` | `Autob_Administrar_Convocatorias` | — |
| `convocatoria:editar` | `Autob_Administrar_Convocatorias` | Solo en `BORRADOR`. Fechas coherentes (R-14) |
| `convocatoria:ver-administracion` | `Autob_Administrar_Convocatorias` o `Autob_Aprobar_Convocatorias` o `Autob_Auditar` | — |
| `convocatoria:ver-aprobaciones` | `Autob_Aprobar_Convocatorias` | — |
| `convocatoria:incluir-vehiculo` | `Autob_Administrar_Convocatorias` | Solo en `BORRADOR`; el vehiculo debe estar `DISPONIBLE` (R-10) |
| `convocatoria:retirar-vehiculo` | `Autob_Administrar_Convocatorias` | Solo en `BORRADOR`; el lote sin solicitudes vivas |
| `convocatoria:enviar-a-aprobacion` | `Autob_Administrar_Convocatorias` | Desde `BORRADOR`; al menos un lote; fechas validas |
| `convocatoria:aprobar` | `Autob_Aprobar_Convocatorias` | Desde `EN_APROBACION` y **`creadoPor !== participanteId`** (R-05) |
| `convocatoria:rechazar` | `Autob_Aprobar_Convocatorias` | Desde `EN_APROBACION`; **motivo obligatorio**; misma guarda de auto-aprobacion |
| `convocatoria:publicar` | `Autob_Administrar_Convocatorias` | Solo desde `APROBADA` |
| `convocatoria:ocultar` | `Autob_Administrar_Convocatorias` | Desde `PUBLICADA` **solo si no existe ninguna solicitud** (R-06); libre desde `BORRADOR`, `EN_APROBACION` o `APROBADA` |
| `convocatoria:reactivar` | `Autob_Administrar_Convocatorias` | Solo desde `OCULTA`; vuelve a `BORRADOR` |
| `convocatoria:concluir` | `Autob_Administrar_Convocatorias` | Desde `PUBLICADA`, pasado `finVenta` o sin solicitudes vivas |

> **`convocatoria:ver-aprobaciones` es la bandeja, no el detalle.** Solo abre la lista de lo que
> espera dictamen, y por eso exige unicamente el permiso de aprobacion: quien administra ya ve
> esas convocatorias en su propia pestana de `EN_APROBACION`, y quien audita las ve en la suya.
> Separarla de `ver-administracion` no oculta ningun dato nuevo; lo que hace es que la pantalla
> del aprobador tenga una puerta propia y la matriz diga a quien pertenece.
>
> **`convocatoria:aprobar` se deniega a quien creo la convocatoria, aunque tenga el permiso.**
> La guarda es por identidad, no por capacidad: es el caso mas claro de por que EAS no basta.
> Quien concedio el permiso no puede saber quien creo *esta* convocatoria.

---

## 4. Convocatorias — participacion

| Accion | Permiso | Guardas |
| --- | --- | --- |
| `convocatoria:ver-publicada` | `Autob_Venta_a_empleados` o `Autob_Venta_en_general` | **Gating triple** (R-01): `PUBLICADA` **y** `publicadaEn <= ahora` **y** el permiso que corresponde al tipo |
| `lote:ver-detalle` | `Autob_Venta_a_empleados` o `Autob_Venta_en_general` | La convocatoria debe pasar el gating triple |

**Compatibilidad de tipo — la tercera pata del gating:**

| Tipo de convocatoria | Permiso exigido |
| --- | --- |
| `EMPLEADOS` | `Autob_Venta_a_empleados` |
| `PUBLICO_GENERAL` | `Autob_Venta_en_general` |

Quien no tenga el permiso del tipo recibe **404**, no 403 (R-01): un 403 confirmaria que existe.

> **Cambio respecto de la matriz por roles.** Antes los seis roles podian entrar a la vista
> publica y solo el tipo de participante los filtraba. Ahora la vista publica exige un permiso de
> venta. Quien administra, aprueba o audita usa `convocatoria:ver-administracion`, que es la
> puerta que le corresponde. Si la organizacion quiere que alguien mas navegue el catalogo, le
> concede `Autob_Venta_en_general` en EAS — sin tocar codigo.
>
> **El gating triple no tiene excepcion administrativa.** Mantener una sola puerta sin atajos es
> lo que hace la regla auditable.

---

## 5. Fila y solicitudes

| Accion | Permiso | Guardas |
| --- | --- | --- |
| `solicitud:crear` | `Autob_Venta_a_empleados` o `Autob_Venta_en_general` | Venta abierta (`inicioVenta <= ahora < finVenta`); gating triple; sin solicitud viva propia en el lote (R-07) |
| `solicitud:ver-mi-lugar` | `Autob_Venta_a_empleados` o `Autob_Venta_en_general` | Solo la propia. DTO limitado a `miTurno`, `miPosicion`, `tamanoFila` (R-12) |
| `solicitud:ver-mis-solicitudes` | `Autob_Venta_a_empleados` o `Autob_Venta_en_general` | Filtrado por `titularId` en la consulta, no despues |
| `solicitud:cancelar` | `Autob_Venta_a_empleados` o `Autob_Venta_en_general` | `titularId === participanteId`; estado `EN_FILA`, `CONGELADA` o `ADJUDICADA` |
| `fila:ver-completa` | `Autob_Auditar` | Solo desde la vista de auditoria |

> **Ningun permiso administrativo habilita `solicitud:crear`.** Quien configura la venta no
> participa en ella: es la separacion que sostiene la equidad del proceso. Hoy la organizacion la
> mantiene no concediendo permisos de venta a quien administra. **Si esa politica cambia, cambia
> en EAS** — la aplicacion no la codifica ni la impide.
>
> `fila:ver-completa` es la unica accion que expone identidades de terceros. No tiene contraparte
> en ninguna pantalla de participante.

---

## 6. Pago y tesoreria

| Accion | Permiso | Guardas |
| --- | --- | --- |
| `comprobante:subir` | `Autob_Venta_a_empleados` o `Autob_Venta_en_general` | `titularId === participanteId`; estado `ADJUDICADA`; **dentro del plazo** (`ahora <= venceEn`) |
| `comprobante:descargar` | `Autob_Venta_a_empleados` o `Autob_Venta_en_general` o `Autob_Operar_Tesoreria` o `Autob_Auditar` | Con permiso de venta: **solo el propio**. Con `Autob_Operar_Tesoreria` o `Autob_Auditar`: cualquiera |
| `tesoreria:ver-bandeja` | `Autob_Operar_Tesoreria` o `Autob_Auditar` | `Autob_Auditar` en solo lectura |
| `pago:avalar` | `Autob_Operar_Tesoreria` | Estado `EN_VERIFICACION` |
| `pago:rechazar` | `Autob_Operar_Tesoreria` | Estado `EN_VERIFICACION`; **motivo obligatorio** (R-16) |

> `comprobante:descargar` es la guarda mas facil de olvidar: sin `titularId === participanteId`,
> cualquier participante autenticado podria descargar el comprobante de otro cambiando el
> identificador de la URL. Es un Route Handler, no una Server Action, y **debe verificar el
> permiso por su cuenta** — no hereda ninguna proteccion.

---

## 7. Auditoria

| Accion | Permiso | Guardas |
| --- | --- | --- |
| `auditoria:ver-bitacora` | `Autob_Auditar` | — |
| `auditoria:ver-fila-historica` | `Autob_Auditar` | Reconstruye turnos e identidades de un lote |
| `auditoria:exportar` | `Autob_Auditar` | La exportacion misma se audita |

**`Autob_Auditar` por si solo no habilita ninguna mutacion.** Es una invariante del permiso, y se
prueba recorriendo el catalogo completo. Lo que **no** es —y antes se afirmaba— es una propiedad
de la persona: si EAS le concede a alguien `Autob_Auditar` y `Autob_Operar_Tesoreria` a la vez,
esa persona puede avalar pagos, porque la organizacion lo decidio. Separar fiscalizacion de
operacion es una politica de EAS, no una regla de este repositorio.

---

## 8. Simulacion de roles — **solo desarrollo**

En desarrollo no hay EAS. `ENABLE_DEV_TOOLS` habilita una simulacion que sigue razonando en
**roles**, porque es como piensa el equipo, y los traduce a permisos con esta tabla.
`src/lib/auth/devMode.ts` **lanza** si el modo no es `OFF` en produccion.

| Rol simulado | Permisos que recibe |
| --- | --- |
| `ADMINISTRADOR` | `Autob_Administrar_Vehiculos`, `Autob_Administrar_Convocatorias` |
| `APROBADOR_CONVOCATORIA` | `Autob_Aprobar_Convocatorias` |
| `EMPLEADO` | `Autob_Venta_a_empleados`, `Autob_Venta_en_general` |
| `OTRO_USUARIO` | `Autob_Venta_en_general` |
| `OPERADOR_TESORERIA` | `Autob_Operar_Tesoreria` |
| `AUDITOR_CUMPLIMIENTO` | `Autob_Auditar` |

Esta tabla es **la unica** parte del sistema donde sobrevive el concepto de rol, y es la unica
que puede afirmar "un administrador no compra": ahi es una conveniencia de desarrollo, no una
regla de negocio. `DEV_TOOLS_MOCK_PERMISOS` permite saltarse la tabla y fijar permisos sueltos
para casos borde que ningun rol representa.

---

## 9. Invariantes verificables por prueba

Cada una es un test que debe existir. No son comentarios.

1. **`Autob_Auditar` no muta nada.** Recorrer el catalogo **completo** y afirmar que toda accion
   de mutacion se deniega a quien solo tiene ese permiso.
2. **Ningun permiso administrativo habilita comprar.** `Autob_Administrar_Vehiculos`,
   `Autob_Administrar_Convocatorias`, `Autob_Aprobar_Convocatorias`, `Autob_Operar_Tesoreria` y
   `Autob_Auditar`, solos o combinados entre si, reciben denegacion en `solicitud:crear`.
3. **Auto-aprobacion denegada.** Quien tiene `Autob_Aprobar_Convocatorias` no puede aprobar una
   convocatoria cuyo `creadoPor` sea el mismo.
4. **Tipo de convocatoria.** Sin `Autob_Venta_a_empleados` se deniega `convocatoria:ver-publicada`
   y `solicitud:crear` sobre convocatorias `EMPLEADOS`, aunque se tenga `Autob_Venta_en_general`.
5. **Propiedad del comprobante.** Un participante no puede descargar ni subir el comprobante de
   una solicitud ajena.
6. **Cobertura total de la matriz.** Un test recorre el producto cartesiano permiso x accion y
   verifica que cada celda coincide con este documento. La lista de acciones esperadas se compara
   contra **las claves reales del catalogo**, no contra un numero: una accion nueva sin entrada
   en la matriz debe hacer fallar la prueba.
7. **Cerrado por omision de accion.** Una accion desconocida devuelve `permitido: false`.
8. **Cerrado por omision de contexto.** Para cada accion con guarda, partir del contexto minimo
   que **si** la satisface y quitar **un campo a la vez**: cada version incompleta debe denegar.
   Si al retirar un campo la accion se sigue permitiendo, ese campo no se estaba exigiendo de
   verdad — es lo que ocurre con una precondicion que solo rechaza `=== false` y deja pasar
   `undefined`.

   > Probar unicamente con el contexto **vacio** no basta y es un error facil de cometer: las
   > comprobaciones de estado (`estatusConvocatoria !== "BORRADOR"`) deniegan primero y enmascaran
   > la precondicion booleana que viene despues. La prueba pasaria sin ejercer el defecto.

   Excepcion declarada: `comprobante:descargar` con `Autob_Operar_Tesoreria` o `Autob_Auditar`
   concede por capacidad sola, sin mirar el recurso (seccion 6). La prueba la lista de forma
   explicita, para que agregar otra obligue a justificarla.

---

## 10. Reglas de mantenimiento

- Accion nueva → primero se agrega **aqui**, despues al codigo.
- La matriz es **cerrada por omision**: lo que no esta explicitamente permitido, esta denegado.
- **Politica organizacional nueva → se configura en EAS, no aqui.** Si una regla se puede
  expresar como "quien tiene tal permiso puede tal cosa", no lleva codigo.
- Las guardas contextuales nunca se implementan en la UI. La UI oculta; el servidor decide.
- Un cambio en esta tabla obliga a revisar `api-contracts.md`, donde cada action declara la
  accion de permiso que exige.
