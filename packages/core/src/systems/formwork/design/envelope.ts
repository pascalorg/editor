import { permissiblePressureKnM2 } from '../catalog'
import type { StripPack } from '../layout/strip-pack'
import {
  type Placement,
  type PressureEnvelope,
  pressureAtDepth,
  pressureEnvelope,
  type RiseRateLimit,
  riseRateLimit,
  verticalElementKind,
} from '../pressure'
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
  return pressureEnvelope(
    settings.pressureStandard,
    settings.concrete,
    designPlacement(settings, liftHeightM, planDimensionsM),
  )
}

/**
 * The pour, as the code's equations take it.
 *
 * Split out of `designEnvelope` rather than assembled twice because the *inverse* solve
 * needs the same object: `riseRateLimit` asks how fast this pour may rise, and an answer
 * derived from a placement rebuilt at the call site would be a rate for a different pour
 * than the pressure came from. One assembly, both directions.
 */
export function designPlacement(
  settings: FormworkSettings,
  liftHeightM: number,
  planDimensionsM: readonly number[],
): Placement {
  return {
    ...settings.placement,
    riseRateMH: settings.riseRateMH,
    concreteTemperatureC: settings.concreteTemperatureC,
    pourHeightM: liftHeightM,
    // Read off the plan rather than assumed: a vertical element with a plan
    // dimension over 2 m is a wall by the code's own definition, whatever the node
    // is called, and it takes the wall equations.
    elementKind: verticalElementKind(planDimensionsM),
  }
}

/**
 * What the panels on this shutter are rated for, and how fast it may be poured.
 *
 * The rating is read off the panels the layout actually used — the *lowest* of them,
 * because a run closed with an 900 mm panel rated 80 kN/m² is a run rated 80 whatever
 * stands beside it — rather than off the system, which publishes a range its widths do
 * not all reach. `undefined` where the layout named no catalog panel at all: a conventional
 * or bespoke shutter is sized by `wallDesign` against its own members, and there is no
 * published rating to compare a pressure to.
 */
export function packRiseRateLimit(
  settings: FormworkSettings,
  packs: readonly StripPack[],
  liftHeightM: number,
  planDimensionsM: readonly number[],
  envelope: PressureEnvelope,
): RiseRateLimit | undefined {
  const kind = verticalElementKind(planDimensionsM)
  const ratings = packs.flatMap((pack) =>
    pack.pieces.flatMap((piece) =>
      piece.kind === 'panel' ? [permissiblePressureKnM2(piece.panel, kind)] : [],
    ),
  )
  if (ratings.length === 0) return undefined
  return riseRateLimit(
    settings.pressureStandard,
    settings.concrete,
    designPlacement(settings, liftHeightM, planDimensionsM),
    Math.min(...ratings),
    pressureAtDepth(envelope, liftHeightM),
  )
}
