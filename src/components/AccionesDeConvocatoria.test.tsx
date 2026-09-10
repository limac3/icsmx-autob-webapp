import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ocultarConvocatoria,
  rechazarConvocatoria,
} from "@/app/actions/convocatorias";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import AccionesDeConvocatoria from "./AccionesDeConvocatoria";

vi.mock("@/app/actions/convocatorias", () => ({
  aprobarConvocatoria: vi.fn(),
  concluirConvocatoria: vi.fn(),
  enviarAAprobacion: vi.fn(),
  ocultarConvocatoria: vi.fn(),
  publicarConvocatoria: vi.fn(),
  reactivarConvocatoria: vi.fn(),
  rechazarConvocatoria: vi.fn(),
}));

// El `FormField` del motivo arrastra `Fade`, que mide el desbordamiento con un
// `setTimeout` de 50 ms y aterriza fuera del `act` de la prueba. Misma utilidad
// hoja, mismo motivo que en las otras dos pruebas de componente.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();

// A nivel de modulo: lo usan dos `describe` distintos, y declararlo dentro de
// uno lo deja fuera de alcance en el otro.
const diccionario = obtenerDiccionario("es");

beforeEach(() => {
  vi.clearAllMocks();
});

genericTests(context, AccionesDeConvocatoria, {
  convocatoriaId: "C1",
  estatus: "EN_APROBACION",
  diccionario: obtenerDiccionario("es"),
  permisos: ["Autob_Aprobar_Convocatorias"],
});

const pintar = async (
  estatus: Parameters<typeof AccionesDeConvocatoria>[0]["estatus"],
  permisos: string[],
  esCreador = false,
) => {
  await act(async () => {
    context.root.render(
      <AccionesDeConvocatoria
        convocatoriaId="C1"
        estatus={estatus}
        diccionario={obtenerDiccionario("es")}
        permisos={permisos}
        esCreador={esCreador}
      />,
    );
  });
};

const botones = () =>
  [...context.container.querySelectorAll("button")].map((boton) =>
    boton.textContent?.trim(),
  );

describe("las acciones salen de la maquina de estados", () => {
  it("desde EN_APROBACION ofrece aprobar, rechazar y ocultar", async () => {
    await pintar("EN_APROBACION", [
      "Autob_Aprobar_Convocatorias",
      "Autob_Administrar_Convocatorias",
    ]);

    expect(botones()).toEqual(
      expect.arrayContaining(["Aprobar", "Rechazar", "Ocultar"]),
    );
    // Publicar no sale de EN_APROBACION: la maquina no tiene esa transicion.
    expect(botones()).not.toContain("Publicar");
  });

  it("desde APROBADA ofrece publicar", async () => {
    await pintar("APROBADA", ["Autob_Administrar_Convocatorias"]);

    expect(botones()).toEqual(expect.arrayContaining(["Publicar", "Ocultar"]));
  });

  it("no ofrece nada desde un estado terminal", async () => {
    // CONCLUIDA no tiene salidas en la maquina.
    await pintar("CONCLUIDA", ["Autob_Administrar_Convocatorias"]);

    expect(botones()).toEqual([]);
    expect(context.container.textContent).toContain(
      "No hay acciones disponibles",
    );
  });
});

describe("se ocultan las acciones sin permiso", () => {
  it("quien solo aprueba no ve ocultar, que es de administracion", async () => {
    await pintar("EN_APROBACION", ["Autob_Aprobar_Convocatorias"]);

    expect(botones()).toEqual(expect.arrayContaining(["Aprobar", "Rechazar"]));
    expect(botones()).not.toContain("Ocultar");
  });

  it("quien solo administra no ve aprobar ni rechazar", async () => {
    // R-05 se decide en el servidor con `creadoPor`; esto es solo el permiso.
    await pintar("EN_APROBACION", ["Autob_Administrar_Convocatorias"]);

    expect(botones()).toContain("Ocultar");
    expect(botones()).not.toContain("Aprobar");
    expect(botones()).not.toContain("Rechazar");
  });
});

describe("R-05 — quien la creo no la dictamina", () => {
  it("le retira aprobar y rechazar, aunque tenga el permiso", async () => {
    await pintar("EN_APROBACION", ["Autob_Aprobar_Convocatorias"], true);

    expect(botones()).not.toContain("Aprobar");
    expect(botones()).not.toContain("Rechazar");
  });

  it("le dice por que, en vez de dejarlo suponer que le falta el permiso", async () => {
    // Sin el aviso, quien aprueba y creo la convocatoria ve una pantalla sin
    // botones identica a la de alguien sin autorizacion, y acaba pidiendo un
    // permiso que ya tiene.
    await pintar("EN_APROBACION", ["Autob_Aprobar_Convocatorias"], true);

    expect(context.container.textContent).toContain(
      diccionario.acciones.noApruebasLoTuyo,
    );
  });

  it("no le quita lo que no es dictamen", async () => {
    // R-05 habla de aprobar y rechazar. Ocultar es administracion y la puede
    // ejecutar quien la creo.
    await pintar(
      "EN_APROBACION",
      ["Autob_Aprobar_Convocatorias", "Autob_Administrar_Convocatorias"],
      true,
    );

    expect(botones()).toContain("Ocultar");
    expect(botones()).not.toContain("Aprobar");
  });

  it("no molesta a quien no la creo", async () => {
    await pintar("EN_APROBACION", ["Autob_Aprobar_Convocatorias"], false);

    expect(botones()).toContain("Aprobar");
    expect(context.container.textContent).not.toContain(
      diccionario.acciones.noApruebasLoTuyo,
    );
  });
});

describe("el motivo obligatorio se pide en el modal de la accion", () => {
  // Antes el campo del motivo vivia **antes** del boton, suelto en la pantalla:
  // nada decia a que accion pertenecia, y el boton se quedaba inerte hasta
  // llenarlo sin explicar por que. Ahora el boton abre el modal de su propia
  // accion y el motivo se captura ahi, junto a la consecuencia y a los dos
  // botones de confirmar y cancelar.

  const boton = (texto: string) =>
    [...context.container.querySelectorAll("button")].find(
      (candidato) => candidato.textContent?.trim() === texto,
    );

  const motivoDelModal = () =>
    context.container.querySelector<HTMLTextAreaElement>(
      "textarea[name='motivo']",
    );

  /**
   * React sobrescribe el descriptor de `value` del elemento para detectar
   * cambios, asi que asignarlo directo le pasa desapercibido: hay que llamar al
   * setter **nativo** del prototipo, que es lo que hace `fireEvent.change` de
   * Testing Library por debajo. Mismo truco que `DictamenDePago.test.tsx`.
   */
  const escribirMotivo = async (texto: string) => {
    const campo = motivoDelModal()!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("no hay ningun campo de motivo hasta que se abre el modal", async () => {
    await pintar("EN_APROBACION", ["Autob_Aprobar_Convocatorias"]);

    expect(motivoDelModal()).toBeNull();
  });

  it("el boton de la accion no espera nada: abre el modal", async () => {
    // Deshabilitarlo hasta que hubiera motivo era justo lo que no se entendia,
    // porque el campo que lo desbloqueaba no se veia como parte de la accion.
    await pintar("EN_APROBACION", ["Autob_Aprobar_Convocatorias"]);

    expect(boton("Rechazar")?.disabled).toBe(false);
  });

  it("al abrirlo muestra la consecuencia y el area de texto del motivo", async () => {
    await pintar("EN_APROBACION", ["Autob_Aprobar_Convocatorias"]);

    await act(async () => {
      boton("Rechazar")?.click();
    });

    expect(context.container.textContent).toContain(
      diccionario.acciones.confirmar_RECHAZAR,
    );
    // `TextArea` y no `Input`: lo lee quien audite meses despues, asi que tiene
    // que caber una frase entera.
    const motivo = motivoDelModal();
    expect(motivo).not.toBeNull();
    expect(motivo?.tagName).toBe("TEXTAREA");
    expect(motivo?.required).toBe(true);
  });

  it("continuar espera al motivo, y lo comprueba otra vez al pulsar", async () => {
    await pintar("EN_APROBACION", ["Autob_Aprobar_Convocatorias"]);

    await act(async () => {
      boton("Rechazar")?.click();
    });

    const continuar = boton(diccionario.acciones.continuar);
    expect(continuar?.disabled).toBe(true);

    // Un boton deshabilitado no es una validacion: pulsarlo no debe ejecutar.
    await act(async () => {
      continuar?.click();
    });
    expect(vi.mocked(rechazarConvocatoria)).not.toHaveBeenCalled();
  });

  it("el motivo que se escribe en el modal es el que viaja al servidor", async () => {
    // Lo que de verdad importa: que el texto llegue a la action. Con el campo
    // suelto esto nunca se probo de punta a punta.
    vi.mocked(rechazarConvocatoria).mockResolvedValue({
      ok: true,
      data: { estatus: "BORRADOR" },
    });
    await pintar("EN_APROBACION", ["Autob_Aprobar_Convocatorias"]);

    await act(async () => {
      boton("Rechazar")?.click();
    });

    await escribirMotivo("Faltan las fotografias del Sienna.");

    await act(async () => {
      boton(diccionario.acciones.continuar)?.click();
    });

    expect(vi.mocked(rechazarConvocatoria)).toHaveBeenCalledWith(
      "C1",
      "Faltan las fotografias del Sienna.",
    );
  });

  it("ocultar sigue el mismo camino que rechazar, sin codigo aparte", async () => {
    // Las dos salen del mismo catalogo: `exigeMotivo` mas `confirma`.
    vi.mocked(ocultarConvocatoria).mockResolvedValue({
      ok: true,
      data: { estatus: "OCULTA" },
    });
    await pintar("PUBLICADA", ["Autob_Administrar_Convocatorias"]);

    await act(async () => {
      boton("Ocultar")?.click();
    });

    expect(context.container.textContent).toContain(
      diccionario.acciones.confirmar_OCULTAR,
    );

    await escribirMotivo("Se publico con el precio equivocado.");

    await act(async () => {
      boton(diccionario.acciones.continuar)?.click();
    });

    expect(vi.mocked(ocultarConvocatoria)).toHaveBeenCalledWith(
      "C1",
      "Se publico con el precio equivocado.",
    );
  });
});
