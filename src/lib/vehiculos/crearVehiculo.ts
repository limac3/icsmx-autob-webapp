import "server-only";

// Alta de un vehiculo en el catalogo. T de referencia: ninguna de las siete
// transacciones criticas, pero se rige por la misma regla 4 — la mutacion y su
// evento viajan juntos o no ocurre ninguna de las dos.

import { AMBITOS_DE_IDENTIFICADOR, clave, gsi2 } from "@/lib/data/claves";
import { putDeCentinelaDeIdentificador } from "@/lib/data/centinelasDeIdentificador";
import { nombreDeTabla } from "@/lib/data/cliente";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { validarDatosVehiculo } from "@/lib/domain/vehiculos";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { DatosVehiculo } from "@/types/vehiculo";
import { resolver, type ActorUsuario, type DepsDeVehiculos } from "./deps";

/**
 * Posicion del centinela en la transaccion -> campo que estaba duplicado.
 *
 * Depende del orden de los items, asi que vive junto a ellos: mover un centinela
 * sin mover esta tabla haria que la pantalla senalara el campo equivocado.
 */
const CAMPO_POR_CENTINELA: Record<number, string | undefined> = {
  0: "numeroEconomico",
  1: "numeroDeSerie",
};

export type EntradaCrearVehiculo = {
  datos: DatosVehiculo;
  actor: ActorUsuario;
};

/**
 * Registra un vehiculo nuevo. Nace `DISPONIBLE`, que es el unico estado inicial
 * de la maquina de `proyecto.md` 5.2.
 */
export const crearVehiculo = async (
  entrada: EntradaCrearVehiculo,
  deps: DepsDeVehiculos = {},
): Promise<Resultado<{ vehiculoId: string }>> => {
  const { cliente, ahora, nuevoId } = resolver(deps);

  const validacion = validarDatosVehiculo(entrada.datos, ahora);
  if (!validacion.ok) return validacion;

  const vehiculoId = nuevoId();
  const momento = ahora.toISOString();

  const item = {
    ...clave.vehiculo(vehiculoId),
    ...validacion.data,
    vehiculoId,
    estatus: "DISPONIBLE",
    creadoEn: momento,
    creadoPor: entrada.actor.id,
    actualizadoEn: momento,
    actualizadoPor: entrada.actor.id,
    // PA-03. La fecha del indice es la de **creacion** y no la de la ultima
    // edicion: asi el catalogo de un estatus conserva un orden estable y una
    // correccion de kilometraje no reordena la pantalla.
    ...gsi2.porEstatus("VEH", "DISPONIBLE", momento, vehiculoId),
  };

  const resultado = await ejecutarTransaccion(
    [
      // Los dos centinelas **primero**: `ejecutarTransaccion` devuelve el
      // indice del item que cancelo, y es la unica forma de saber cual de los
      // dos numeros estaba duplicado. Con ellos al frente el indice es estable.
      putDeCentinelaDeIdentificador(
        AMBITOS_DE_IDENTIFICADOR.numeroEconomicoDeVehiculo,
        item.numeroEconomico,
        { vehiculoId },
      ),
      putDeCentinelaDeIdentificador(
        AMBITOS_DE_IDENTIFICADOR.numeroDeSerieDeVehiculo,
        item.numeroDeSerie,
        { vehiculoId },
      ),
      {
        item: {
          Put: {
            TableName: nombreDeTabla(),
            Item: item,
            // El identificador es un ULID recien generado, asi que chocar es
            // practicamente imposible. La condicion esta igual porque su costo
            // es cero y porque sin ella un `nuevoId` inyectado por error en
            // produccion sobrescribiria un vehiculo entero sin avisar.
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: `vehiculo ${vehiculoId}`,
      },
      eventoParaTransaccion({
        tipo: "VEHICULO_REGISTRADO",
        agregado: "VEHICULO",
        agregadoId: vehiculoId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        vehiculoId,
        estadoNuevo: "DISPONIBLE",
        datos: {
          marca: item.marca,
          version: item.version,
          modelo: item.modelo,
        },
      }),
    ],
    { cliente },
  );

  if (!resultado.ok) {
    // El indice dice **cual** de los dos numeros estaba tomado. Sin esto la
    // pantalla solo podria decir "revisa los datos" y quien captura tendria que
    // adivinar cual de los dos repitio.
    const duplicado = CAMPO_POR_CENTINELA[resultado.indice ?? -1];
    if (duplicado)
      return fallo("validation_failed", { [duplicado]: "duplicado" });
    return fallo(resultado.error);
  }
  return exito({ vehiculoId });
};
