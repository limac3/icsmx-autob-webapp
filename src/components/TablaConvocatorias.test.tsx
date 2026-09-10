import { vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import type { Convocatoria } from "@/types/convocatoria";
import TablaConvocatorias from "./TablaConvocatorias";

// `next/link` observa la interseccion para precargar y dispara un `setState`
// fuera de `act` cuando el temporizador salta despues de desmontar. Es ruido
// del router, no del componente: aqui basta un ancla.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

// `Tabs` decide con `useHasOverflow` si cambia a un desplegable en movil, y ese
// hook arranca un `setTimeout` de 50 ms para no recalcular en cada cambio de
// tamano. En jsdom no hay nada que redimensione, asi que ese temporizador solo
// aterriza fuera del `act` de la prueba y la ensucia. Se simula el hook, que es
// una utilidad hoja: lo que esta prueba comprueba es el marcado de la tabla y su
// accesibilidad, no la deteccion de desbordamiento de Eden.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const convocatoria = (
  convocatoriaId: string,
  estatus: Convocatoria["estatus"],
): Convocatoria => ({
  folio: "CONV-001",
  nombre: "Venta de octubre",
  convocatoriaId,
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal de flotilla.",
  publicadaEn: "2026-10-01T15:00:00.000Z",
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  horasLiquidacion: 48,
  estatus,
  creadoEn: "2026-09-01T10:00:00.000Z",
  creadoPor: "P9",
});

const context = getTestContext();

genericTests(context, TablaConvocatorias, {
  convocatorias: [
    convocatoria("C1", "BORRADOR"),
    convocatoria("C2", "PUBLICADA"),
    // Una en cada extremo del ciclo, para que el render cubra tanto una
    // pestaña con contenido como varias vacias.
    convocatoria("C3", "CONCLUIDA"),
  ],
  diccionario: obtenerDiccionario("es"),
  periodos: {
    C1: "5 de octubre de 2026, 09:00 — 12 de octubre de 2026, 09:00",
    C2: "5 de octubre de 2026, 09:00 — 12 de octubre de 2026, 09:00",
    C3: "5 de octubre de 2026, 09:00 — 12 de octubre de 2026, 09:00",
  },
});
