import type {
  FaceMeasurement,
  MeasurementStage,
  MeasurementStandard,
  SurfaceClass,
  WidthBandRule,
} from './types'

/**
 * Banding — the step between "how much contact area is there" and "what goes on
 * the bill". Two faces of equal area are not equal work: a 200 mm nib is priced
 * per metre because the cost is in its edges, a 400 mm slab needs heavier
 * falsework than a 150 mm one, and a soffit 5 m up needs longer props than one
 * at 2 m. Every standard says so, each in its own words, so the bands are read
 * off the `MeasurementStandard` rather than hard-coded here.
 *
 * See `wiki/formwork/reference/coverage.md` §1.8 and §4.1 item 7 for the HKSMM4
 * clauses, and `wiki/formwork/reference/products.md` §4.3 for the NRM2 table.
 */

/**
 * Stage arithmetic runs on metres, so a 200 mm band is 0.2 and `0.2 / 0.1` is
 * 2.0000000000000004. Without a tolerance a face sitting exactly on a boundary
 * lands one stage too high, which is a wrong BOQ line for the commonest sizes.
 */
const BAND_EPSILON = 1e-9

function formatBound(valueM: number, unit: 'mm' | 'm'): string {
  return unit === 'mm' ? `${Math.round(valueM * 1000)} mm` : `${valueM.toFixed(2)} m`
}

/**
 * The stage a value falls in, where the first band runs from 0 to `baseM` and
 * every band after it is `stepM` deep — the shape both HKSMM4 soffit rules take.
 * Bounds are inclusive at the top: a 200 mm slab is in the 0–200 band, not the
 * one above.
 */
export function stageAt(
  valueM: number,
  baseM: number,
  stepM: number,
  unit: 'mm' | 'm',
): MeasurementStage {
  if (valueM <= baseM + BAND_EPSILON) {
    return { index: 0, lowerM: 0, upperM: baseM, label: `≤ ${formatBound(baseM, unit)}` }
  }
  const index = Math.ceil((valueM - baseM) / stepM - BAND_EPSILON)
  const lowerM = baseM + (index - 1) * stepM
  const upperM = baseM + index * stepM
  return {
    index,
    lowerM,
    upperM,
    label: `${formatBound(lowerM, unit)}–${formatBound(upperM, unit)}`,
  }
}

/**
 * The width to state on the item. HKSMM4 groups narrow widths into 100 mm
 * stages, so a 130 mm nib and a 200 mm one are the same item; NRM2 item 24 asks
 * for the width itself, so it is stated as measured.
 */
export function statedWidth(widthM: number, rule: WidthBandRule): number {
  if (rule.stageM === undefined) return widthM
  return Math.ceil(widthM / rule.stageM - BAND_EPSILON) * rule.stageM
}

function narrowWidthRuleFor(
  standard: MeasurementStandard,
  role: string,
  widthM: number,
): WidthBandRule | undefined {
  const rule = standard.narrowWidth
  if (!rule || !rule.roles.includes(role)) return undefined
  return widthM <= rule.thresholdM + BAND_EPSILON ? rule : undefined
}

export interface BandFaceInput {
  role: string
  standard: MeasurementStandard
  /** What the contract pays for in m², after the standard's deductions. */
  measuredAreaSqM: number
  /**
   * The face's two rectangular sides in m, in any order — the narrower one is
   * the width the clause tests. Absent for a face that is not a rectangle, such
   * as a slab soffit or a column top, which no width rule reaches anyway.
   */
  extentsM?: readonly [number, number]
  surfaceClass: SurfaceClass
  /** Element thickness in m — the soffit thickness stage. */
  thicknessM?: number
  /**
   * Soffit height above the floor it is propped off, in m. Absent when nobody
   * has stated it: an invented prop length is worse than a gap on the item.
   */
  soffitHeightAboveSupportM?: number
  /** Slope of a formed top in degrees, for standards that band it. */
  slopeDeg?: number
}

/**
 * How one formed face is billed. `quantity` is in `unit`, so a narrow face
 * reports its run in metres and everything else its measured area in m².
 */
export function bandFace(input: BandFaceInput): FaceMeasurement {
  const { standard } = input
  const refs = [standard.sourceRef]

  const widthM = input.extentsM ? Math.min(...input.extentsM) : undefined
  const runM = input.extentsM ? Math.max(...input.extentsM) : undefined
  const narrow = widthM === undefined ? undefined : narrowWidthRuleFor(standard, input.role, widthM)

  const measurement: FaceMeasurement = {
    unit: narrow ? 'm' : 'm2',
    // A narrow face is billed along its full measured run. Physical trim does
    // not shorten it for the same reason it does not reduce a measured area:
    // no standard deducts at an intersection.
    quantity: narrow && runM !== undefined ? runM : input.measuredAreaSqM,
    surfaceClass: input.surfaceClass,
    sourceRefs: refs,
  }

  if (narrow && widthM !== undefined) {
    measurement.widthM = widthM
    measurement.statedWidthM = statedWidth(widthM, narrow)
    refs.push(narrow.sourceRef)
  }

  const soffit = standard.soffitStages
  if (soffit && input.role === 'soffit') {
    if (input.thicknessM !== undefined) {
      measurement.thicknessStage = stageAt(
        input.thicknessM,
        soffit.thicknessBaseM,
        soffit.thicknessStepM,
        'mm',
      )
    }
    if (input.soffitHeightAboveSupportM !== undefined) {
      measurement.heightStage = stageAt(
        input.soffitHeightAboveSupportM,
        soffit.heightBaseM,
        soffit.heightStepM,
        'm',
      )
    }
    if (measurement.thicknessStage || measurement.heightStage) refs.push(soffit.sourceRef)
  }

  if (standard.slopingTopBandDeg !== undefined && input.surfaceClass === 'sloping') {
    const boundaryDeg = standard.slopingTopBandDeg
    measurement.slopeBand = {
      boundaryDeg,
      over: (input.slopeDeg ?? 0) > boundaryDeg,
    }
  }

  measurement.sourceRefs = [...new Set(refs)]
  return measurement
}

export const SURFACE_CLASS_LABELS: Record<SurfaceClass, string> = {
  vertical: 'Vertical',
  horizontal: 'Horizontal',
  sloping: 'Sloping',
  curved: 'Curved one way',
}

export function slopeBandLabel(band: { boundaryDeg: number; over: boolean }): string {
  return band.over ? `> ${band.boundaryDeg}°` : `≤ ${band.boundaryDeg}°`
}

/**
 * What bands this item, without its quantity: the stated width and the stages.
 * These stay in the clause's own units however the project displays lengths — a
 * HKSMM4 item reads "≤ 200 mm" on a job in feet, because that is the band's
 * name rather than a measurement of anything.
 *
 * Empty for a face that only bands by area with no stated width, which is the
 * ordinary case.
 */
export function faceBandLabel(measurement: FaceMeasurement): string {
  const parts: string[] = []
  if (measurement.statedWidthM !== undefined) {
    parts.push(`width ${formatBound(measurement.statedWidthM, 'mm')}`)
  }
  if (measurement.thicknessStage) parts.push(`thickness ${measurement.thicknessStage.label}`)
  if (measurement.heightStage) parts.push(`height ${measurement.heightStage.label}`)
  if (measurement.slopeBand) parts.push(slopeBandLabel(measurement.slopeBand))
  return parts.join(' · ')
}

/** `faceBandLabel` with the metric quantity in front — for reports, not the UI. */
export function faceMeasurementLabel(measurement: FaceMeasurement): string {
  const quantity =
    measurement.unit === 'm'
      ? `${measurement.quantity.toFixed(2)} m run`
      : `${measurement.quantity.toFixed(2)} m²`
  const bands = faceBandLabel(measurement)
  return bands ? `${quantity} · ${bands}` : quantity
}
