/**
 * ATTIC VENTILATION — the calculation a roof plan has to show.
 *
 * IRC R806.2 sets the minimum net free ventilating area at 1/150 of the area
 * of the vented space, with an exception permitting 1/300 when BOTH of two
 * conditions are met. Pascal cannot know whether the second condition (the
 * 40–50 percent upper/lower split) will be built, so this module computes
 * BOTH and prints both — the reader picks, having been told the conditions.
 * It never declares a compliance result, and it never picks a vent product:
 * the net free area of a louver, ridge or soffit vent comes off the
 * manufacturer's listing, not out of this file.
 *
 * WHAT "ATTIC AREA" MEANS HERE: the sum of the roof segments' width × depth,
 * which is the footprint UNDER the roof — the ceiling plane below the vented
 * space. `roof-segment.overhang` is a separate field and is NOT included, so
 * the eave overhang does not inflate the required vent area. Where a scene
 * has more than one segment the sum is a plain sum: overlapping segments are
 * not deducted, and that is said out loud in the warnings.
 */
import type { AnyNodeLike, NodeMap } from '../model'

const SQFT_PER_SQM = 10.763910416709722

export type AtticSegment = {
  id: string
  name: string
  roofType: string
  /** Footprint under the roof, metres. */
  widthM: number
  depthM: number
  areaSqFt: number
  /** Slope as rise-in-12, e.g. '7:12'; '—' when the node has no pitch. */
  pitch: string
}

export type AtticVentilation = {
  segments: AtticSegment[]
  /** Total footprint under the roof. */
  areaSqM: number
  areaSqFt: number
  /** Net free ventilating area at 1/150 of the vented area, square inches. */
  required150SqIn: number
  /** The R806.2 exception's 1/300 alternative, square inches. */
  required300SqIn: number
  /** 40–50 % of the 1/300 figure — the upper (ridge / gable) share. */
  upperShare: { minSqIn: number; maxSqIn: number }
  /** The balance, at the eaves — 50–60 % of the 1/300 figure. */
  lowerShare: { minSqIn: number; maxSqIn: number }
  warnings: string[]
}

/**
 * Roof-segment `pitch` is stored in DEGREES. A roof plan is labelled in rise
 * over a 12 run, so the degrees are converted and rounded to the nearest half
 * — 30.256° → tan 0.5833 → 7.00 → '7:12'.
 */
export function pitchLabel(pitchDeg: number | undefined): string {
  if (typeof pitchDeg !== 'number' || !Number.isFinite(pitchDeg)) return '—'
  if (pitchDeg <= 0) return 'FLAT'
  const rise = Math.tan((pitchDeg * Math.PI) / 180) * 12
  if (!Number.isFinite(rise) || rise <= 0) return '—'
  const rounded = Math.round(rise * 2) / 2
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text}:12`
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Roof segments in the scene, visible ones only, in scene order. */
export function roofSegments(nodes: NodeMap): AnyNodeLike[] {
  return Object.values(nodes).filter(
    (node): node is AnyNodeLike => node?.type === 'roof-segment' && node.visible !== false,
  )
}

export function computeAtticVentilation(nodes: NodeMap): AtticVentilation {
  const warnings: string[] = []
  const segments: AtticSegment[] = []
  let areaSqM = 0

  let openPorches = 0
  for (const node of roofSegments(nodes)) {
    // an open porch or deck cover has no attic under it — the generator
    // marks its segments (metadata.roof.open / role 'porch'); they are not
    // part of the vented area
    const meta = (node.metadata ?? {}) as { roof?: { open?: unknown; role?: unknown } }
    if (meta.roof?.open === true || meta.roof?.role === 'porch') {
      openPorches += 1
      continue
    }
    const width = num(node.width)
    const depth = num(node.depth)
    if (width === null || depth === null || width <= 0 || depth <= 0) {
      warnings.push(`Roof segment ${String(node.id)} has no width/depth — excluded from the area.`)
      continue
    }
    const area = width * depth
    areaSqM += area
    segments.push({
      id: String(node.id),
      name: typeof node.name === 'string' && node.name ? node.name : 'Roof segment',
      roofType: typeof node.roofType === 'string' ? node.roofType : 'gable',
      widthM: width,
      depthM: depth,
      areaSqFt: area * SQFT_PER_SQM,
      pitch: pitchLabel(num(node.pitch) ?? undefined),
    })
  }

  const areaSqFt = areaSqM * SQFT_PER_SQM
  const required150SqIn = (areaSqFt * 144) / 150
  const required300SqIn = (areaSqFt * 144) / 300

  if (segments.length === 0) {
    warnings.push('No roof segments in this scene — the attic area cannot be computed.')
  }
  if (openPorches > 0) {
    warnings.push(
      `${openPorches} open porch roof segment${openPorches === 1 ? '' : 's'} excluded — no attic under an open porch or deck cover.`,
    )
  }
  if (segments.length > 1) {
    warnings.push(
      `Attic area is the plain sum of ${segments.length} roof-segment footprints; overlapping segments are NOT deducted — verify the vented area.`,
    )
  }
  warnings.push(
    'Area is the footprint under the roof (segment width × depth); eave overhangs are excluded. Unvented or cathedral portions of the ceiling must be deducted by hand.',
  )

  return {
    segments,
    areaSqM,
    areaSqFt,
    required150SqIn,
    required300SqIn,
    upperShare: { minSqIn: required300SqIn * 0.4, maxSqIn: required300SqIn * 0.5 },
    lowerShare: { minSqIn: required300SqIn * 0.5, maxSqIn: required300SqIn * 0.6 },
    warnings,
  }
}

/**
 * The two conditions the 1/300 exception depends on, verbatim in substance
 * from IRC R806.2. Printed under the table so nobody takes the smaller number
 * without reading what it costs.
 */
export const R806_2_EXCEPTION_CONDITIONS: string[] = [
  '1.  In Climate Zones 6, 7 and 8, a Class I or II vapor retarder is installed on the warm-in-winter side of the ceiling.',
  '2.  Not less than 40 % and not more than 50 % of the required ventilating area is provided by ventilators located in the upper portion of the attic or rafter space, not more than 3 ft below the ridge or highest point of the space measured vertically, with the balance provided by eave or cornice vents.',
]

export const R806_1_NOTES: string[] = [
  'Enclosed attics and enclosed rafter spaces shall have cross ventilation for each separate space. Ventilation openings shall be protected against the entrance of rain and snow. (R806.1)',
  'Openings shall have a least dimension of not less than 1/16 in and not more than 1/4 in, and shall be covered with corrosion-resistant wire cloth, hardware cloth, perforated vinyl or similar material. (R806.1)',
  'Vent net free area is the manufacturer’s listed NFA for the product installed — louver, ridge, off-ridge, soffit or frieze-block vent. Pascal does not select vent products; the installed NFA shall be scheduled by the contractor and shown to equal or exceed the required area above. (R806.2)',
]
