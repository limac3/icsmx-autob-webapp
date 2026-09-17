import { Duration, Stack } from "aws-cdk-lib";
import {
  Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
  type IMetric,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import type { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import {
  FilterPattern,
  MetricFilter,
  type ILogGroup,
} from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";

/**
 * Espacio de nombres de las metricas propias.
 *
 * Uno solo y fijo: las metricas personalizadas se cobran por nombre y
 * combinacion de dimensiones, asi que un espacio por entorno o una dimension
 * de alta cardinalidad multiplican la factura sin agregar informacion. Por eso
 * mismo ninguna de estas metricas lleva `loteId` como dimension — eso vive en
 * la linea de registro, que se consulta con Logs Insights y no se cobra por
 * serie (ver `modelo-datos-dynamodb.md`, revision de costos).
 */
export const ESPACIO_DE_NOMBRES = "autob";

export type OpcionesDeAlarmas = {
  readonly tabla: TableV2;
  /**
   * Prefijo de los nombres de alarma, y **tiene que identificar al entorno**.
   *
   * **Los nombres de alarma de CloudWatch son unicos por cuenta y region**, no
   * por pila. Antes el prefijo era `this.node.id` —la constante `"Alarmas"`—,
   * asi que los seis nombres eran los mismos en todo despliegue: el sandbox los
   * creo primero y la pila de la rama fallo con "Validation failed with 6
   * error(s)", uno por alarma, antes de crear un solo recurso. La sintesis no
   * podia verlo: la plantilla es valida, lo que colisiona es el estado de la
   * cuenta (`desafios-implementacion.md` 68).
   *
   * Es obligatorio y no opcional con respaldo justamente para que no se pueda
   * volver a un valor constante sin darse cuenta.
   */
  readonly prefijoDeNombres: string;
  /** Grupo de logs de la funcion de barrido, donde caen sus trazas. */
  readonly logsDelBarrido: ILogGroup;
  /** Metricas nativas de la funcion: invocaciones y errores. */
  readonly invocacionesDelBarrido: IMetric;
  readonly erroresDelBarrido: IMetric;
  /**
   * Destinatario de los avisos. Sin el, las alarmas se crean y cambian de
   * estado igual, pero nadie se entera: el tema queda sin suscriptores.
   *
   * Se deja opcional a proposito. Exigirlo bloquearia `ampx sandbox` de
   * cualquiera que no quiera recibir correos de su entorno personal, y una
   * direccion de relleno seria peor: una suscripcion sin confirmar parece
   * configurada y no entrega nada.
   */
  readonly correoDeAvisos?: string;
};

/**
 * Minutos que puede llevar esperando el correo mas viejo del outbox antes de
 * avisar.
 *
 * Una hora, y no cinco minutos: mientras CES siga sin aprobar (riesgo R17) el
 * outbox acumula pendientes **por diseno** y una alarma sensible seria ruido
 * permanente. Una hora distingue "CES tardo un par de corridas" de "los
 * correos no salen", que es la unica pregunta que esta alarma tiene que
 * responder.
 */
export const UMBRAL_OUTBOX_MIN = 60;

/**
 * Conflictos de transaccion por periodo de cinco minutos que se consideran
 * normales.
 *
 * **Es un valor de partida, no una medida.** La contencion legitima de este
 * sistema se concentra en `inicioVenta` —decenas de solicitudes por lote en
 * segundos, y `TransactionConflict` es precisamente lo que produce ese
 * momento—, asi que "lo normal" no se puede saber sin haber abierto una
 * convocatoria real. La prueba de carga de la Etapa 12
 * (`scripts/carga-apertura.mjs`) existe entre otras cosas para calibrarlo: se
 * mira el pico que produce y se ajusta este numero por encima.
 */
export const UMBRAL_CONFLICTOS_POR_PERIODO = 50;

/**
 * Las alarmas de `arquitectura-tecnica-aws.md` 7.
 *
 * **Dos fuentes distintas de senal, y la eleccion entre ellas no es de estilo.**
 *
 * Las metricas **nativas** —de Lambda y de DynamoDB— las publica AWS y no
 * dependen de que la aplicacion funcione. Las metricas de **filtro de log** las
 * extrae CloudWatch de las lineas que escribe `src/lib/observabilidad`, asi que
 * un defecto en ese modulo las apaga. De ahi la regla que reparte las seis:
 *
 *   - Lo que hay que detectar **aunque el codigo este roto** va a metrica
 *     nativa. "El barrido no se ejecuta" es el caso limite: si el `handler`
 *     lanza antes de la primera linea, un filtro de log no ve nada y calla,
 *     que es exactamente el fallo que la alarma existe para gritar.
 *   - Lo que solo el dominio sabe contar —cuantas vencidas quedaron sin
 *     resolver, cuanto lleva esperando el correo mas viejo— no existe como
 *     metrica nativa y va por filtro de log.
 *
 * **La ruta del campo empieza en `$.message`** porque la funcion emite con el
 * formato JSON de Lambda (`barrido/resource.ts`): el runtime envuelve lo que
 * pasa a `console.info` en `{ timestamp, level, requestId, message }`. Escribir
 * `$.errores` produciria un filtro que compila, se despliega y nunca coincide
 * con nada — un filtro que no coincide no da error, da silencio.
 */
export class AlarmasAutob extends Construct {
  readonly tema: Topic;
  readonly alarmas: readonly Alarm[];

  constructor(scope: Construct, id: string, opciones: OpcionesDeAlarmas) {
    super(scope, id);

    this.tema = new Topic(this, "Avisos", {
      displayName: "Avisos operativos de autob",
    });

    if (opciones.correoDeAvisos) {
      this.tema.addSubscription(new EmailSubscription(opciones.correoDeAvisos));
    }

    // **Los seis ids logicos de mas abajo llevan el sufijo `V2`, y no es
    // cosmetico.** `AlarmName` es `createOnlyProperty` en CloudFormation: al
    // cambiar su valor sin cambiar el id logico de la construccion,
    // CloudFormation intenta un *update in-place* y lo rechaza —
    // `NotUpdatableException: createOnlyProperties [/properties/AlarmName]
    // cannot be updated`—, en cada despliegue, sin excepcion. `ampx sandbox`
    // lo enmascara: al fallar la pila completa cae en *hotswap* y actualiza
    // el codigo del Lambda igual, asi que el barrido sigue corriendo y el
    // fallo pasa inadvertido. Cambiar el id logico fuerza a CloudFormation a
    // crear la alarma nueva y borrar la vieja, en vez de intentar el
    // reemplazo imposible (`desafios-implementacion.md` 79).
    this.alarmas = [
      this.barridoSinEjecutar(opciones),
      this.barridoConErrores(opciones),
      this.vencimientosSinResolver(opciones),
      this.outboxRetrasado(opciones),
      this.correosFallidos(opciones),
      this.contencionDeTransacciones(opciones),
    ];

    const accion = new SnsAction(this.tema);
    for (const alarma of this.alarmas) {
      alarma.addAlarmAction(accion);
      // Tambien al volver a la normalidad. Sin esto, quien recibio el aviso de
      // que el barrido dejo de correr no tiene forma de saber que ya se
      // arreglo salvo entrar a la consola.
      alarma.addOkAction(accion);
    }
  }

  /**
   * R6 — el barrido no se ejecuta. **La mas importante de las seis**: si el
   * barrido calla, las adjudicaciones vencidas siguen vigentes y la fila de
   * cada lote afectado se detiene.
   *
   * `treatMissingData: BREACHING` es el corazon de esta alarma y va contra el
   * valor por omision de CloudWatch. Un barrido que no corre **no publica
   * ceros**: no publica nada. Con el trato por omision (`MISSING`) la alarma
   * se quedaria en `INSUFFICIENT_DATA` para siempre, que es indistinguible de
   * "todo bien" para quien no la esta mirando. Aqui la ausencia de datos *es*
   * el fallo.
   */
  private barridoSinEjecutar(opciones: OpcionesDeAlarmas): Alarm {
    return new Alarm(this, "BarridoSinEjecutarV2", {
      alarmName: `${opciones.prefijoDeNombres}-barrido-sin-ejecutar`,
      alarmDescription:
        "El barrido de vencimientos no se ejecuto en la ultima ventana. Runbook R-1.",
      metric: opciones.invocacionesDelBarrido,
      // El horario es cada 5 minutos: en 15 se esperan tres invocaciones. Se
      // exige solo una para no avisar por un salto suelto del programador.
      threshold: 1,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.BREACHING,
    });
  }

  /** El barrido corre pero lanza. Distinto del anterior: aqui si hay datos. */
  private barridoConErrores(opciones: OpcionesDeAlarmas): Alarm {
    return new Alarm(this, "BarridoConErroresV2", {
      alarmName: `${opciones.prefijoDeNombres}-barrido-con-errores`,
      alarmDescription:
        "La funcion de barrido termino con excepcion. Runbook R-1.",
      metric: opciones.erroresDelBarrido,
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
  }

  /**
   * "Adjudicaciones con `venceEn` pasado que siguen vigentes: **si esta alarma
   * se dispara, los dos caminos de vencimiento fallaron**, y es el sintoma mas
   * grave del sistema" (`arquitectura-tecnica-aws.md` 7).
   *
   * Se mide `errores` del barrido y **no** `vencimientosAbstenidos`:
   * abstenerse es la respuesta correcta ante turnos en vuelo (R18) y la
   * corrida siguiente lo resuelve. `errores` cuenta lo que el barrido
   * encontro y no pudo resolver ni reintentando.
   */
  private vencimientosSinResolver(opciones: OpcionesDeAlarmas): Alarm {
    const metrica = this.filtro(opciones.logsDelBarrido, opciones, {
      id: "VencimientosSinResolver",
      nombre: "VencimientosSinResolver",
      patron: FilterPattern.all(
        FilterPattern.stringValue(
          "$.message.operacion",
          "=",
          "barridoDeVencimientos",
        ),
        FilterPattern.numberValue("$.message.errores", ">", 0),
      ),
      valor: "$.message.errores",
    });

    return new Alarm(this, "AlarmaVencimientosSinResolverV2", {
      alarmName: `${opciones.prefijoDeNombres}-vencimientos-sin-resolver`,
      alarmDescription:
        "El barrido encontro adjudicaciones vencidas y no pudo resolverlas." +
        " Los dos caminos de D-7 fallaron. Runbook R-4.",
      metric: metrica,
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
  }

  /** Correos que llevan demasiado tiempo esperando en el outbox. */
  private outboxRetrasado(opciones: OpcionesDeAlarmas): Alarm {
    const metrica = this.filtro(opciones.logsDelBarrido, opciones, {
      id: "AntiguedadOutbox",
      nombre: "AntiguedadOutboxMin",
      patron: FilterPattern.stringValue(
        "$.message.operacion",
        "=",
        "procesarOutbox",
      ),
      valor: "$.message.antiguedadMaximaMin",
      // `Maximum` y no `Sum`: es una antiguedad, no un conteo. Sumar las
      // antiguedades de varias corridas daria un numero sin significado que
      // cruzaria el umbral por acumulacion.
      estadistica: "Maximum",
    });

    return new Alarm(this, "AlarmaOutboxRetrasadoV2", {
      alarmName: `${opciones.prefijoDeNombres}-outbox-retrasado`,
      alarmDescription:
        `Hay correos sin enviar con mas de ${String(UMBRAL_OUTBOX_MIN)}` +
        " minutos de antiguedad. Runbook R-2.",
      metric: metrica,
      threshold: UMBRAL_OUTBOX_MIN,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
  }

  /**
   * Un fallo permanente es un correo que **nadie** va a recibir: el adjudicado
   * no se entera de que gano y su plazo corre igual (R-13).
   */
  private correosFallidos(opciones: OpcionesDeAlarmas): Alarm {
    const metrica = this.filtro(opciones.logsDelBarrido, opciones, {
      id: "CorreosFallidos",
      nombre: "CorreosFallidos",
      patron: FilterPattern.all(
        FilterPattern.stringValue("$.message.operacion", "=", "procesarOutbox"),
        FilterPattern.numberValue("$.message.fallidosPermanentes", ">", 0),
      ),
      valor: "$.message.fallidosPermanentes",
    });

    return new Alarm(this, "AlarmaCorreosFallidosV2", {
      alarmName: `${opciones.prefijoDeNombres}-correos-fallidos`,
      alarmDescription:
        "Uno o mas correos agotaron sus reintentos y no se entregaran." +
        " Runbook R-2 y R-3.",
      metric: metrica,
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
  }

  /**
   * "Tasa de `TransactionCanceledException` por encima de lo normal — indica
   * contencion inesperada".
   *
   * Metrica nativa de DynamoDB y no una derivada de nuestros logs, por dos
   * razones. Una: la contencion mas interesante ocurre en el SSR —el motor de
   * fila en `inicioVenta`—, y el grupo de logs del SSR lo crea Amplify
   * Hosting, no esta pila, asi que aqui no hay a que colgarle un filtro. Dos:
   * `TransactionConflict` cuenta lo mismo en los dos lados sin que la
   * aplicacion tenga que emitir nada.
   *
   * **No se alarma sobre `ConditionalCheckFailedRequests`**, que a primera
   * vista parece la metrica obvia. En este sistema una condicion que falla es
   * el mecanismo normal de funcionamiento: la adjudicacion se gana con una
   * escritura condicional (regla 6), asi que en cada lote N-1 intentos fallan
   * su condicion **por diseno**. Esa alarma estaria disparada siempre.
   */
  private contencionDeTransacciones(opciones: OpcionesDeAlarmas): Alarm {
    return new Alarm(this, "ContencionDeTransaccionesV2", {
      alarmName: `${opciones.prefijoDeNombres}-contencion-de-transacciones`,
      alarmDescription:
        "Conflictos de transaccion por encima de lo previsto." +
        " Contencion inesperada sobre la tabla. Runbook R-4.",
      metric: opciones.tabla.metric("TransactionConflict", {
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: UMBRAL_CONFLICTOS_POR_PERIODO,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      // Dos periodos seguidos: un pico de un solo periodo es la apertura de
      // una convocatoria, que es contencion **esperada**.
      evaluationPeriods: 2,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
  }

  /**
   * Filtro de metrica sobre el grupo de logs, mas la metrica que produce.
   *
   * `defaultValue: 0` es lo que hace utilizable la serie. Sin el, una corrida
   * que no coincide con el patron no publica ningun punto, y una alarma sobre
   * una serie con huecos oscila entre `OK` e `INSUFFICIENT_DATA` en vez de
   * quedarse en `OK`.
   *
   * **El nombre de la metrica lleva el prefijo del entorno, y no es
   * cosmetico.** `ESPACIO_DE_NOMBRES` es fijo y global por diseno (el
   * comentario de la clase explica por que), asi que sin distinguir el
   * entorno en el nombre, el sandbox personal de cualquiera y una rama
   * compartida —incluida produccion— leen y escriben la misma serie: el
   * barrido de un sandbox dispara la alarma de otro entorno, y viceversa
   * (`desafios-implementacion.md` 80).
   *
   * **No se resolvio con una dimension de CloudWatch**, que habria sido la
   * forma mas idiomatica: la API rechaza un `MetricFilter` con `dimensions`
   * y `defaultValue` a la vez —"dimensions and default value are mutually
   * exclusive properties"—, y `defaultValue: 0` es lo que evita el hueco de
   * abajo. El nombre de la metrica no tiene esa restriccion, y ya es el
   * mismo truco que separa los nombres de alarma (`prefijoDeNombres`).
   */
  private filtro(
    logs: ILogGroup,
    opciones: OpcionesDeAlarmas,
    definicion: {
      id: string;
      nombre: string;
      patron: ReturnType<typeof FilterPattern.all>;
      valor: string;
      estadistica?: string;
    },
  ): Metric {
    const nombreDeMetrica = `${opciones.prefijoDeNombres}-${definicion.nombre}`;

    // Ambito: la pila **del grupo de logs**, no `this`. Un `MetricFilter` en
    // otra pila obligaria a CloudFormation a exportar el nombre del grupo, y
    // el grupo pertenece a la pila de la funcion; el filtro no gana nada por
    // vivir con las alarmas y si perderia por cruzar la frontera.
    new MetricFilter(Stack.of(logs), `Filtro${definicion.id}`, {
      logGroup: logs,
      metricNamespace: ESPACIO_DE_NOMBRES,
      metricName: nombreDeMetrica,
      filterPattern: definicion.patron,
      metricValue: definicion.valor,
      defaultValue: 0,
    });

    return new Metric({
      namespace: ESPACIO_DE_NOMBRES,
      metricName: nombreDeMetrica,
      statistic: definicion.estadistica ?? "Sum",
      period: Duration.minutes(15),
    });
  }
}
