import { type PressureEnvelope, pressureEnvelope, verticalElementKind } from '../pressure'
import type { FormworkSettings } from '../settings'

/**
 * The pressure this pour is designed against.
 *
 * Both the wall chain and the column schedule need one, and they must not differ:
 * a column classified as a wall by `verticalElementKind` takes the wall equations,
 * and a wall shuttered next to it takes the same code, mix and temperature or the
 * two shutters on either side of a junction are designed to different pours. That
 * is why the settings arrive as one resolved object rather than as loose arguments
 * each caller assembles.
 */
export function designEnvelope(
  settings: FormworkSettings,
  liftHeightM: number,
  planDimensionsM: readonly number[],
): PressureEnvelope {
  return pressureEnvelope(settings.pressureStandard, settings.concrete, {
    ...settings.placement,
    riseRateMH: settings.riseRateMH,
    concreteTemperatureC: settings.concreteTemperatureC,
    pourHeightM: liftHeightM,
    // Read off the plan rather than assumed: a vertical element with a plan
    // dimension over 2 m is a wall by the code's own definition, whatever the node
    // is called, and it takes the wall equations.
    elementKind: verticalElementKind(planDimensionsM),
  })
}
