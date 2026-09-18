import { forbidden, notFound, redirect } from "next/navigation";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Badge } from "@churchofjesuschrist/eden-badge";
import FormularioVehiculo from "@/components/FormularioVehiculo";
import GaleriaVehiculo, {
  type FotografiaEnGaleria,
} from "@/components/GaleriaVehiculo";
import RetirarVehiculo from "@/components/RetirarVehiculo";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { modeloMaximo } from "@/lib/domain/vehiculos";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { firmarFotografia } from "@/lib/media/cloudfrontSigner";
import { fuentesDeImagen } from "@/lib/media/fuentesDeImagen";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import { ANCHOS_DE_VARIANTE } from "@/types/vehiculo";

/**
 * Edicion de vehiculo — pantalla 4.2 de `ui-ux-requerimientos.md`.
 *
 * **Dinamica y sin `"use cache"`, y no es negociable:** aqui se firman URLs de
 * CloudFront. Una URL firmada dentro de un bloque cacheado se repartiria entre
 * usuarios y sobreviviria a su vencimiento (regla 13).
 */
export const dynamic = "force-dynamic";

const EditarVehiculo = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  if (!(await getSession())) redirect("/auth/login");

  const { id } = await params;
  const lectura = await obtenerVehiculo(id);
  if (!lectura.ok) notFound();

  const vehiculo = lectura.data;

  // El permiso de ver el catalogo abre la pantalla; el de administrar es lo que
  // habilita guardar. Un aprobador o un auditor pueden mirar la ficha.
  const puedeVer = await exigirPermiso("vehiculo:ver-catalogo");
  if (!puedeVer.ok) forbidden();

  const puedeEditar = await exigirPermiso("vehiculo:editar", {
    estatusVehiculo: vehiculo.estatus,
  });
  const puedeRetirar = await exigirPermiso("vehiculo:retirar", {
    estatusVehiculo: vehiculo.estatus,
  });
  const puedeTocarGaleria = await exigirPermiso("vehiculo:subir-fotografia", {
    estatusVehiculo: vehiculo.estatus,
  });

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);

  // Se firma **por peticion**, aqui, y no se guarda en ningun lado.
  //
  // Sin la variante de 2048: esta pantalla no tiene visor ampliado, asi que
  // nada muestra la fotografia a ese tamano.
  const fotografias: FotografiaEnGaleria[] = vehiculo.fotografias.map(
    (foto) => ({
      fotoId: foto.fotoId,
      orden: foto.orden,
      descripcion: foto.descripcion,
      fuentes: fuentesDeImagen(foto, {
        anchoMaximo: ANCHOS_DE_VARIANTE.med,
        firmar: firmarFotografia,
      }),
      esPrincipal: foto.fotoId === vehiculo.fotografiaPrincipalId,
    }),
  );

  return (
    <main className="pagina-vehiculo">
      <H1>{`${vehiculo.marca} ${vehiculo.version}`}</H1>
      <Badge>{diccionario.estatusVehiculo[vehiculo.estatus]}</Badge>

      <FormularioVehiculo
        diccionario={diccionario}
        modeloMaximo={modeloMaximo(new Date())}
        vehiculoId={vehiculo.vehiculoId}
        valores={vehiculo}
        soloLectura={!puedeEditar.ok}
      />

      {/* El encabezado "Fotografias" lo pinta `GaleriaVehiculo`, no esta
          pagina: el boton de agregar va a su lado y es una accion de la
          seccion, no de la pantalla. */}
      <GaleriaVehiculo
        vehiculoId={vehiculo.vehiculoId}
        fotografias={fotografias}
        diccionario={diccionario}
        puedeEditar={puedeTocarGaleria.ok}
        idioma={idioma}
      />

      {puedeRetirar.ok ? (
        <RetirarVehiculo
          vehiculoId={vehiculo.vehiculoId}
          diccionario={diccionario}
        />
      ) : null}
    </main>
  );
};

export default EditarVehiculo;
