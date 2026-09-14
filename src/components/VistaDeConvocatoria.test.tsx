import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import type { Convocatoria } from "@/types/convocatoria";
import VistaDeConvocatoria, {
  type VistaDeConvocatoriaProps,
} from "./VistaDeConvocatoria";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const diccionario = obtenerDiccionario("es");

const CONVOCATORIA: Convocatoria = {
  convocatoriaId: "CONV1",
  folio: "SEP-2026",
  nombre: "Septiembre de 2026",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "<p>Abierta al <strong>personal</strong>.</p>",
  publicadaEn: "2026-09-01T15:00:00.000Z",
  inicioVenta: "2026-09-05T15:00:00.000Z",
  finVenta: "2026-09-12T23:00:00.000Z",
  horasLiquidacion: 48,
  estatus: "PUBLICADA",
  creadoEn: "2026-08-20T15:00:00.000Z",
  creadoPor: "okta|1",
};

const props = {
  convocatoria: CONVOCATORIA,
  lotes: [],
  estadoDeVenta: { fase: "VENTA_ABIERTA", cierraFormateado: "12 sep 2026" },
  inicioVenta: new Date("2026-09-05T15:00:00.000Z"),
  finVenta: new Date("2026-09-12T23:00:00.000Z"),
  diccionario,
  idioma: "es",
} as const;

const context = getTestContext();

genericTests(context, VistaDeConvocatoria, { ...props });

describe("VistaDeConvocatoria", () => {
  // **Es el mismo componente que ve el participante y el que revisa quien
  // administra** (`/admin/convocatorias/[id]/vista-publica`). Que sea uno solo
  // es lo que hace que la vista previa sea una vista previa; estas pruebas
  // fijan lo que las dos pantallas tienen que mostrar.

  const pintar = async (extra: Partial<VistaDeConvocatoriaProps> = {}) => {
    await act(async () => {
      context.root.render(<VistaDeConvocatoria {...props} {...extra} />);
    });
  };

  it("encabeza con el nombre y el folio, no con el tipo", async () => {
    // El tipo no distingue una venta de la siguiente: todas las de empleados
    // se llamaban igual.
    await pintar();

    expect(context.container.querySelector("h1")?.textContent).toBe(
      "Septiembre de 2026",
    );
    expect(context.container.textContent).toContain("SEP-2026");
  });

  it("pinta la descripcion como HTML, no como texto con etiquetas", async () => {
    await pintar();

    expect(context.container.querySelector("strong")?.textContent).toBe(
      "personal",
    );
    expect(context.container.textContent).not.toContain("<strong>");
  });

  it("muestra los datos de la convocatoria, incluido el plazo de pago", async () => {
    await pintar();

    const texto = context.container.textContent ?? "";
    expect(texto).toContain(diccionario.convocatorias.campoTipo);
    expect(texto).toContain(diccionario.tiposConvocatoria.EMPLEADOS);
    expect(texto).toContain(diccionario.convocatorias.campoHorasLiquidacion);
    expect(texto).toContain("48");
  });

  it("explica que se puede hacer en el estado de venta, no solo como se llama", async () => {
    // La insignia sola no dice que hay que formarse en una fila.
    await pintar();

    expect(context.container.textContent).toContain(
      diccionario.catalogo.explicacionAbierta,
    );
  });

  it("la explicacion corresponde a la fase, no es una fija", async () => {
    await pintar({ estadoDeVenta: { fase: "VENTA_CERRADA" } });

    expect(context.container.textContent).toContain(
      diccionario.catalogo.explicacionCerrada,
    );
    expect(context.container.textContent).not.toContain(
      diccionario.catalogo.explicacionAbierta,
    );
  });

  it("sin lotes lo dice hablando de vehiculos, no de convocatorias", async () => {
    // El mensaje era `sinResultados`, que es del listado de convocatorias:
    // contestaba otra pregunta.
    await pintar();

    expect(context.container.textContent).toContain(
      diccionario.catalogo.sinLotes,
    );
    expect(context.container.textContent).not.toContain(
      diccionario.catalogo.sinResultados,
    );
  });
});
