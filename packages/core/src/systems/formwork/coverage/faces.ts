import type { AnyNode, AnyNodeId } from '../../../schema/types'
import { bandFace } from '../measurement/banding'
import { measurementStandard, DEFAULT_MEASUREMENT_STANDARD_ID } from '../measurement/standards'
import type { MeasurementStandard, SurfaceClass } from '../measurement/types'
import {
  isTopmostLift,
  reachesElementEnd,
  reachesElementStart,
  scopeToPourUnit,
} from '../pours/scope'
import type { PourLimits, PourUnit } from '../pours/types'
import { hardCutsForElement, pourUnitsForElement } from '../pours/units'
import { type CastableElement, collectCastableElements, elementLength } from './elements'
import { footprintEdges } from './footprint'
import {
  type Abutment,
  type AbutmentMap,
  findAbutments,
  findJunctions,
  JUNCTION_TOLERANCE,
} from './junctions'
import { deductionsForSideFace, measureOpenings, revealAreas } from './openings'
import {
  buriedEdgeLength,
  governingNeighbour,
  mergeTrimContributions,
  ownsOverlap,
  scaleTrimContributions,
  sideFaceTrim,
  type TrimContribution,
  trimDeductions,
  trimLengthM,
} from './trim'
import {
  type Deduction,
  type ElementCorner,
  type ElementCoverage,
  type FaceReason,
  type FaceRole,
  type FormworkFace,
  type FormworkJunction,
  type OpeningMeasurement,
  isFormedReason,
} from './types'

/**
 * Face classification — the rule the reported bug was really about.
 *
 * A freestanding wall is four formed faces: both sides plus a stop-end at each
 * free end. A wall running between two columns that were cast first is two:
 * the ends butt hardened concrete and need no stop-end. Everything in between
 * falls out of relative cast order, so `castOrder` is an input, not a label.
 *
 * The face *set* is a function of kind: a wall has two sides and two ends, a
 * rectangular column four faces (a circular one a single wrapped shaft), a slab
 * a soffit and a rim. Which of them are formed is then the same question for
 * all three, answered the same way.
 *
 * Every face carries two areas. `physicalArea` is what you buy and cut, so
 * every void and every buried corner is real. `measuredArea` is what the
 * contract pays for, so it follows the active `MeasurementStandard` — no
 * deduction at intersections, and openings only above the standard's
 * threshold. They diverge by several percent on a junction-heavy building.
 */

/** Above this top slope the top must be formed and held down against uplift. */
export const DEFAULT_TOP_FORM_ANGLE_THRESHOLD_DEG = 10

/** A rim stretch shorter than this is modelling noise, not a real face. */
const MIN_EDGE_LENGTH = 1e-6

export interface ClassifyOptions {
  topFormAngleThresholdDeg?: number
  /** Contract measurement rules. Defaults to `DEFAULT_MEASUREMENT_STANDARD_ID`. */
  standard?: MeasurementStandard
  /**
   * The element's level neighbours, needed to trim corner overlaps. Without
   * them faces keep their full rectangles and junctions double-count.
   */
  neighbours?: CastableElement[]
  /**
   * The level's junctions, for the corner hardware. Derived from `neighbours`
   * when absent; passed in by the whole-scene entry points so one pass serves
   * every element rather than each rebuilding the same fan.
   */
  junctions?: FormworkJunction[]
  /**
   * Classify one (segment × lift) instead of the whole element. Absent means
   * the element is cast in one operation, which is the answer for most walls
   * and the only answer before pour limits are configured.
   */
  pourUnit?: PourUnit
}

/**
 * Whether `element` is cast before `neighbour`. Callers must handle the
 * unsequenced case themselves — see `classifyEnd`.
 */
function castsBefore(element: CastableElement, neighbour: Abutment): boolean {
  if (element.castOrder === undefined || neighbour.neighbourCastOrder === undefined) return false
  if (element.castOrder === neighbour.neighbourCastOrder) {
    // Deterministic tie-break so a shared cast order still yields exactly one
    // stop-end between the pair rather than none or two.
    return element.id < neighbour.neighbourId
  }
  return element.castOrder < neighbour.neighbourCastOrder
}

function isMonolithicWith(element: CastableElement, neighbour: Abutment): boolean {
  return element.pourId !== undefined && element.pourId === neighbour.neighbourPourId
}

/** The neighbour that governs an end: the earliest-cast one that abuts it. */
function governingAbutment(
  element: CastableElement,
  abutments: Abutment[],
): Abutment | undefined {
  const monolithic = abutments.find((a) => isMonolithicWith(element, a))
  if (monolithic) return monolithic
  const earlier = abutments.filter((a) => !castsBefore(element, a))
  const pool = earlier.length > 0 ? earlier : abutments
  return [...pool].sort((a, b) => {
    const ao = a.neighbourCastOrder ?? Number.POSITIVE_INFINITY
    const bo = b.neighbourCastOrder ?? Number.POSITIVE_INFINITY
    if (ao !== bo) return ao - bo
    return a.neighbourId < b.neighbourId ? -1 : 1
  })[0]
}

function classifyEnd(
  element: CastableElement,
  abutments: Abutment[],
): { reason: FaceReason; neighbourId?: AnyNodeId } {
  if (abutments.length === 0) return { reason: 'FREE_END_STOP_END' }

  const governing = governingAbutment(element, abutments)
  if (!governing) return { reason: 'FREE_END_STOP_END' }

  if (isMonolithicWith(element, governing)) {
    return { reason: 'MONOLITHIC_CONTINUATION', neighbourId: governing.neighbourId }
  }
  if (element.castOrder === undefined || governing.neighbourCastOrder === undefined) {
    // Without a sequence we cannot know which side hardened first. Form the
    // stop-end and say why: over-forming is recoverable, a missing bulkhead
    // is a blowout. The distinct reason is what prompts the user to sequence.
    return { reason: 'STOP_END_UNSEQUENCED', neighbourId: governing.neighbourId }
  }
  if (castsBefore(element, governing)) {
    // We're poured first, so the later element butts us — we carry the
    // stop-end, and starter bars pass through it.
    return { reason: 'STOP_END_FOR_LATER_ABUTMENT', neighbourId: governing.neighbourId }
  }
  return { reason: 'ABUTS_HARDENED_CONCRETE', neighbourId: governing.neighbourId }
}

function classifyTop(
  element: CastableElement,
  thresholdDeg: number,
  isTopmost: boolean,
): { reason: FaceReason; upliftLoaded?: boolean } {
  // A lift joint is not a finished surface, so none of the top-surface rules
  // apply to it: the concrete is struck off level and the lift above continues
  // from there, whatever the element's eventual top does.
  if (!isTopmost) return { reason: 'LIFT_JOINT_OPEN' }
  const top = element.topSurface
  if (top.kind === 'bounded') return { reason: 'CAST_AGAINST_SOFFIT_ABOVE' }
  if (top.kind === 'formed' || top.slopeDeg > thresholdDeg) {
    return { reason: 'FORMED_SLOPING_TOP', upliftLoaded: true }
  }
  return { reason: 'SCREEDED_OPEN' }
}

function classifySide(
  element: CastableElement,
  side: 'a' | 'b',
): FaceReason {
  if (element.againstEarthSide === side) return 'AGAINST_EARTH'
  if (element.formworkMode === 'single-sided-a' && side === 'b') return 'SINGLE_SIDED_BRACED_FACE'
  if (element.formworkMode === 'single-sided-b' && side === 'a') return 'SINGLE_SIDED_BRACED_FACE'
  return 'FORMED_SIDE'
}

interface FaceInput {
  role: FaceRole
  reason: FaceReason
  grossArea: number
  /**
   * Every loss from this face, openings and buried corners alike. A buried
   * corner is a deduction rather than a bare trim so the face names the element
   * that owns it: "12 m² instead of 15" is an argument, and the estimator's next
   * question is always which neighbour took the other 3.
   */
  deductions?: Deduction[]
  /**
   * Contract rules for the banding pass. Absent leaves the face unbanded, which
   * is right for a face nobody bills: an unformed one, or a base that bears on
   * the substrate.
   */
  standard?: MeasurementStandard
  surfaceClass?: SurfaceClass
  /**
   * The face's two rectangular sides in m, narrower one first or second — the
   * width rule takes the min and the run the max. Absent for a face that is not
   * a rectangle, such as a soffit or a column top.
   */
  extentsM?: readonly [number, number]
  /** Soffit banding inputs — thickness and prop height, both m. */
  thicknessM?: number
  soffitHeightAboveSupportM?: number
  slopeDeg?: number
  extra?: Partial<FormworkFace>
}

function face(elementId: AnyNodeId, input: FaceInput): FormworkFace {
  const formed = isFormedReason(input.reason)
  const deductions = input.deductions ?? []
  if (!formed) {
    return {
      elementId,
      role: input.role,
      formed,
      reason: input.reason,
      physicalArea: 0,
      measuredArea: 0,
      deductions: [],
      ...input.extra,
    }
  }
  let physical = input.grossArea
  let measured = input.grossArea
  for (const deduction of deductions) {
    physical -= deduction.physicalSqM
    measured -= deduction.measuredSqM
  }
  const measuredArea = Math.max(0, measured)
  return {
    elementId,
    role: input.role,
    formed,
    reason: input.reason,
    physicalArea: Math.max(0, physical),
    measuredArea,
    deductions,
    measurement:
      input.standard && input.surfaceClass
        ? bandFace({
            role: input.role,
            standard: input.standard,
            measuredAreaSqM: measuredArea,
            extentsM: input.extentsM,
            surfaceClass: input.surfaceClass,
            thicknessM: input.thicknessM,
            soffitHeightAboveSupportM: input.soffitHeightAboveSupportM,
            slopeDeg: input.slopeDeg,
          })
        : undefined,
    ...input.extra,
  }
}

/**
 * A curved wall's faces are not plane, and every standard classifies them
 * separately — the inner and outer forms have different radii, so they are not
 * even the same panel count. `curveOffset` is the arc's midpoint offset, so any
 * non-zero value means curvature.
 */
function verticalOrCurved(element: CastableElement): SurfaceClass {
  return element.curveOffset ? 'curved' : 'vertical'
}

/** How a formed top reads to a standard that bands by slope. */
function topSurfaceClass(element: CastableElement): SurfaceClass {
  return element.topSurface.slopeDeg > 0 ? 'sloping' : 'horizontal'
}

/** The roles an element of this kind has, formed or not. */
function rolesFor(element: CastableElement): FaceRole[] {
  if (element.kind === 'column') {
    return element.faceLayout === 'shaft'
      ? ['shaft', 'top', 'bottom']
      : ['column-face-1', 'column-face-2', 'column-face-3', 'column-face-4', 'top', 'bottom']
  }
  if (element.kind === 'slab') return ['soffit', 'edge', 'top']
  return ['side-a', 'side-b', 'end-start', 'end-end', 'top', 'bottom']
}

function unformedCoverage(element: CastableElement): ElementCoverage {
  return {
    elementId: element.id,
    faces: rolesFor(element).map((role) =>
      face(element.id, { role, reason: 'FORMWORK_DISABLED', grossArea: 0 }),
    ),
    openings: [],
    corners: [],
    physicalArea: 0,
    measuredArea: 0,
  }
}

/**
 * The corner units touching `element`: whether each is formed at all, and which
 * of the formed ones it bills.
 *
 * `formed` is monolithic-only, and that keeps it exclusive with the stop-end
 * rules: a shared pour is the one case `classifyEnd` builds no bulkhead for, so
 * a corner turns there and nowhere else. Every other case already has a plate at
 * that point (`STOP_END_*`) or butts concrete that hardened first
 * (`ABUTS_HARDENED_CONCRETE`), and a corner unit as well would be contradictory
 * hardware at the same point.
 *
 * Ownership then follows the overlap: the earlier-cast leg pays, ties break on
 * the lower id. That is the same rule the areas use, so a corner's hardware and
 * the face area it covers are always charged to the same element — and a junction
 * of three walls still yields exactly one payer per unit.
 */
function cornersFor(
  element: CastableElement,
  junctions: readonly FormworkJunction[],
  lookup: (id: AnyNodeId) => CastableElement | undefined,
): ElementCorner[] {
  const out: ElementCorner[] = []
  for (const junction of junctions) {
    for (const corner of junction.corners) {
      const leg = corner.legs.find((candidate) => candidate.elementId === element.id)
      if (!leg) continue
      const other = corner.legs.find((candidate) => candidate.elementId !== element.id)
      const neighbour = other ? lookup(other.elementId) : undefined
      // Both questions are about the pair, so an unresolvable neighbour makes
      // neither answerable — reporting a guess would put hardware on a face on
      // the strength of a missing lookup.
      if (!neighbour) continue
      const abutment: Abutment = {
        neighbourId: neighbour.id,
        neighbourCastOrder: neighbour.castOrder,
        neighbourPourId: neighbour.pourId,
        angleDeg: corner.angleDeg,
      }
      out.push({
        junctionKind: junction.kind,
        point: junction.point,
        corner,
        leg,
        formed: isMonolithicWith(element, abutment),
        owns: ownsOverlap(element, abutment),
      })
    }
  }
  return out
}

/** A bulkhead is penetrated by whatever reinforcement continues past it. */
function penetratedByStarters(reason: FaceReason): boolean {
  return reason === 'STOP_END_FOR_LATER_ABUTMENT' || reason === 'POUR_BREAK_BULKHEAD'
}

function totals(
  element: CastableElement,
  faces: FormworkFace[],
  openings: OpeningMeasurement[],
  corners: ElementCorner[] = [],
): ElementCoverage {
  const reveals = revealAreas(openings)
  return {
    elementId: element.id,
    faces,
    openings,
    corners,
    physicalArea: faces.reduce((sum, f) => sum + f.physicalArea, 0) + reveals.physical,
    measuredArea: faces.reduce((sum, f) => sum + f.measuredArea, 0) + reveals.measured,
  }
}

function classifyWallFaces(
  element: CastableElement,
  scoped: CastableElement,
  ends: { start: Abutment[]; end: Abutment[] },
  options: {
    atStart: boolean
    atEnd: boolean
    atTop: boolean
    onJoint: boolean
    thresholdDeg: number
    standard: MeasurementStandard
    lookup: (id: AnyNodeId) => CastableElement | undefined
    corners: ElementCorner[]
  },
): ElementCoverage {
  const length = elementLength(scoped)
  const sideArea = length * scoped.height
  const endArea = scoped.coreThickness * scoped.height
  const topArea = length * scoped.coreThickness

  // A cut face has no neighbour to butt: the concrete on the far side is this
  // same element, cast in a different operation, so the bulkhead is always
  // built regardless of what stands beyond the element's real end.
  const startEnd = options.atStart
    ? classifyEnd(element, ends.start)
    : { reason: 'POUR_BREAK_BULKHEAD' as FaceReason, neighbourId: undefined }
  const endEnd = options.atEnd
    ? classifyEnd(element, ends.end)
    : { reason: 'POUR_BREAK_BULKHEAD' as FaceReason, neighbourId: undefined }
  const top = classifyTop(element, options.thresholdDeg, options.atTop)
  const openings = measureOpenings(scoped, options.standard)

  const standard = options.standard
  const sideClass = verticalOrCurved(element)
  const sideTrim = {
    a: sideFaceTrim(scoped, 'a', ends, options.lookup),
    b: sideFaceTrim(scoped, 'b', ends, options.lookup),
  }
  const faces: FormworkFace[] = [
    face(element.id, {
      role: 'side-a',
      reason: classifySide(element, 'a'),
      grossArea: sideArea,
      deductions: [
        ...deductionsForSideFace(openings),
        ...trimDeductions(sideTrim.a, scoped.height),
      ],
      standard,
      surfaceClass: sideClass,
      // The narrow dimension of a *side* face is the wall's plan length, not its
      // thickness — the clause is about short returns and nibs. A 150 mm-long
      // nib is a 150 mm-wide strip measured by the metre of its height; a
      // 200 mm-thick wall 10 m long is an ordinary m² face.
      extentsM: [length, scoped.height],
      extra: { neighbourId: governingNeighbour(sideTrim.a) },
    }),
    face(element.id, {
      role: 'side-b',
      reason: classifySide(element, 'b'),
      grossArea: sideArea,
      deductions: [
        ...deductionsForSideFace(openings),
        ...trimDeductions(sideTrim.b, scoped.height),
      ],
      standard,
      surfaceClass: sideClass,
      extentsM: [length, scoped.height],
      extra: { neighbourId: governingNeighbour(sideTrim.b) },
    }),
    face(element.id, {
      role: 'end-start',
      reason: startEnd.reason,
      grossArea: endArea,
      standard,
      surfaceClass: 'vertical',
      extentsM: [scoped.coreThickness, scoped.height],
      extra: {
        neighbourId: startEnd.neighbourId,
        starterPenetrations: penetratedByStarters(startEnd.reason),
      },
    }),
    face(element.id, {
      role: 'end-end',
      reason: endEnd.reason,
      grossArea: endArea,
      standard,
      surfaceClass: 'vertical',
      extentsM: [scoped.coreThickness, scoped.height],
      extra: {
        neighbourId: endEnd.neighbourId,
        starterPenetrations: penetratedByStarters(endEnd.reason),
      },
    }),
    face(element.id, {
      role: 'top',
      reason: top.reason,
      grossArea: topArea,
      standard,
      surfaceClass: topSurfaceClass(element),
      slopeDeg: element.topSurface.slopeDeg,
      extentsM: [scoped.coreThickness, length],
      extra: { upliftLoaded: top.upliftLoaded },
    }),
    face(element.id, {
      role: 'bottom',
      reason: options.onJoint ? 'BEARS_ON_LIFT_BELOW' : 'BEARS_ON_KICKER_OR_SUBSTRATE',
      grossArea: 0,
    }),
  ]

  return totals(element, faces, openings, options.corners)
}

/**
 * A column is four flat panels or one wrapped shaft, plus a top and a base.
 *
 * The interesting rule is subtraction: a column in the plane of a wall is a
 * pilaster, and the faces it shares with that wall are not formed — the
 * "column" may be absorbed into the wall's face run entirely. That is decided
 * per face from the plan footprints, not from a flag, because it is a
 * consequence of where the user drew things.
 */
function classifyColumnFaces(
  element: CastableElement,
  scoped: CastableElement,
  options: {
    atTop: boolean
    onJoint: boolean
    thresholdDeg: number
    standard: MeasurementStandard
    neighbours: readonly CastableElement[]
  },
): ElementCoverage {
  const height = scoped.height
  const plan = element.plan
  const standard = options.standard
  const top = classifyTop(element, options.thresholdDeg, options.atTop)
  const topArea = plan?.netAreaSqM ?? 0
  const faces: FormworkFace[] = []

  // A slab overlaps the whole plan of the column it passes through without
  // burying any of its vertical faces — the column is formed up to the soffit
  // and the slab starts there.
  const burying = options.neighbours.filter((other) => other.kind !== 'slab')

  if (element.faceLayout === 'shaft') {
    // A circular column is billed at π·D·h, so the perimeter is the true
    // circumference rather than that of the faceted outline used for clipping.
    const perimeter = plan?.perimeterM ?? 0
    const edges = footprintEdges(element)
    const facetedPerimeter = edges.reduce(
      (sum, edge) => sum + Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y),
      0,
    )
    // Clipping runs on the facets and billing on the true circumference, so the
    // buried runs are carried across before they become a deduction.
    const trim = scaleTrimContributions(
      mergeTrimContributions(edges.map((edge) => buriedEdgeLength(element, edge, burying))),
      facetedPerimeter > 0 ? perimeter / facetedPerimeter : 0,
    )
    const buried = trimLengthM(trim)
    faces.push(
      face(element.id, {
        role: 'shaft',
        reason: buried > perimeter - MIN_EDGE_LENGTH ? 'EMBEDDED_IN_WALL' : 'FORMED_COLUMN_SHAFT',
        grossArea: perimeter * height,
        deductions: trimDeductions(trim, height),
        standard,
        // A wrapped shaft is curved by construction, and its measured "width" is
        // the developed circumference — nothing about it is a narrow strip.
        surfaceClass: 'curved',
        extra: { neighbourId: governingNeighbour(trim) },
      }),
    )
  } else {
    const roles: FaceRole[] = [
      'column-face-1',
      'column-face-2',
      'column-face-3',
      'column-face-4',
    ]
    for (const [index, edge] of footprintEdges(element).entries()) {
      const role = roles[index]
      if (!role) continue
      const width = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y)
      if (width <= MIN_EDGE_LENGTH) continue
      const trim = buriedEdgeLength(element, edge, burying)
      const embedded = trimLengthM(trim) >= width - MIN_EDGE_LENGTH
      faces.push(
        face(element.id, {
          role,
          reason: embedded ? 'EMBEDDED_IN_WALL' : 'FORMED_COLUMN_FACE',
          grossArea: width * height,
          deductions: trimDeductions(trim, height),
          standard,
          surfaceClass: 'vertical',
          extentsM: [width, height],
          extra: { neighbourId: governingNeighbour(trim) },
        }),
      )
    }
  }

  faces.push(
    face(element.id, {
      role: 'top',
      reason: top.reason,
      grossArea: topArea,
      standard,
      surfaceClass: topSurfaceClass(element),
      slopeDeg: element.topSurface.slopeDeg,
      extra: { upliftLoaded: top.upliftLoaded },
    }),
    face(element.id, {
      role: 'bottom',
      reason: options.onJoint ? 'BEARS_ON_LIFT_BELOW' : 'BEARS_ON_KICKER_OR_SUBSTRATE',
      grossArea: 0,
    }),
  )

  return totals(element, faces, [])
}

/**
 * Holes in a slab, measured like openings in a wall: the concrete is physically
 * absent either way, and whether the contract deducts it is the standard's
 * call. A hole also adds edge forms around its own rim, which is why a slab
 * full of small penetrations can need more formwork than a blank one.
 */
function slabHoleDeductions(
  element: CastableElement,
  standard: MeasurementStandard,
): { deductions: Deduction[]; measurements: OpeningMeasurement[] } {
  const plan = element.plan
  if (!plan) return { deductions: [], measurements: [] }
  const deductions: Deduction[] = []
  for (const areaSqM of plan.holeAreasSqM) {
    const deducts =
      standard.openings.kind === 'deduct-above-area' && areaSqM > standard.openings.thresholdSqM
    deductions.push({
      reason: deducts
        ? 'OPENING'
        : standard.openings.kind === 'extra-over-count'
          ? 'OPENING_EXTRA_OVER'
          : 'OPENING_BELOW_THRESHOLD',
      sourceId: element.id,
      areaSqM,
      physicalSqM: areaSqM,
      measuredSqM: deducts ? areaSqM : 0,
    })
  }
  // Reported as face deductions rather than `OpeningMeasurement`s: a hole is
  // not a door, it has no node of its own to name, and its rim is billed with
  // the slab's edge forms rather than as an opening reveal.
  return { deductions, measurements: [] }
}

/**
 * A slab is a soffit and a rim. The soffit is the big number and is carried on
 * falsework rather than braced, so it is measured by thickness stage and
 * soffit-height stage; the rim is one face unless the edge is an upstand or a
 * downstand edge beam, and it is not formed where it butts something cast
 * earlier.
 */
function classifySlabFaces(
  element: CastableElement,
  options: {
    thresholdDeg: number
    standard: MeasurementStandard
    neighbours: readonly CastableElement[]
  },
): ElementCoverage {
  const plan = element.plan
  const thickness = element.coreThickness
  const holes = slabHoleDeductions(element, options.standard)

  // `againstEarthSide: 'b'` reads as "underside against ground" for a slab —
  // a ground-bearing slab is cast on blinding and needs no soffit form at all.
  const onGround = element.againstEarthSide === 'b'
  const soffit = face(element.id, {
    role: 'soffit',
    reason: onGround ? 'SLAB_ON_GROUND' : 'FORMED_SOFFIT',
    grossArea: plan?.areaSqM ?? 0,
    deductions: holes.deductions,
    standard: options.standard,
    // A sloping slab's soffit slopes with it, and NRM2 item 25 measures soffits
    // of sloping work as their own item.
    surfaceClass: element.topSurface.slopeDeg > 0 ? 'sloping' : 'horizontal',
    slopeDeg: element.topSurface.slopeDeg,
    thicknessM: thickness,
    soffitHeightAboveSupportM: element.soffitHeightAboveSupport,
  })

  // Only another slab can bury this rim. The walls and columns under it carry
  // it; they do not form its edge — that is exactly the mistake that leaves a
  // building with no edge forms billed anywhere.
  const burying = options.neighbours.filter((other) => other.kind === 'slab')
  const faceCount = element.edgeFaceCount ?? 1
  let rim = 0
  const perEdge: TrimContribution[][] = []
  for (const edge of footprintEdges(element)) {
    const width = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y)
    if (width <= MIN_EDGE_LENGTH) continue
    rim += width
    perEdge.push(buriedEdgeLength(element, edge, burying, JUNCTION_TOLERANCE))
  }
  // An upstand's two faces are both buried where the rim abuts, so the run is
  // charged once per face — the same reason the gross area multiplies by it.
  const trim = scaleTrimContributions(mergeTrimContributions(perEdge), faceCount)
  const buried = trimLengthM(trim)
  // Hole rims take edge forms too, and never abut anything.
  const holeRim = plan?.holePerimeterM ?? 0
  const fullyBuried =
    rim > 0 && buried >= rim * faceCount - MIN_EDGE_LENGTH && holeRim <= MIN_EDGE_LENGTH
  const edgeFace = face(element.id, {
    role: 'edge',
    reason: fullyBuried ? 'ABUTS_HARDENED_CONCRETE' : 'FORMED_SLAB_EDGE',
    grossArea: (rim * faceCount + holeRim) * thickness,
    deductions: trimDeductions(trim, thickness),
    standard: options.standard,
    surfaceClass: 'vertical',
    // A rim is as wide as the slab is deep and as long as the perimeter runs, so
    // an ordinary slab edge is always narrow — which is the point: both HKSMM4
    // and NRM2 bill it by the metre rather than as a sliver of area.
    extentsM: [thickness, rim * faceCount + holeRim],
    extra: { neighbourId: governingNeighbour(trim) },
  })

  const top =
    element.topSurface.kind === 'formed' || element.topSurface.slopeDeg > options.thresholdDeg
      ? { reason: 'FORMED_SLOPING_TOP' as FaceReason, upliftLoaded: true }
      : { reason: 'SLAB_TOP_FINISHED' as FaceReason, upliftLoaded: undefined }
  const topFace = face(element.id, {
    role: 'top',
    reason: top.reason,
    grossArea: plan?.netAreaSqM ?? 0,
    standard: options.standard,
    surfaceClass: element.topSurface.slopeDeg > 0 ? 'sloping' : 'horizontal',
    slopeDeg: element.topSurface.slopeDeg,
    extra: { upliftLoaded: top.upliftLoaded },
  })

  return totals(element, [soffit, edgeFace, topFace], holes.measurements)
}

export function classifyElementFaces(
  element: CastableElement,
  abutments: AbutmentMap,
  options: ClassifyOptions = {},
): ElementCoverage {
  const thresholdDeg = options.topFormAngleThresholdDeg ?? DEFAULT_TOP_FORM_ANGLE_THRESHOLD_DEG
  const standard = options.standard ?? measurementStandard(DEFAULT_MEASUREMENT_STANDARD_ID)
  const unit = options.pourUnit
  const ends = abutments.get(element.id) ?? { start: [], end: [] }
  const neighbours = options.neighbours ?? []
  const byId = new Map(neighbours.map((e) => [e.id, e]))
  const lookup = (id: AnyNodeId) => byId.get(id)

  if (!element.formworkEnabled || element.formworkMode === 'none') {
    return unformedCoverage(element)
  }

  // Every rule below reads a `CastableElement`, so a pour unit is handled by
  // classifying the sub-element it describes rather than by teaching each rule
  // about lifts. Only the boundary questions — is this end a real end, is this
  // top a real top — need to know a cut is involved.
  const scoped = unit ? scopeToPourUnit(element, unit) : element
  const atTop = unit ? isTopmostLift(element, unit) : true
  const onJoint = unit?.hasJointBelow ?? false

  if (element.kind === 'column') {
    return classifyColumnFaces(element, scoped, {
      atTop,
      onJoint,
      thresholdDeg,
      standard,
      neighbours,
    })
  }

  if (element.kind === 'slab') {
    // A slab is cast in one operation in this phase — bay-splitting it is a
    // polygon partition, not a cut along a centreline — so there is no unit to
    // scope to and no lift joint to report.
    return classifySlabFaces(element, { thresholdDeg, standard, neighbours })
  }

  // Corner hardware sits at the element's real ends, so a pour unit that does
  // not reach one has no corner there to place or pay for: the shutter closes on
  // a bulkhead instead and the corner belongs to the unit that does reach it.
  const junctions = options.junctions ?? findJunctions(neighbours)
  const corners = cornersFor(element, junctions, lookup).filter((entry) => {
    if (!unit) return true
    if (entry.leg.end === 'start') return reachesElementStart(unit)
    if (entry.leg.end === 'end') return reachesElementEnd(element, unit)
    return entry.leg.alongM >= unit.startAlong && entry.leg.alongM <= unit.endAlong
  })

  return classifyWallFaces(element, scoped, ends, {
    atStart: unit ? reachesElementStart(unit) : true,
    atEnd: unit ? reachesElementEnd(element, unit) : true,
    atTop,
    onJoint,
    thresholdDeg,
    standard,
    lookup,
    corners,
  })
}

/** Classifies every castable element in `nodes` against its neighbours. */
export function classifyCoverage(
  nodes: AnyNode[],
  options: ClassifyOptions = {},
): Map<AnyNodeId, ElementCoverage> {
  const elements = collectCastableElements(nodes)
  const abutments = findAbutments(elements)
  const junctions = findJunctions(elements)
  const out = new Map<AnyNodeId, ElementCoverage>()
  for (const element of elements) {
    out.set(
      element.id,
      classifyElementFaces(element, abutments, { ...options, neighbours: elements, junctions }),
    )
  }
  return out
}

/** Convenience for the geometry builder: which faces of one element to build. */
export function coverageForElement(
  elementId: AnyNodeId,
  nodes: AnyNode[],
  options: ClassifyOptions = {},
): ElementCoverage | undefined {
  const elements = collectCastableElements(nodes)
  const target = elements.find((e) => e.id === elementId)
  if (!target) return undefined
  return classifyElementFaces(target, findAbutments(elements), {
    ...options,
    neighbours: elements,
  })
}

/**
 * Coverage per pour unit for one element — one entry per (segment × lift), each
 * the scope of a single formwork assembly.
 *
 * Summing these does not give `coverageForElement`, and shouldn't: splitting a
 * wall into two lifts adds a lift-joint top to the lower one and buys nothing
 * for it, while splitting it into two segments adds two real bulkheads. That
 * increase is the cost of the split, and it is exactly the number a user needs
 * in order to argue about where the joints go.
 */
export function pourCoverageForElement(
  elementId: AnyNodeId,
  nodes: AnyNode[],
  limits: PourLimits = {},
  options: ClassifyOptions = {},
): Array<{ unit: PourUnit; coverage: ElementCoverage }> {
  const elements = collectCastableElements(nodes)
  const target = elements.find((e) => e.id === elementId)
  if (!target) return []
  const abutments = findAbutments(elements)
  const junctions = findJunctions(elements)
  return pourUnitsForElement(target, limits, hardCutsForElement(elementId, nodes)).map((unit) => ({
    unit,
    coverage: classifyElementFaces(target, abutments, {
      ...options,
      neighbours: elements,
      junctions,
      pourUnit: unit,
    }),
  }))
}
