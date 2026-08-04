import type { CornerLeg, JunctionCorner } from '../coverage/types'
import { type CornerType, cornerForAngle, cornerLegsMm, type FormworkSystem } from './types'

/**
 * Fitting a real product to a junction the geometry found. The coverage engine
 * says "an inside corner of 90° lands here, on this face, running this way"; this
 * turns that into a part number and a leg length, or reports that the system has
 * nothing for the angle.
 */

export interface CornerFit {
  corner: CornerType
  /** Leg length on each of the junction corner's two legs, in m and in `legs` order. */
  legLengthsM: [number, number]
}

/**
 * The unit that turns `corner`, and how long each of its legs is. `heightMm`
 * narrows the choice to units of the pour's height where it is known — a 3.30 m
 * lift cannot be turned on a 2.70 m corner, and stacking two shorter ones puts a
 * horizontal joint through the corner, which is the one place a joint is hardest
 * to keep tight.
 *
 * A fixed-geometry corner's two legs differ (PERI's TE 270-2 is 180 × 300), so
 * they are returned in `corner.legs` order rather than as one number: the short
 * leg runs on one wall and the long one on the other, and swapping them puts the
 * panel joint at the wrong station.
 */
export function fitCorner(
  system: FormworkSystem,
  corner: JunctionCorner,
  heightMm?: number,
): CornerFit | undefined {
  const product =
    cornerForAngle(system, corner.side, corner.angleDeg, heightMm) ??
    // Nothing at this height, so fall back to any unit that turns the angle. The
    // angle is a hard constraint and the height is a preference — a corner of the
    // wrong height is stacked or trimmed, a corner of the wrong angle is useless.
    cornerForAngle(system, corner.side, corner.angleDeg)
  if (!product) return undefined
  const [legA, legB] = corner.legs
  return {
    corner: product,
    legLengthsM: [legLengthM(product, legA, 0), legLengthM(product, legB, 1)],
  }
}

/**
 * One leg's length in m. A cut-to-fit corner is measured off the core it turns
 * onto — which is the *other* wall's thickness, recorded on the leg — and a
 * manufactured one is whatever it was made as, which for an unequal-legged unit
 * like PERI's 180 × 300 depends on which of the two legs this is.
 */
export function legLengthM(product: CornerType, leg: CornerLeg, index: 0 | 1): number {
  const legs = cornerLegsMm(product, leg.turnsOntoThicknessM * 1000)
  return (index === 0 ? legs.legAMm : legs.legBMm) / 1000
}

/**
 * Junctions this system cannot turn, so the estimate can say so rather than
 * quietly billing a corner that does not exist. A skew wall junction outside every
 * hinged unit's sweep is a bespoke timber corner, and that is a carpenter's item
 * with a different rate.
 */
export function unfittableCorners(
  system: FormworkSystem,
  corners: readonly JunctionCorner[],
): JunctionCorner[] {
  return corners.filter((corner) => !fitCorner(system, corner))
}
