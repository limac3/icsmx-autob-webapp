import { forbidden, redirect } from "next/navigation";
import { Primary } from "@churchofjesuschrist/eden-buttons";
import { FormField, Input, Select } from "@churchofjesuschrist/eden-form-parts";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import TablaVehiculos, {
  type NombreDeConvocatoria,
} from "@/components/TablaVehiculos";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { listarConvocatorias } from "@/lib/convocatorias/listarConvocatorias";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { firmarFotografia } from "@/lib/media/cloudfrontSigner";
import { listarVehiculos } from "@/lib/vehiculos/listarVehiculos";
import { ESTATUS_VEHICULO, type EstatusVehiculo } from "@/types/vehiculo";
import "./pagina.css";

/**
 * Catalogo administrativo — pantalla 4.1 de `ui-ux-requerimientos.md`.
 *
 * Dinamica: el catalogo cambia con cada alta y la pantalla es de trabajo. No
 * entra en cache estatica.
 *
 * **Los filtros son un `<form method="get">`**, no estado de cliente. Asi la
 * pantalla funciona sin JavaScript, el filtro queda en la URL —se puede
 * compartir y volver atras— y no hace falta un componente cliente.
 */
export const dynamic = "force-dynamic";

type Busqueda = { estatus?: string; q?: string };

const estatusPedido = (
  crudo: string | undefined,
): EstatusVehiculo[] | undefined => {
  if (!crudo) return undefined;
  return (ESTATUS_VEHICULO as readonly string[]).includes(crudo)
    ? [crudo as EstatusVehiculo]
    : undefined;
};

const CatalogoVehiculos = async ({
  searchParams,
}: {
  searchParams: Promise<Busqueda>;
}) => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("vehiculo:ver-catalogo");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.vehiculos;

  const { estatus, q } = await searchParams;
  const resultado = await listarVehiculos({
    estatus: estatusPedido(estatus),
    busqueda: q,
  });
  if (!resultado.ok)
    throw new Error(`No se pudo leer el catalogo: ${resultado.error}`);

  // Ver el catalogo lo pueden varios permisos; editarlo, solo uno
  // (`permission-matrix.md` seccion 2). Ocultar el boton es cortesia: la action
  // vuelve a comprobarlo.
  const puedeEditar = sesion.permisos.has("Autob_Administrar_Vehiculos");

  // **Una lectura, no una por vehiculo.** La columna de convocatoria activa
  // necesita el nombre, y el vehiculo solo guarda el `convocatoriaId`. Con el
  // catalogo en 500 items por estatus, resolverlo fila a fila seria una lectura
  // por fila; el listado completo de convocatorias son seis `Query` y se
  // cuentan por decenas al ano. Si falla, la columna sale vacia en vez de
  // tumbar el catalogo: es un dato de apoyo, no el objeto de la pantalla.
  // Las miniaturas se firman aqui, en cada peticion (regla 13): nunca se
  // persisten ni se generan dentro de un bloque `"use cache"`. Sale de la
  // clave desnormalizada en el propio item, asi que no cuesta una lectura por
  // fila — que era justo lo que impedia tener esta columna.
  const miniaturas: Record<string, string> = {};
  for (const uno of resultado.data) {
    if (uno.fotografiaPrincipalClave) {
      miniaturas[uno.vehiculoId] = firmarFotografia(
        uno.fotografiaPrincipalClave,
      );
    }
  }

  const listado = await listarConvocatorias();
  const convocatorias: Record<string, NombreDeConvocatoria> = {};
  if (listado.ok) {
    for (const una of listado.data) {
      convocatorias[una.convocatoriaId] = {
        nombre: una.nombre,
        folio: una.folio,
      };
    }
  }

  return (
    <main className="catalogo-vehiculos">
      <header className="catalogo-vehiculos__encabezado">
        <H1>{etiquetas.titulo}</H1>
        {puedeEditar ? (
          <Primary renderAs="a" href="/admin/vehiculos/nuevo">
            {etiquetas.nuevo}
          </Primary>
        ) : null}
      </header>

      <form method="get" className="catalogo-vehiculos__filtros">
        <FormField label={etiquetas.buscar}>
          <Input name="q" type="search" defaultValue={q ?? ""} />
        </FormField>
        <FormField label={etiquetas.filtrarPorEstatus}>
          {/* `<option>` nativo, no el `Option` de Eden. `Select` decide si
              monta su desplegable propio comparando `child.type === Option`, y
              esa identidad **no sobrevive la frontera de RSC**: los hijos que
              crea un Server Component llegan como referencias perezosas, la
              comparacion falla, y los `Option` terminan renderizados sin el
              contexto que necesitan — 500 en la peticion. Eden admite
              `child.type === "option"` de forma explicita, y esa rama es
              justo la que queremos: un `<select>` nativo que funciona sin
              JavaScript, que es el punto de este formulario GET.
              Ver desafios-implementacion.md seccion 23. */}
          <Select name="estatus" defaultValue={estatus ?? ""}>
            <option value="">{etiquetas.todos}</option>
            {ESTATUS_VEHICULO.map((uno) => (
              <option key={uno} value={uno}>
                {diccionario.estatusVehiculo[uno]}
              </option>
            ))}
          </Select>
        </FormField>
        <Primary type="submit">{etiquetas.buscar}</Primary>
      </form>

      {resultado.data.length === 0 && (q ?? estatus) ? (
        <Text2 renderAs="p">{etiquetas.sinResultados}</Text2>
      ) : (
        <TablaVehiculos
          vehiculos={resultado.data}
          diccionario={diccionario}
          idioma={idioma}
          puedeEditar={puedeEditar}
          puedeAuditar={sesion.permisos.has("Autob_Auditar")}
          convocatorias={convocatorias}
          miniaturas={miniaturas}
        />
      )}
    </main>
  );
};

export default CatalogoVehiculos;
