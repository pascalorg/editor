import type { AnyNodeId } from '../../../schema/types'
import type { MeasurementStandard } from '../measurement/types'
import { openingBandLabel } from '../measurement/standards'
import type { CastableElement, ElementOpening } from './elements'
import { elementLength } from './elements'
import type { Deduction, OpeningMeasurement } from './types'

/**
 * Openings both take area off a face and add reveal faces, and the two move in
 * opposite directions. Above the standard's threshold the deduction dominates;
 * below it nothing is deducted at all and the reveals are pure addition, so a
 * wall peppered with small penetrations needs *more* formwork than a blank one.
 * Getting this backwards understates a facade by several percent.
 *
 * `physicalArea` is always reduced — you really do cut the panel — while
 * `measuredArea` follows the contract. See `measurement/standards.ts`.
 */

/** Openings shallower than this are ignored as modelling noise, in meters. */
const MIN_OPENING_EXTENT = 1e-4

interface ClippedOpening {
  areaSqM: number
  /** Reveal faces that exist once the void is clipped to the element. */
  revealSides: number
  revealPerimeter: number
}

/**
 * Intersects the void with the element's elevation and counts the reveals it
 * leaves. A door standing on the floor has no sill reveal, so it forms three
 * sides, not four — the single most commonly over-counted quantity here.
 */
function clipOpening(element: CastableElement, opening: ElementOpening): ClippedOpening | null {
  const length = elementLength(element)
  const left = Math.max(0, opening.along - opening.width / 2)
  const right = Math.min(length, opening.along + opening.width / 2)
  const bottom = Math.max(0, opening.centreY - opening.height / 2)
  const top = Math.min(element.height, opening.centreY + opening.height / 2)
  const width = right - left
  const height = top - bottom
  if (width <= MIN_OPENING_EXTENT || height <= MIN_OPENING_EXTENT) return null

  let revealSides = 0
  let revealPerimeter = 0
  // A reveal exists only where the void has concrete around it. Where it runs
  // out to an edge of the element there is no returned face to form.
  if (left > MIN_OPENING_EXTENT) {
    revealSides++
    revealPerimeter += height
  }
  if (right < length - MIN_OPENING_EXTENT) {
    revealSides++
    revealPerimeter += height
  }
  if (bottom > MIN_OPENING_EXTENT) {
    revealSides++
    revealPerimeter += width
  }
  if (top < element.height - MIN_OPENING_EXTENT) {
    revealSides++
    revealPerimeter += width
  }

  return { areaSqM: width * height, revealSides, revealPerimeter }
}

function classifyOpening(
  element: CastableElement,
  opening: ElementOpening,
  standard: MeasurementStandard,
): OpeningMeasurement | null {
  const clipped = clipOpening(element, opening)
  if (!clipped) return null

  const revealAreaSqM = clipped.revealPerimeter * element.coreThickness
  const base = {
    openingId: opening.id,
    kind: opening.kind,
    areaSqM: clipped.areaSqM,
    revealSides: clipped.revealSides,
    revealAreaSqM,
    revealsMeasured: standard.revealsMeasured,
  }

  if (standard.openings.kind === 'extra-over-count') {
    return {
      ...base,
      measuredDeductionPerFace: 0,
      reason: 'OPENING_EXTRA_OVER',
      extraOverBand: openingBandLabel(clipped.areaSqM, standard.openings.bandsSqM),
    }
  }

  const deducts = clipped.areaSqM > standard.openings.thresholdSqM
  return {
    ...base,
    measuredDeductionPerFace: deducts ? clipped.areaSqM : 0,
    reason: deducts ? 'OPENING' : 'OPENING_BELOW_THRESHOLD',
  }
}

export function measureOpenings(
  element: CastableElement,
  standard: MeasurementStandard,
): OpeningMeasurement[] {
  const out: OpeningMeasurement[] = []
  for (const opening of element.openings) {
    const measured = classifyOpening(element, opening, standard)
    if (measured) out.push(measured)
  }
  return out
}

/** The deductions one formed side face carries, given the element's openings. */
export function deductionsForSideFace(openings: OpeningMeasurement[]): Deduction[] {
  return openings.map((opening) => ({
    reason: opening.reason,
    sourceId: opening.openingId as AnyNodeId,
    areaSqM: opening.areaSqM,
    physicalSqM: opening.areaSqM,
    measuredSqM: opening.measuredDeductionPerFace,
  }))
}

/** Reveal area added by the element's openings, split by what each number counts. */
export function revealAreas(openings: OpeningMeasurement[]): {
  physical: number
  measured: number
} {
  let physical = 0
  let measured = 0
  for (const opening of openings) {
    physical += opening.revealAreaSqM
    if (opening.revealsMeasured) measured += opening.revealAreaSqM
  }
  return { physical, measured }
}
