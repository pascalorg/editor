import { permissiblePressureKnM2 } from '../catalog'
import type { StripPack } from '../layout/strip-pack'
import {
  type Placement,
  type PressureEnvelope,
  pressureAtDepth,
  pressureEnvelope,
  type RiseRateLimit,
  riseRateLimit,
  supplyRiseRate,
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
 * What limits this pour's rate of rise: the panels' rating, the concrete supply, or nothing.
 *
 * The rating is read off the panels the layout actually used — the *lowest* of them,
 * because a run closed with an 900 mm panel rated 80 kN/m² is a run rated 80 whatever
 * stands beside it — rather than off the system, which publishes a range its widths do
 * not all reach. A layout that named no catalog panel carries no rating: a conventional or
 * bespoke shutter is sized by `wallDesign` against its own members and publishes nothing to
 * compare a pressure to. It is still a pour with a supply, though, which is why the answer
 * is `undefined` only where there is neither a rating nor a stated supply — a job of site-cut
 * ply is the commonest case of all, and a supply check that skipped it would be a check that
 * runs on the jobs least likely to need it.
 *
 * The plan area is the product of the plan dimensions rather than a figure of its own: the
 * two numbers a caller already passes for `verticalElementKind` are the pour's footprint, and
 * a second area argument would be a second source of truth for the same rectangle.
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
  const supply = supplyRiseRate(
    settings.concreteSupply,
    planDimensionsM.reduce((area, side) => area * side, 1),
  )
  if (ratings.length === 0 && supply === undefined) return undefined
  return riseRateLimit(
    settings.pressureStandard,
    settings.concrete,
    designPlacement(settings, liftHeightM, planDimensionsM),
    ratings.length === 0 ? undefined : Math.min(...ratings),
    pressureAtDepth(envelope, liftHeightM),
    supply,
  )
}
