import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import AvisoDeVistaPrevia, {
  type AvisoDeVistaPreviaProps,
} from "./AvisoDeVistaPrevia";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const diccionario = obtenerDiccionario("es");

const props: AvisoDeVistaPreviaProps = {
  aunNoVisible: true,
  publicadaEn: new Date("2026-09-20T15:00:00.000Z"),
  rutaDelDetalle: "/admin/convocatorias/CONV1",
  diccionario,
};

const context = getTestContext();

genericTests(context, AvisoDeVistaPrevia, props);

describe("AvisoDeVistaPrevia", () => {
  const pintar = async (extra: Partial<AvisoDeVistaPreviaProps> = {}) => {
    await act(async () => {
      context.root.render(<AvisoDeVistaPrevia {...props} {...extra} />);
    });
    return context.container.textContent ?? "";
  };

  it("cuando no es visible dice desde cuando lo sera", async () => {
    const texto = await pintar();

    expect(texto).toContain(diccionario.convocatorias.vistaPreviaAunNoVisible);
    expect(texto).toContain(diccionario.catalogo.horaDeNegocio);
    expect(texto).not.toContain(diccionario.convocatorias.vistaPreviaVisible);
  });

  it("cuando ya es visible no habla del futuro", async () => {
    const texto = await pintar({ aunNoVisible: false });

    expect(texto).toContain(diccionario.convocatorias.vistaPreviaVisible);
    expect(texto).not.toContain(
      diccionario.convocatorias.vistaPreviaAunNoVisible,
    );
  });

  it("su etiqueta no se confunde con la del propio contenido", async () => {
    // Las dos salidas conviven en la vista previa del vehiculo: esta lleva a
    // la administracion y la otra a la convocatoria en vista previa. Con la
    // misma etiqueta —las dos decian "Volver a la convocatoria"— no habia
    // forma de saber cual era cual.
    const texto = await pintar();

    expect(texto).toContain(diccionario.convocatorias.salirDeLaVistaPrevia);
    expect(diccionario.convocatorias.salirDeLaVistaPrevia).not.toBe(
      diccionario.catalogo.volverALaConvocatoria,
    );
  });

  it("siempre deja la salida al detalle administrativo", async () => {
    // Es la unica salida de la vista previa: el resto de los enlaces se
    // quedan dentro de ella a proposito.
    await pintar();

    expect(context.container.querySelector("a")?.getAttribute("href")).toBe(
      "/admin/convocatorias/CONV1",
    );
  });
});
