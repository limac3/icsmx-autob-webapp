import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import FilaParaAdjudicar, { type CandidatoVista } from "./FilaParaAdjudicar";

vi.mock("@/app/actions/adjudicacion", () => ({
  adjudicarManualmente: vi.fn(),
}));

// Misma razon que en `BandejaDeAdjudicacion.test.tsx`: `next/link` precarga
// por interseccion y aterriza fuera del `act` de la prueba.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

// `CardView` arrastra `Fade`, que mide el desbordamiento con un `setTimeout` de
// 50 ms y aterriza fuera del `act` de la prueba.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();
const diccionario = obtenerDiccionario("es");

const candidato = (cambios: Partial<CandidatoVista> = {}): CandidatoVista => ({
  turno: 1,
  participanteId: "P1",
  correoTitular: "ana@ejemplo.invalid",
  solicitadoEn: "6 oct 2026, 09:00:01",
  ordenEnConvocatoria: 2,
  adjudicacionesEnConvocatoria: 0,
  sinCupo: false,
  otrasParticipaciones: [],
  ...cambios,
});

genericTests(context, FilaParaAdjudicar, {
  convocatoriaId: "C1",
  loteId: "L1",
  candidatos: [candidato()],
  puedeAdjudicar: true,
  ventaAbierta: false,
  diccionario,
});

const pintar = async (
  props: Partial<{
    candidatos: readonly CandidatoVista[];
    puedeAdjudicar: boolean;
    ventaAbierta: boolean;
  }> = {},
) => {
  await act(async () => {
    context.root.render(
      <FilaParaAdjudicar
        convocatoriaId="C1"
        loteId="L1"
        candidatos={props.candidatos ?? [candidato()]}
        puedeAdjudicar={props.puedeAdjudicar ?? true}
        ventaAbierta={props.ventaAbierta ?? false}
        diccionario={diccionario}
      />,
    );
  });
};

describe("la informacion que el adjudicador necesita", () => {
  it("muestra la hora exacta de llegada de cada solicitud", async () => {
    await pintar();

    expect(context.container.textContent).toContain("6 oct 2026, 09:00:01");
  });

  it("muestra cuantas adjudicaciones lleva en la convocatoria", async () => {
    await pintar({
      candidatos: [candidato({ adjudicacionesEnConvocatoria: 2 })],
    });

    expect(context.container.textContent).toContain(
      diccionario.adjudicacion.adjudicacionesQueLleva,
    );
    expect(context.container.textContent).toContain("2");
  });

  it("muestra sus otras solicitudes en la convocatoria, con su orden", async () => {
    // El cruce que el requerimiento pidio explicitamente: "si hay otras
    // solicitudes del mismo usuario dentro de la misma convocatoria y en que
    // orden estan".
    await pintar({
      candidatos: [
        candidato({
          otrasParticipaciones: [
            {
              loteId: "L9",
              turno: 3,
              estatus: "EN_FILA",
              ordenEnConvocatoria: 1,
              vehiculo: "Nissan NP300 2019",
            },
          ],
        }),
      ],
    });

    const texto = context.container.textContent ?? "";
    // El vehiculo, no el `loteId`: sin esto "#1" no decia de cual se trataba.
    expect(texto).toContain("Nissan NP300 2019");
    expect(texto).toContain(
      `${diccionario.adjudicacion.ordenEnConvocatoria} 1`,
    );
    expect(texto).toContain(diccionario.estatusSolicitud.EN_FILA);
    // Y lleva al detalle de ese otro lote, dentro de la misma convocatoria.
    expect(
      context.container.querySelector('a[href="/adjudicacion/C1/L9"]'),
    ).not.toBeNull();
  });

  it("dice cuando no tiene otras solicitudes, en vez de dejar la celda vacia", async () => {
    await pintar();

    expect(context.container.textContent).toContain(
      diccionario.adjudicacion.sinOtrasSolicitudes,
    );
  });

  it("marca a quien ya no le queda cupo, pero no lo esconde", async () => {
    // La autoridad sobre el cupo es la condicion de la transaccion, no esta
    // lectura: entre pintar y decidir, el cupo puede liberarse. Ocultarlo le
    // quitaria al adjudicador una opcion que quiza si existe.
    await pintar({ candidatos: [candidato({ sinCupo: true })] });

    expect(context.container.textContent).toContain(
      diccionario.adjudicacion.sinCupo,
    );
    expect(context.container.querySelectorAll("tbody tr")).toHaveLength(1);
  });
});

describe("la decision", () => {
  it("advierte cuando la venta sigue abierta y la fila puede crecer", async () => {
    await pintar({ ventaAbierta: true });

    expect(context.container.textContent).toContain(
      diccionario.adjudicacion.ventaAbiertaDetalle,
    );
  });

  it("sin motivo el boton no deja adjudicar", async () => {
    // Una decision humana sin razon escrita es tan opaca para el auditor como
    // un salto de turno sin evento.
    await pintar();

    const boton = [...context.container.querySelectorAll("button")].find(
      (b) => b.textContent === diccionario.adjudicacion.adjudicar,
    );
    expect(boton?.disabled).toBe(true);
  });

  it("quien solo puede mirar ve la fila pero no los botones", async () => {
    // `Autob_Auditar` fiscaliza la decision, no la toma.
    await pintar({ puedeAdjudicar: false });

    const botones = [...context.container.querySelectorAll("button")].filter(
      (b) => b.textContent === diccionario.adjudicacion.adjudicar,
    );
    expect(botones).toHaveLength(0);
    expect(context.container.querySelector("tbody")).not.toBeNull();
  });

  it("con la fila vacia lo dice, en vez de ofrecer una tabla sin candidatos", async () => {
    await pintar({ candidatos: [] });

    expect(context.container.textContent).toContain(
      diccionario.adjudicacion.filaVacia,
    );
  });
});
