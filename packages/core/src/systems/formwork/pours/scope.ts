import type { CastableElement, ElementOpening, Vec2 } from '../coverage/elements'
import { elementLength } from '../coverage/elements'
import type { PourUnit } from './types'

/**
 * A pour unit viewed as a castable element in its own right.
 *
 * One (segment × lift) of a wall is geometrically just a shorter, lower wall:
 * its centreline is the stretch between the two cuts and its height is the lift
 * height. Producing that view means face areas, opening clipping, reveal
 * counting, and corner trim all run through the existing per-element code with
 * no pour-awareness of their own — the alternative was a `pourUnit?` parameter
 * threaded through every one of them, each free to forget it.
 *
 * Openings are rebased into the scoped frame rather than filtered, so one that
 * straddles a cut is clipped by `clipOpening` exactly as an opening running off
 * the end of a wall already is, and contributes a reveal on the side where
 * concrete remains.
 */

function pointAlong(element: CastableElement, along: number): Vec2 {
  const length = elementLength(element)
  if (length < 1e-9) return element.start
  const t = along / length
  return {
    x: element.start.x + (element.end.x - element.start.x) * t,
    y: element.start.y + (element.end.y - element.start.y) * t,
  }
}

function rebaseOpening(opening: ElementOpening, unit: PourUnit): ElementOpening {
  return {
    ...opening,
    along: opening.along - unit.startAlong,
    centreY: opening.centreY - unit.baseElevation,
  }
}

export function scopeToPourUnit(element: CastableElement, unit: PourUnit): CastableElement {
  return {
    ...element,
    start: pointAlong(element, unit.startAlong),
    end: pointAlong(element, unit.endAlong),
    height: unit.topElevation - unit.baseElevation,
    openings: element.openings.map((opening) => rebaseOpening(opening, unit)),
  }
}

/**
 * Whether each boundary of the unit is the element's own boundary or a cut
 * inside it. An end at a cut cannot be classified against neighbours — there is
 * nothing there to abut — and a top that is not the element's top is a lift
 * joint rather than a finished surface.
 */

const BOUNDARY_TOLERANCE = 1e-6

export function isTopmostLift(element: CastableElement, unit: PourUnit): boolean {
  return unit.topElevation >= element.height - BOUNDARY_TOLERANCE
}

export function reachesElementStart(unit: PourUnit): boolean {
  return unit.startAlong <= BOUNDARY_TOLERANCE
}

export function reachesElementEnd(element: CastableElement, unit: PourUnit): boolean {
  return unit.endAlong >= elementLength(element) - BOUNDARY_TOLERANCE
}
