import type { ConstructionJointNode, WaterstopType } from '../../../schema/nodes/construction-joint'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import { type FormworkSystem, fitCorner, tieForThickness } from '../catalog'
import {
  type CastableElement,
  collectCastableElements,
  type ElementOpening,
  elementLength,
} from '../coverage/elements'
import { classifyElementFaces } from '../coverage/faces'
import {
  type Abutment,
  type AbutmentMap,
  cornerLegExtent,
  cornerLegLength,
  DEFAULT_INSIDE_CORNER_LEG_M,
  findAbutments,
  findJunctions,
} from '../coverage/junctions'
import type { ElementCorner, ElementCoverage } from '../coverage/types'
import { MIN_WORKABLE_PIECE_MM, type StripPack } from '../layout/strip-pack'
import { splitIntoLifts } from '../pours/lifts'
import type { PourLimits, PourUnit } from '../pours/types'
import { hardCutsForElement, pourUnitsForElement } from '../pours/units'
import type { PressureEnvelope } from '../pressure'
import type { Finding, InvariantId, TieField, ValidationReport } from './types'

/**
 * The assertion suite — solver phase 11, and the plan calls it the highest-value
 * output for a reason worth restating: every other module answers what the job
 * needs, and this one answers whether what it needs can be built.
 *
 * Each check below is a pure function of data the scene already carries. That
 * constraint is the design: an invariant that needs a field nobody enters is an
 * invariant that never fires, and a suite half-populated with those reads as a
 * pass. So the ones whose inputs do not exist yet are *declared* in `notChecked`
 * rather than written and left dormant — see `unavailable()`.
 *
 * The suite sweeps a scope rather than an element. That is the whole difference
 * between this and the per-member capacity checks the parts table already shows:
 * a wall can be individually fine and still be the second half of a cast-order
 * cycle, and nothing local to it can see that.
 */

/** Areas within this fraction of each other are the same area, not a discrepancy. */
const AREA_TOLERANCE = 0.005

/** Tie stations within this of the mirror position are symmetric, mm. */
const SYMMETRY_TOLERANCE_MM = 5

/** A lift joint further than this from a permitted elevation was not snapped, m. */
const JOINT_SNAP_REPORT_TOLERANCE = 1e-6

/**
 * Narrower than this and an untied band is not a finding, mm.
 *
 * Not a tolerance — a site fact. The two forms either side of a nib this narrow are
 * strutted directly against each other, which is what a carpenter does with a 200 mm
 * pier between a door jamb and a wall end, and reporting it as an untied stretch
 * would put a finding on every wall whose opening lands near its end.
 */
const MIN_TIED_BAND_MM = 300

/** Along-run positions within this are the same station, m. */
const STATION_TOLERANCE_M = 1e-6

/**
 * Two corner legs sharing less than this are touching, not clashing, m.
 *
 * 2 mm, matching `JOINT_TOLERANCE_MM` — the width at which the layout already calls
 * two panel edges one joint. Legs that meet exactly are the *intended* geometry on a
 * return exactly twice the leg length, and a millimetre past that is a wall drawn to
 * a dimension nobody sets out to: two panel edges 1 mm apart are one joint on site,
 * and reporting it would put a finding on a wall the crew forms without noticing.
 */
const LEG_OVERLAP_TOLERANCE_M = 0.002

/**
 * Tie holes within this of each other are one row, m.
 *
 * Rows have to be grouped rather than compared exactly. Two runs on one face can be
 * packed with different panel widths, and a narrow panel is drilled at its own
 * levels, so the same physical row arrives as two elevations a millimetre apart.
 * Split, each half carries only some of the row's stations — and a band tied by a
 * station in the other half reads as untied.
 */
const ROW_TOLERANCE_M = 0.02

/**
 * How wide a waterstop is across the joint when nobody has said, m.
 *
 * A default per type rather than one figure, because the range across the three is
 * an order of magnitude and the clearance a tie needs is the width itself. PVC bar
 * is sold in 150 / 200 / 250 mm and 200 is the common central section; an external
 * surface bar is wider because it is bonded either side of the joint rather than
 * cast through it; a hydrophilic strip is a 20–25 mm section swelling against the
 * substrate. `coverage.md` §1.3, and `JointTreatment.width` overrides any of them.
 */
const WATERSTOP_WIDTHS_M: Record<WaterstopType, number> = {
  'pvc-central': 0.2,
  'pvc-surface': 0.25,
  hydrophilic: 0.025,
}

export interface ValidateOptions {
  /** Scope to one level's elements. Absent sweeps every castable element given. */
  parentId?: AnyNodeId
  /**
   * Scope to a named set — a selection. Absent sweeps whatever `parentId` leaves.
   *
   * An empty array is an empty scope, not an absent one: asked about nothing, the
   * report has to say nothing was checked rather than report the whole scene, which
   * reads as findings about elements the caller never asked about.
   */
  elementIds?: readonly AnyNodeId[]
  /** Project pour limits, so the lift split matches what the shutters were built to. */
  limits?: PourLimits
  /**
   * The catalog system each element is formed in, for the corner-fit and tie-reach
   * checks.
   *
   * Per element rather than one for the scope, because `systemId` is a field on the
   * assembly: a job can form one wall in Framax and the next in TRIO, and checking
   * wall B's thickness against wall A's catalog is a check against hardware that is
   * not on the wall. An element absent from the map is not checked — it has no
   * system, so there is no tie range it could be outside of.
   */
  systems?: Map<AnyNodeId, FormworkSystem>
  /**
   * Per-element packed runs, when the caller has them. The layout checks are
   * skipped rather than re-solved without these: packing a run here would be a
   * second layout pass, and a second pass is how the validation report comes to
   * disagree with the panel it is validating.
   */
  packs?: Map<AnyNodeId, readonly StripPack[]>
  /** Per-element design envelopes, for the code-envelope check. Same reasoning. */
  envelopes?: Map<AnyNodeId, PressureEnvelope>
  /**
   * Where a tie can pass on each shutter, for the ties × openings clash.
   *
   * One field per shutter rather than one per element, because the stations are
   * only meaningful over the stretch that shutter forms: a pour unit's holes say
   * nothing about the stretch the next unit covers, and merging them would report
   * a band as tied by a hole in a different pour.
   */
  tieFields?: Map<AnyNodeId, readonly TieField[]>
}

function finding(
  invariant: InvariantId,
  severity: Finding['severity'],
  elementIds: AnyNodeId[],
  message: string,
  locus?: Finding['locus'],
): Finding {
  return { invariant, severity, elementIds, message, ...(locus ? { locus } : {}) }
}

/**
 * Cast order as a directed graph over *pours*, and whether it has a cycle.
 *
 * The graph has to be over pours rather than elements, and the reason is the
 * whole content of this check. `castOrder` is a single integer per element, so
 * edges between elements always run from a lower number to a higher one and the
 * element graph is acyclic by construction — a check on it would be a check that
 * cannot fail, which is worse than no check because it reports a pass.
 *
 * `pourId` is what makes a cycle possible. Elements sharing one are cast in a
 * single operation, so they contract to one node, and their individual cast
 * orders become claims about that whole node. Two walls in pour P either side of
 * a wall in pour Q — the first before it, the second after — say P must be cast
 * before Q and after it. On site that is a pour somebody cannot place: the
 * monolithic wall would have to be poured in two halves, which is exactly what
 * putting them in one pour said it would not be.
 *
 * Nothing local sees it. Each element's own sequence is consistent, each
 * abutment is reasonable, and the contradiction only exists once the pour is
 * treated as the indivisible thing it is.
 */
function castOrderCycles(elements: readonly CastableElement[], abutments: AbutmentMap): Finding[] {
  const byId = new Map(elements.map((element) => [element.id, element]))
  /** An unpoured element is its own pour: it is cast alone. */
  const pourOf = (element: CastableElement) => element.pourId ?? `#${element.id}`
  const members = new Map<string, AnyNodeId[]>()
  for (const element of elements) {
    const pour = pourOf(element)
    members.set(pour, [...(members.get(pour) ?? []), element.id])
  }

  const edges = new Map<string, Set<string>>()
  for (const element of elements) {
    const ends = abutments.get(element.id)
    if (!ends || element.castOrder === undefined) continue
    for (const abutment of [...ends.start, ...ends.end]) {
      const neighbour = byId.get(abutment.neighbourId)
      if (!neighbour || neighbour.castOrder === undefined) continue
      const from = pourOf(element)
      const to = pourOf(neighbour)
      if (from === to) continue
      // The edge runs from the pour cast first to the one that waits on it.
      const [earlier, later] = element.castOrder < neighbour.castOrder ? [from, to] : [to, from]
      if (element.castOrder === neighbour.castOrder) continue
      edges.set(earlier, (edges.get(earlier) ?? new Set()).add(later))
    }
  }

  const state = new Map<string, 'open' | 'done'>()
  const stack: string[] = []
  const rings: string[][] = []

  const walk = (pour: string) => {
    const seen = state.get(pour)
    if (seen === 'done') return
    if (seen === 'open') {
      // The ring, not just the node that closed it: a cycle reported as one id
      // sends the reader to a wall whose own sequence looks fine.
      const from = stack.indexOf(pour)
      rings.push(stack.slice(from >= 0 ? from : 0))
      return
    }
    state.set(pour, 'open')
    stack.push(pour)
    for (const next of edges.get(pour) ?? []) walk(next)
    stack.pop()
    state.set(pour, 'done')
  }
  for (const pour of members.keys()) walk(pour)

  const label = (pour: string) => (pour.startsWith('#') ? pour.slice(1) : `pour ${pour}`)
  return rings.map((ring) =>
    finding(
      'CAST_ORDER_CYCLE',
      'error',
      ring.flatMap((pour) => members.get(pour) ?? []).sort(),
      `Cast order cannot be executed: ${ring.map(label).join(' → ')} → ${label(ring[0] as string)} each wait for the next. A pour cast either side of another has to be split into two, or the sequence has to change.`,
    ),
  )
}

/**
 * A single-sided pour with nothing earlier to tie back to.
 *
 * Single-sided work carries its whole lateral load into an anchored base or the
 * element behind it, so something on that side has to be hardened before the
 * pour. Where the braced side abuts nothing and no earth is named, the shutter
 * has nothing to resist it — a check no per-element view can make, because the
 * element's own faces are all classified correctly.
 */
function singleSidedAnchors(
  elements: readonly CastableElement[],
  abutments: AbutmentMap,
): Finding[] {
  const out: Finding[] = []
  for (const element of elements) {
    const mode = element.formworkMode
    if (mode !== 'single-sided-a' && mode !== 'single-sided-b') continue
    const bracedSide = mode === 'single-sided-a' ? 'b' : 'a'
    // Cast against earth or rock is the ordinary reason for single-sided work,
    // and the ground is the anchor. Nothing to check.
    if (element.againstEarthSide === bracedSide) continue

    const ends = abutments.get(element.id) ?? { start: [], end: [] }
    const neighbours: Abutment[] = [...ends.start, ...ends.end]
    const earlier = neighbours.filter(
      (abutment) =>
        element.castOrder !== undefined &&
        abutment.neighbourCastOrder !== undefined &&
        abutment.neighbourCastOrder < element.castOrder,
    )
    if (earlier.length > 0) continue

    out.push(
      finding(
        'SINGLE_SIDED_ANCHOR_NOT_EARLIER',
        'error',
        [element.id],
        neighbours.length === 0
          ? `${element.id} is formed on one side only, but its braced side is not against earth and it abuts nothing. Single-sided formwork has to bear back onto something already hardened.`
          : `${element.id} is formed on one side only, and nothing it abuts is cast before it. Set a cast order that puts its anchor first, or state which side is against earth.`,
      ),
    )
  }
  return out
}

/**
 * The plan's `sum(trimmed formed areas) === trueWrappedArea` — the assertion
 * that says whether the m² on an order is real.
 *
 * The prism two elements share at a junction is formed once, by whichever of them
 * is cast first, and `ownsOverlap` decides which. The loser records a
 * `CORNER_OVERLAP_REASSIGNED` deduction; the owner keeps its full face. So the
 * assertion is an ownership one and it is inherently about the pair: exactly one
 * of them deducts. Both deducting means a stretch of concrete nobody forms and
 * nobody bills — the shutter arrives short at the corner — and nothing either
 * element's own coverage says would reveal it, because each is individually
 * self-consistent.
 *
 * The second check is arithmetic on one deduction: the run it takes off cannot
 * exceed the run the neighbour actually buries. `overlapM` is what was
 * considered and `lengthM` what was charged, and the incremental credit that
 * keeps three walls on one stretch from deducting it three times is exactly
 * where a scaling slip — a round column billed at π·D against a faceted clip —
 * would land.
 *
 * A pair where *neither* deducts is not asserted. It would mean the prism was
 * billed twice, but it is indistinguishable here from a junction whose overlap is
 * genuinely nil, and a suite that reports a clean collinear butt as an error is a
 * suite somebody switches off.
 */
function areaConsistency(coverages: ReadonlyMap<AnyNodeId, ElementCoverage>): Finding[] {
  const out: Finding[] = []
  const reassignedTo = (coverage: ElementCoverage, neighbourId: AnyNodeId) =>
    coverage.faces.some((face) =>
      face.deductions.some(
        (entry) =>
          entry.reason === 'CORNER_OVERLAP_REASSIGNED' &&
          entry.sourceId === neighbourId &&
          entry.physicalSqM > 0,
      ),
    )

  for (const [elementId, coverage] of coverages) {
    for (const face of coverage.faces) {
      for (const entry of face.deductions) {
        if (entry.physicalSqM <= entry.areaSqM * (1 + AREA_TOLERANCE)) continue
        out.push(
          finding(
            'AREA_DOUBLE_COUNTED',
            'error',
            [elementId, entry.sourceId],
            `${elementId} ${face.role}: ${entry.physicalSqM.toFixed(2)} m² taken off for ${entry.sourceId}, which only buries ${entry.areaSqM.toFixed(2)} m² of it. More has been deducted than that neighbour covers.`,
          ),
        )
      }
    }

    for (const [otherId, other] of coverages) {
      // One direction per pair, so the finding is reported once.
      if (otherId <= elementId) continue
      if (!reassignedTo(coverage, otherId)) continue
      if (!reassignedTo(other, elementId)) continue
      out.push(
        finding(
          'AREA_DOUBLE_COUNTED',
          'error',
          [elementId, otherId],
          `${elementId} and ${otherId} each deduct the overlap they share, so neither forms it. One of them is cast first and bills the corner — the deduction belongs on the other only.`,
        ),
      )
    }
  }
  return out
}

/**
 * An unformable strip, and a make-up piece nobody can fix.
 *
 * `packStrip` reports `unfilledMm` rather than hiding it, and reports it exactly
 * where no division of the run leaves a closable remainder. On site that is a
 * blowout: concrete leaves through the gap. A `cut` piece below the workable
 * minimum is the softer version — ply strips under ~100 mm split when nailed and
 * cannot span walers — so it is a warning naming the width, because the fix is a
 * different filler position rather than a different wall.
 */
function layoutFindings(packs: ReadonlyMap<AnyNodeId, readonly StripPack[]>): Finding[] {
  const out: Finding[] = []
  for (const [elementId, runs] of packs) {
    for (const [index, pack] of runs.entries()) {
      if (pack.unfilledMm > 0) {
        out.push(
          finding(
            'UNFORMABLE_STRIP',
            'error',
            [elementId],
            `${elementId} run ${index + 1}: ${pack.unfilledMm.toFixed(0)} mm of the run has no panel, filler or cut board that closes it. Concrete leaves through an unformed strip.`,
          ),
        )
      }
      for (const piece of pack.pieces) {
        if (piece.kind !== 'cut') continue
        if (piece.widthMm >= MIN_WORKABLE_PIECE_MM) continue
        out.push(
          finding(
            'FILLER_BELOW_MINIMUM',
            'warning',
            [elementId],
            `${elementId} run ${index + 1}: a ${piece.widthMm.toFixed(0)} mm cut piece at ${piece.fromMm.toFixed(0)} mm, under the ${MIN_WORKABLE_PIECE_MM} mm a board can be nailed and still span its walers. Move the make-up piece, or accept a site-built closure here.`,
            { alongM: piece.fromMm / 1000 },
          ),
        )
      }
    }
  }
  return out
}

/**
 * A wall outside the reach of every tie the system publishes a range for.
 *
 * The severity here is what the catalog decides, and the distinction is real. A
 * system tie has a `wallRangeMm` because it is an assembly of fixed parts — a
 * cone of a given length, a nut, a plate — and outside that range it does not
 * physically go together. A through-rod has no range because it is bar cut to
 * length, so it reaches anything.
 *
 * So a wall past every stated range is not unbuildable: it is a wall that has to
 * be tied with cut rod. That is a purchasing and labour change rather than a
 * blowout — bar cut and threaded on site, and the rod is lost in the pour or
 * recovered by hand — which is a warning. `tieForThickness` returning nothing at
 * all is the error: nothing in the system holds the two skins together, and
 * laying out panels anyway produces a shutter that opens under pressure.
 */
function tieReach(
  elements: readonly CastableElement[],
  systems: ReadonlyMap<AnyNodeId, FormworkSystem>,
): Finding[] {
  const out: Finding[] = []
  for (const element of elements) {
    const system = systems.get(element.id)
    if (!system) continue
    const ranged = system.ties.filter((tie) => tie.wallRangeMm)
    if (element.kind !== 'wall') continue
    if (!element.formworkEnabled || element.formworkMode === 'none') continue
    // Single-sided work is tied back to an anchor, not through the wall, so the
    // through-thickness range does not apply to it.
    if (element.formworkMode !== 'double-sided') continue
    const thicknessMm = element.coreThickness * 1000

    if (!tieForThickness(system, thicknessMm)) {
      out.push(
        finding(
          'WALL_OUTSIDE_TIE_RANGE',
          'error',
          [element.id],
          `${element.id} is ${thicknessMm.toFixed(0)} mm thick and no tie in ${system.label} holds it. This wall needs a different system or single-sided forms — panels with nothing tying the two skins together open under pressure.`,
        ),
      )
      continue
    }

    if (ranged.length === 0) continue
    const withinRange = ranged.some(
      (tie) =>
        tie.wallRangeMm &&
        thicknessMm >= tie.wallRangeMm.minMm &&
        thicknessMm <= tie.wallRangeMm.maxMm,
    )
    if (withinRange) continue
    const reach = ranged
      .map((tie) => tie.wallRangeMm)
      .filter((range): range is { minMm: number; maxMm: number } => range !== undefined)
    const minMm = Math.min(...reach.map((range) => range.minMm))
    const maxMm = Math.max(...reach.map((range) => range.maxMm))
    out.push(
      finding(
        'WALL_OUTSIDE_TIE_RANGE',
        'warning',
        [element.id],
        `${element.id} is ${thicknessMm.toFixed(0)} mm thick, outside the ${minMm}–${maxMm} mm every ${system.label} tie assembly is made for. It has to be tied with rod cut and threaded to length, which is a different item and a slower cycle than a system tie.`,
      ),
    )
  }
  return out
}

/**
 * An architectural face whose tie holes are not symmetric about the run.
 *
 * On exposed concrete the tie holes are the visible grid — they are patched, and
 * the patches are what the eye reads — so an asymmetric layout is a defect even
 * where it is structurally perfect. This is the check the plan lists and the one
 * an estimator would never catch from a bill: the panel count is identical either
 * way.
 *
 * Symmetry is tested about the run's own midpoint, station by station, since the
 * grid the architect specified is a mirror rather than a modulus.
 */
function architecturalSymmetry(
  elements: readonly CastableElement[],
  packs: ReadonlyMap<AnyNodeId, readonly StripPack[]>,
): Finding[] {
  const out: Finding[] = []
  for (const element of elements) {
    if (element.exposureClass !== 'architectural') continue
    const runs = packs.get(element.id)
    if (!runs) continue
    for (const [index, pack] of runs.entries()) {
      const joints = pack.pieces.map((piece) => piece.toMm)
      const runMm = joints[joints.length - 1]
      if (runMm === undefined || runMm <= 0) continue
      const interior = joints.slice(0, -1)
      const asymmetric = interior.filter(
        (station) =>
          !interior.some((other) => Math.abs(runMm - other - station) <= SYMMETRY_TOLERANCE_MM),
      )
      if (asymmetric.length === 0) continue
      out.push(
        finding(
          'ARCHITECTURAL_TIE_GRID_ASYMMETRIC',
          'warning',
          [element.id],
          `${element.id} is architectural concrete and ${asymmetric.length} of its ${interior.length} panel joints have no mirror on the other half of the run. The joint and tie-hole grid is what the eye reads on exposed work, so this needs a symmetric filler position.`,
          { alongM: (asymmetric[0] as number) / 1000 },
        ),
      )
    }
  }
  return out
}

/**
 * An opening the lift joint runs through.
 *
 * The bulkhead closing a lift joint has to cross the wall, and where it crosses a
 * void there is nothing to fix it to and nothing to seal against. In practice the
 * joint is moved above or below the opening; the point of flagging it is that
 * neither the coverage pass nor the panel layout can see it — one classifies
 * faces, the other packs a run, and the collision is between a horizontal joint
 * and a hole in elevation.
 */
function openingsAcrossLiftJoints(
  elements: readonly CastableElement[],
  limits: PourLimits,
): Finding[] {
  const out: Finding[] = []
  for (const element of elements) {
    if (element.openings.length === 0) continue
    const lifts = splitIntoLifts(element, limits)
    if (lifts.length < 2) continue
    for (const lift of lifts) {
      if (!lift.hasJointBelow) continue
      const elevation = lift.baseElevation
      for (const opening of element.openings) {
        const bottom = opening.centreY - opening.height / 2
        const top = opening.centreY + opening.height / 2
        if (elevation <= bottom || elevation >= top) continue
        out.push(
          finding(
            'OPENING_STRADDLES_LIFT_JOINT',
            'error',
            [element.id, opening.id],
            `${element.id}: the lift joint at ${elevation.toFixed(2)} m runs through ${opening.kind} ${opening.id}, which spans ${bottom.toFixed(2)}–${top.toFixed(2)} m. The bulkhead has nothing to bear on across the void — move the joint clear of the opening.`,
            { alongM: opening.along, elevationM: elevation, liftIndex: lift.index },
          ),
        )
      }
    }
  }
  return out
}

/** A stretch of one tie row with concrete in it, and what bounds it. */
interface TiedBand {
  loM: number
  hiM: number
  /** The openings whose jambs cut it out. Empty where only the shutter ends bound it. */
  byIds: AnyNodeId[]
}

/**
 * The stretches of one tie row that are concrete rather than void.
 *
 * Only the openings crossing this elevation cut it: a door head at 2.1 m takes
 * nothing out of the row at 2.7 m, and treating every opening as a full-height cut
 * is how a wall with a low window gets reported as untied at the top.
 */
function bandsAlongRow(
  field: TieField,
  openings: readonly ElementOpening[],
  elevationM: number,
): TiedBand[] {
  let bands: TiedBand[] = [{ loM: field.fromM, hiM: field.toM, byIds: [] }]
  for (const opening of openings) {
    const bottom = opening.centreY - opening.height / 2
    const top = opening.centreY + opening.height / 2
    if (elevationM <= bottom || elevationM >= top) continue
    const left = opening.along - opening.width / 2
    const right = opening.along + opening.width / 2
    const next: TiedBand[] = []
    for (const band of bands) {
      if (right <= band.loM || left >= band.hiM) {
        next.push(band)
        continue
      }
      if (left > band.loM) {
        next.push({ loM: band.loM, hiM: left, byIds: [...band.byIds, opening.id] })
      }
      if (right < band.hiM) {
        next.push({ loM: right, hiM: band.hiM, byIds: [...band.byIds, opening.id] })
      }
    }
    bands = next
  }
  return bands
}

/** The holes grouped into rows: each row's elevation, and every station on it. */
function tieRows(holes: TieField['holes']): Array<[number, number[]]> {
  const rows: Array<{ elevationM: number; stations: number[] }> = []
  for (const hole of [...holes].sort((a, b) => a.elevationM - b.elevationM)) {
    const row = rows.at(-1)
    if (row && hole.elevationM - row.elevationM <= ROW_TOLERANCE_M) row.stations.push(hole.alongM)
    else rows.push({ elevationM: hole.elevationM, stations: [hole.alongM] })
  }
  return rows.map((row) => [row.elevationM, row.stations])
}

/**
 * A band of concrete beside an opening with no tie able to pass through it —
 * phase 9's ties × openings clash, and the one clash pass whose two inputs the
 * project already solves.
 *
 * The clash itself is not the finding, and that distinction is the whole design.
 * A rod through a void is drawn nowhere: the wall builder already drops those
 * stations, because a tie landing in an opening has nothing to bear on. So
 * asserting "a tie hits a window" would report a condition the model never
 * produces, while the consequence of dropping them — a pier or a head band with
 * no tie left in it — is reported by nothing at all. That is what blows out: the
 * band is loaded on both faces, and on a panel system there is no hole to add,
 * because the frames arrive drilled. The fix is a strut through the box-out or a
 * strongback spanning the opening, and either is a decision somebody makes rather
 * than one a layout makes for them — hence a warning.
 *
 * Bounded at both ends, because neither half is visible alone: the tie grid knows
 * where the holes are and nothing about the voids, and the coverage pass knows the
 * voids and nothing about a drilled frame. `untied-stretch` in `tieGrid` is the
 * neighbouring case with no opening in it, so a band bounded only by the shutter's
 * own ends is left to that check rather than reported twice here.
 *
 * One finding per band and not per row. A full-height window beside a pier fails
 * the pier at every course, and four findings about one 250 mm band reads as four
 * problems; the rows are counted in the message and the lowest is the locus,
 * because pressure is worst at the bottom of the pour.
 */
function tiesAroundOpenings(
  elements: readonly CastableElement[],
  fields: ReadonlyMap<AnyNodeId, readonly TieField[]>,
): Finding[] {
  const out: Finding[] = []
  for (const element of elements) {
    if (element.openings.length === 0) continue
    const label = new Map(element.openings.map((opening) => [opening.id, opening.kind]))
    for (const field of fields.get(element.id) ?? []) {
      // No drilled grid: a conventional shutter is bored where the calculation asks,
      // so there is no fixed set of stations a band can fall between.
      if (field.holes.length === 0) continue
      const failed = new Map<string, { band: TiedBand; elevations: number[] }>()
      for (const [elevationM, stations] of tieRows(field.holes)) {
        for (const band of bandsAlongRow(field, element.openings, elevationM)) {
          if ((band.hiM - band.loM) * 1000 < MIN_TIED_BAND_MM) continue
          if (band.byIds.length === 0) continue
          const tied = stations.some(
            (alongM) =>
              alongM > band.loM - STATION_TOLERANCE_M && alongM < band.hiM + STATION_TOLERANCE_M,
          )
          if (tied) continue
          const key = `${band.loM.toFixed(4)}:${band.hiM.toFixed(4)}`
          const entry = failed.get(key)
          if (entry) entry.elevations.push(elevationM)
          else failed.set(key, { band, elevations: [elevationM] })
        }
      }

      for (const { band, elevations } of failed.values()) {
        const widthMm = (band.hiM - band.loM) * 1000
        const lowest = Math.min(...elevations)
        const named = [...new Set(band.byIds)]
          .map((id) => `${label.get(id) ?? 'opening'} ${id}`)
          .join(' and ')
        out.push(
          finding(
            'OPENING_LEAVES_TIE_GAP',
            'warning',
            [element.id, ...new Set(band.byIds)],
            `${element.id}: the ${widthMm.toFixed(0)} mm of wall from ${band.loM.toFixed(2)} to ${band.hiM.toFixed(2)} m, beside ${named}, has no drilled hole a tie passes through on ${elevations.length === 1 ? `the row at ${lowest.toFixed(2)} m` : `${elevations.length} tie rows`}. The frames arrive drilled, so there is no tie to add here — strut the two forms across the box-out, or back them with a strongback spanning the opening.`,
            { alongM: (band.loM + band.hiM) / 2, elevationM: lowest },
          ),
        )
      }
    }
  }
  return out
}

/**
 * A junction angle no hinged unit sweeps.
 *
 * `unfittableCorners` already answers this per junction; the value of asserting
 * it at scope is that the alternative is a bespoke timber corner, which is a
 * carpenter's item at a different rate and a different lead time. A bill that
 * quietly substitutes a catalog corner for one is short by the labour that
 * actually builds it.
 */
function junctionFit(
  elements: readonly CastableElement[],
  systems: ReadonlyMap<AnyNodeId, FormworkSystem>,
): Finding[] {
  const out: Finding[] = []
  const scoped = new Set(elements.map((element) => element.id))
  for (const junction of findJunctions([...elements])) {
    const ids = junction.elementIds.filter((id) => scoped.has(id))
    if (ids.length === 0) continue
    // A corner unit is one piece of hardware spanning both walls, so it has to
    // come out of a catalog they share. Where the two are formed in different
    // systems, every candidate is checked and the corner is only faulted when
    // none of them turns it — a unit from either side is still a unit somebody
    // has, and reporting a bespoke corner because the *first* system cannot
    // sweep it would send a carpenter to a junction the yard can close.
    const candidates = [
      ...new Set(junction.elementIds.map((id) => systems.get(id)).filter(Boolean)),
    ] as FormworkSystem[]
    if (candidates.length === 0) continue
    for (const corner of junction.corners) {
      if (candidates.some((system) => fitCorner(system, corner))) continue
      const named = candidates.map((system) => system.label).join(' or ')
      out.push(
        finding(
          'JUNCTION_ANGLE_UNFITTABLE',
          'warning',
          ids,
          `${ids.join(' and ')} meet at ${corner.angleDeg.toFixed(0)}°, which no ${corner.side} corner unit in ${named} sweeps. This is a bespoke timber corner — a carpenter's item, not a catalog one.`,
        ),
      )
    }
  }
  return out
}

/**
 * Where every formed corner unit's leg lands on this element, per face.
 *
 * The leg length is resolved exactly as the geometry builder resolves it — the
 * catalog's fitted leg where the system sweeps a unit for the angle, the derived
 * length where it does not — and the placement comes from `cornerLegExtent`, which
 * both share. A check that recomputed either would eventually disagree with the
 * shutter it is checking.
 *
 * Unformed corners are skipped: `formed` is monolithic-only, and every other case
 * already has a bulkhead at that point rather than a corner unit, so a leg there is
 * hardware nobody sets.
 */
function cornerLegsByFace(
  coverage: ElementCoverage,
  system: FormworkSystem | undefined,
): Map<'a' | 'b', Array<{ corner: ElementCorner; lo: number; hi: number }>> {
  const out = new Map<'a' | 'b', Array<{ corner: ElementCorner; lo: number; hi: number }>>()
  for (const entry of coverage.corners) {
    if (!entry.formed) continue
    const fit = system ? fitCorner(system, entry.corner) : undefined
    const legIndex = entry.corner.legs.indexOf(entry.leg) === 1 ? 1 : 0
    const length =
      fit?.legLengthsM[legIndex] ??
      cornerLegLength(entry.corner, entry.leg, DEFAULT_INSIDE_CORNER_LEG_M)
    const extent = cornerLegExtent(entry.corner, entry.leg, length)
    const face = entry.leg.face
    const held = out.get(face)
    const record = { corner: entry, ...extent }
    if (held) held.push(record)
    else out.set(face, [record])
  }
  for (const legs of out.values()) legs.sort((a, b) => a.lo - b.lo)
  return out
}

/**
 * Two corner units on one face reaching into the same stretch of it — phase 9's
 * panels × intersections clash, in the form the geometry cannot report.
 *
 * A wall between two returns carries a unit at each end, and each leg eats inward
 * from its own junction. Below about twice the leg length the two claim overlapping
 * concrete, and at the limit they are the same stretch. What makes this worth a
 * check rather than a note is that nothing downstream notices: `panelRuns` subtracts
 * each blocked stretch in turn, so an overlap simply leaves less run for panels, and
 * a run that disappears entirely produces no pack — hence no `unfilledMm`, no
 * `UNFORMABLE_STRIP`, and a bill with two corner units on a wall that has room for
 * one. Every number in the takeoff is self-consistent; the wall is not buildable as
 * drawn.
 *
 * The fix is a decision, not a layout: notch one unit, or form the short return as
 * a single bespoke box. So it is a warning, except where the legs need more of the
 * face than the face has — there, the concrete between them has no form at all.
 *
 * Reported per face, because the two skins genuinely differ. An outside leg is
 * longer than its inside counterpart by the wall thickness, so a link wall can be
 * fine on its inner face and clash on its outer one, and one finding averaged over
 * both would name the wrong stretch.
 */
function cornerUnitOverlaps(
  elements: readonly CastableElement[],
  coverages: ReadonlyMap<AnyNodeId, ElementCoverage>,
  systems: ReadonlyMap<AnyNodeId, FormworkSystem>,
): Finding[] {
  const out: Finding[] = []
  for (const element of elements) {
    const coverage = coverages.get(element.id)
    if (!coverage) continue
    const length = elementLength(element)
    for (const [face, legs] of cornerLegsByFace(coverage, systems.get(element.id))) {
      for (let i = 1; i < legs.length; i++) {
        const before = legs[i - 1] as (typeof legs)[number]
        const after = legs[i] as (typeof legs)[number]
        const overlapM = before.hi - after.lo
        if (overlapM <= LEG_OVERLAP_TOLERANCE_M) continue
        // Both legs off one face longer than the face itself: there is no stretch
        // between them to notch back to, so this is not a unit to trim but a return
        // too short to form out of corner units at all.
        const needed = legs.reduce((sum, leg) => sum + (leg.hi - leg.lo), 0)
        const unformable = needed > length + LEG_OVERLAP_TOLERANCE_M
        const others = [
          ...new Set(
            [before, after].flatMap((leg) =>
              leg.corner.corner.legs
                .map((candidate) => candidate.elementId)
                .filter((id) => id !== element.id),
            ),
          ),
        ]
        out.push(
          finding(
            'CORNER_UNITS_OVERLAP',
            unformable ? 'error' : 'warning',
            [element.id, ...others],
            unformable
              ? `${element.id} is ${(length * 1000).toFixed(0)} mm long and its face ${face} corner units need ${(needed * 1000).toFixed(0)} mm of it. There is no run left between them — form this return as one bespoke box rather than out of two corner units.`
              : `${element.id}: the face ${face} corner units at ${before.corner.leg.alongM.toFixed(2)} and ${after.corner.leg.alongM.toFixed(2)} m overlap by ${(overlapM * 1000).toFixed(0)} mm, both reaching into the wall from ${after.lo.toFixed(2)} to ${before.hi.toFixed(2)} m. Two units cannot occupy one stretch — notch one back, or form the return as a single unit. The panel run between them is measured as though both fit.`,
            { alongM: (after.lo + before.hi) / 2 },
          ),
        )
      }
    }
  }
  return out
}

/**
 * An opening whose jamb falls inside the stretch a corner unit occupies — the
 * plan's "opening too near a corner → custom".
 *
 * A corner unit is one rigid piece of steel with the frame already on it. An
 * opening reaching into it cannot be boxed out by moving a panel joint, because
 * there is no joint there to move: the box-out has to be cut into the unit itself,
 * which is a modification to hired plant somebody has to authorise, or the corner
 * is built bespoke in timber.
 *
 * A jamb *inside* the leg and not merely near it, because near is the ordinary
 * case — an opening 400 mm off a corner is normal and forms with a filler. The
 * geometry that cannot be built is the overlap, and using a comfort distance
 * instead would fault walls the crew forms every day.
 *
 * A warning: both answers are buildable, and which one applies depends on whether
 * the plant is owned or hired, which no field here records.
 */
function openingsInsideCornerUnits(
  elements: readonly CastableElement[],
  coverages: ReadonlyMap<AnyNodeId, ElementCoverage>,
  systems: ReadonlyMap<AnyNodeId, FormworkSystem>,
): Finding[] {
  const out: Finding[] = []
  for (const element of elements) {
    if (element.openings.length === 0) continue
    const coverage = coverages.get(element.id)
    if (!coverage) continue
    const byFace = cornerLegsByFace(coverage, systems.get(element.id))
    for (const opening of element.openings) {
      const jambs = [opening.along - opening.width / 2, opening.along + opening.width / 2]
      // One finding per opening per face. An opening reaching into the units at
      // both ends of a short return is two distinct pieces of hardware to modify,
      // but a jamb inside one unit is one problem however many jambs are in it.
      for (const [face, legs] of byFace) {
        const hit = legs.find((leg) =>
          jambs.some(
            (jamb) =>
              jamb > leg.lo + LEG_OVERLAP_TOLERANCE_M && jamb < leg.hi - LEG_OVERLAP_TOLERANCE_M,
          ),
        )
        if (!hit) continue
        out.push(
          finding(
            'OPENING_INSIDE_CORNER_UNIT',
            'warning',
            [element.id, opening.id],
            `${element.id}: ${opening.kind} ${opening.id} spans ${jambs[0]?.toFixed(2)} to ${jambs[1]?.toFixed(2)} m, reaching into the face ${face} corner unit that runs from ${hit.lo.toFixed(2)} to ${hit.hi.toFixed(2)} m. A corner unit arrives framed, so the box-out has to be cut into the unit — a modification to plant, not a panel joint to move — or the corner built bespoke in timber.`,
            { alongM: opening.along },
          ),
        )
      }
    }
  }
  return out
}

/**
 * An expansion joint a single pour crosses.
 *
 * The two sides of an expansion joint are structurally independent, so concrete
 * continuous across one defeats the joint entirely. Two ways that happens, and
 * they fail in different places:
 *
 * A joint *within* an element is fed to `splitIntoSegments` as a hard cut, so the
 * split ought to have produced a boundary there. It can fail to: a cut within
 * `MIN_SEGMENT_LENGTH` of either end is dropped as degenerate, which is right for
 * the geometry and wrong for the joint — a movement joint 0.5 mm from a wall's end
 * is a joint somebody entered at the wrong position, and silently swallowing it
 * leaves a wall the drawing says is jointed and the pour plan says is not.
 *
 * A joint *between* two elements has no cut to make, and the pour plan cannot see
 * it at all: it is defeated by the two elements sharing a `pourId`, which says in
 * as many words that they are cast monolithically. Nothing in either element's own
 * data contradicts anything — the contradiction is between the joint and the pair.
 */
function expansionJointsBridged(
  elements: readonly CastableElement[],
  nodes: readonly AnyNode[],
  limits: PourLimits,
): Finding[] {
  const out: Finding[] = []
  const scoped = new Map(elements.map((element) => [element.id, element]))
  const joints = nodes.filter(
    (node): node is ConstructionJointNode =>
      node.type === 'construction-joint' &&
      (node.kind === 'expansion' || node.kind === 'isolation'),
  )

  for (const joint of joints) {
    const named = joint.elementIds.filter((id) => scoped.has(id as AnyNodeId))
    if (named.length === 0) continue

    if (joint.elementIds.length > 1) {
      const pours = new Set(
        joint.elementIds
          .map((id) => scoped.get(id as AnyNodeId)?.pourId)
          .filter((pourId): pourId is string => pourId !== undefined),
      )
      // One pour id across both sides, and both sides present: they are cast
      // together, which is exactly what the joint forbids.
      const sides = joint.elementIds.filter((id) => scoped.get(id as AnyNodeId)?.pourId)
      if (pours.size === 1 && sides.length > 1) {
        out.push(
          finding(
            'EXPANSION_JOINT_BRIDGED',
            'error',
            joint.elementIds.map((id) => id as AnyNodeId),
            `${joint.elementIds.join(' and ')} are separated by ${joint.kind === 'isolation' ? 'an isolation' : 'an expansion'} joint but share pour ${[...pours][0]}, so they are cast monolithically across it. Give the two sides different pour ids.`,
          ),
        )
      }
      continue
    }

    const element = scoped.get(named[0] as AnyNodeId)
    const along = joint.along
    if (!element || along === undefined) continue
    const units = pourUnitsForElement(element, limits, hardCutsForElement(element.id, [...nodes]))
    const bridging = units.find(
      (unit) => along > unit.startAlong + 1e-6 && along < unit.endAlong - 1e-6,
    )
    if (!bridging) continue
    out.push(
      finding(
        'EXPANSION_JOINT_BRIDGED',
        'error',
        [element.id],
        `${element.id}: a single pour runs from ${bridging.startAlong.toFixed(2)} m to ${bridging.endAlong.toFixed(2)} m, across the movement joint at ${along.toFixed(2)} m. Concrete continuous across an expansion joint defeats it — check the joint is not sitting on the element's end.`,
        {
          alongM: along,
          segmentIndex: bridging.segmentIndex,
          liftIndex: bridging.liftIndex,
        },
      ),
    )
  }
  return out
}

/**
 * A waterstop that does not close.
 *
 * The plan's phrasing is "every waterstop run is a CLOSED loop across pour
 * boundaries", and the failure is specific: water-retaining work is only
 * watertight if the waterstop is continuous, so a joint carrying one where the
 * abutting joint does not is a path straight through the structure. The element
 * is water-retaining and one of its joints is sealed while another is not —
 * which reads, in every quantity anyone bills, as a complete job.
 */
function waterstopRuns(elements: readonly CastableElement[], nodes: readonly AnyNode[]): Finding[] {
  const out: Finding[] = []
  const joints = nodes.filter(
    (node): node is ConstructionJointNode => node.type === 'construction-joint',
  )
  for (const element of elements) {
    if (element.exposureClass !== 'water-retaining') continue
    const mine = joints.filter((joint) => joint.elementIds.includes(element.id))
    if (mine.length === 0) continue
    // An injectable hose is the other way a joint is sealed against water, and a
    // run that changes method partway is still continuous. What is not continuous
    // is a joint with neither.
    const sealed = mine.filter((joint) =>
      joint.treatments.some(
        (treatment) => treatment.kind === 'waterstop' || treatment.kind === 'injectable-hose',
      ),
    )
    if (sealed.length === 0 || sealed.length === mine.length) continue
    const open = mine.filter((joint) => !sealed.includes(joint))
    out.push(
      finding(
        'WATERSTOP_RUN_NOT_CLOSED',
        'error',
        [element.id, ...open.map((joint) => joint.id as AnyNodeId)],
        `${element.id} is water-retaining and ${sealed.length} of its ${mine.length} joints carry a waterstop. A run that stops short is a path through the structure — ${open.map((joint) => joint.id).join(', ')} ${open.length === 1 ? 'has' : 'have'} none.`,
      ),
    )
  }
  return out
}

/** The stretch of one element a waterstop occupies, and which joint puts it there. */
interface WaterstopBand {
  joint: ConstructionJointNode
  /** `'along'` for a vertical bar at a pour break, `'elevation'` for a horizontal one. */
  axis: 'along' | 'elevation'
  /** The station, m, and the half-width a tie has to clear it by. */
  centreM: number
  halfWidthM: number
  type: WaterstopType | undefined
}

/**
 * Every waterstop in the scope, as the band of element it blocks.
 *
 * A joint with no station is not a band. `elementIds.length > 1` is an interface
 * between two elements, and the bar there sits at the plane where they meet rather
 * than at a station inside either one — the panels stop at that plane, so no drilled
 * hole is over it and there is nothing to compare. The bar that a tie can be drilled
 * through is the one *inside* an element, which is exactly the joint carrying
 * `along` or `elevation`.
 */
function waterstopBands(
  elementId: AnyNodeId,
  joints: readonly ConstructionJointNode[],
): WaterstopBand[] {
  const out: WaterstopBand[] = []
  for (const joint of joints) {
    if (!joint.elementIds.includes(elementId)) continue
    if (joint.elementIds.length > 1) continue
    for (const treatment of joint.treatments) {
      // Waterstops only, so an `injectable-hose` on the same joint is not a band: it
      // is a tube cast against the joint face and grouted after the pour, so the seal
      // is made later and by injection rather than by the bar being unbroken.
      if (treatment.kind !== 'waterstop') continue
      const width =
        treatment.width ??
        (treatment.waterstopType ? WATERSTOP_WIDTHS_M[treatment.waterstopType] : undefined) ??
        WATERSTOP_WIDTHS_M['pvc-central']
      const axis = joint.along !== undefined ? 'along' : 'elevation'
      const centreM = joint.along ?? joint.elevation
      if (centreM === undefined) continue
      out.push({
        joint,
        axis,
        centreM,
        halfWidthM: width / 2,
        type: treatment.waterstopType,
      })
    }
  }
  return out
}

/**
 * A drilled tie hole inside the width of a waterstop — phase 9's ties × waterstops
 * clash.
 *
 * A rod through the bar is a hole straight through the water seal, and the hole is
 * the one defect in this feature that passes every other check: the tie is inside
 * its capacity, the band it ties is tied, the run packs, and the waterstop run
 * closes — `WATERSTOP_RUN_NOT_CLOSED` asks whether every joint *carries* a bar and
 * cannot ask whether the bar it carries is intact. The wall is watertight on the
 * drawing and leaks at one tie.
 *
 * What makes it reachable rather than theoretical is which joints split a pour.
 * `hardCutsForElement` cuts on `expansion` and `isolation` only, because a
 * construction joint is a soft partition the solver may move. So a construction
 * joint carrying a waterstop is *not* a shutter boundary: the panel run crosses it,
 * and the drilled grid crosses it with the run. Nothing between the joint and the
 * frame's holes negotiates, and neither knows about the other.
 *
 * An error, not a warning, and this is the one place in the suite where a warning
 * would be wrong for a reason about the trade rather than the geometry. The other
 * clashes have a site answer somebody chooses — strut the box-out, notch the unit.
 * Here the fix is upstream of the shutter: the bar moves, the tie moves, or the tie
 * becomes a watertight one (a taper tie or a DK cone, plugged and patched, which the
 * catalog flags `watertight` and which costs three to five times a plain tie point).
 * Proceeding is not an exception somebody signs; it is a leak nobody sees until the
 * tank is filled.
 *
 * One finding per waterstop and not per hole. A vertical bar at a pour break is
 * crossed by every row of a drilled grid, and eight findings about one bar reads as
 * eight problems; the count is in the message and the locus is the joint.
 */
function tiesThroughWaterstops(
  elements: readonly CastableElement[],
  nodes: readonly AnyNode[],
  fields: ReadonlyMap<AnyNodeId, readonly TieField[]>,
): Finding[] {
  const out: Finding[] = []
  const joints = nodes.filter(
    (node): node is ConstructionJointNode => node.type === 'construction-joint',
  )
  for (const element of elements) {
    const bands = waterstopBands(element.id, joints)
    if (bands.length === 0) continue
    for (const band of bands) {
      const lo = band.centreM - band.halfWidthM
      const hi = band.centreM + band.halfWidthM
      const hit: Array<{ alongM: number; elevationM: number }> = []
      for (const field of fields.get(element.id) ?? []) {
        // No drilled grid: a conventional shutter is bored where the calculation
        // asks, and a carpenter setting out a wall with a waterstop in it bores
        // clear of the bar. There is no fixed station to fault.
        if (field.holes.length === 0) continue
        for (const hole of field.holes) {
          const station = band.axis === 'along' ? hole.alongM : hole.elevationM
          if (station <= lo || station >= hi) continue
          hit.push(hole)
        }
      }
      if (hit.length === 0) continue
      const nearest = hit.reduce(
        (best, hole) => {
          const station = (h: typeof hole) => (band.axis === 'along' ? h.alongM : h.elevationM)
          return Math.abs(station(hole) - band.centreM) < Math.abs(station(best) - band.centreM)
            ? hole
            : best
        },
        hit[0] as (typeof hit)[number],
      )
      const named = band.type === 'hydrophilic' ? 'hydrophilic strip' : 'PVC waterstop'
      const where =
        band.axis === 'along'
          ? `the pour break at ${band.centreM.toFixed(2)} m along`
          : `the lift joint at ${band.centreM.toFixed(2)} m`
      out.push(
        finding(
          'TIE_THROUGH_WATERSTOP',
          'error',
          [element.id, band.joint.id as AnyNodeId],
          `${element.id}: ${hit.length} drilled tie ${hit.length === 1 ? 'hole falls' : 'holes fall'} within the ${(band.halfWidthM * 2 * 1000).toFixed(0)} mm ${named} at ${where} — the nearest at ${nearest.alongM.toFixed(2)} m along, ${nearest.elevationM.toFixed(2)} m up. A rod through the bar is a hole through the water seal, and every other check passes: the tie is inside capacity and the run closes. Move the joint clear of the tie row, or tie this pour with a watertight assembly — a taper tie or a sealed cone, plugged and patched.`,
          band.axis === 'along'
            ? { alongM: band.centreM, elevationM: nearest.elevationM }
            : { alongM: nearest.alongM, elevationM: band.centreM },
        ),
      )
    }
  }
  return out
}

/**
 * A lift joint that did not reach a permitted elevation.
 *
 * `splitIntoLifts` snaps toward the undersides of slabs and beams and records
 * `snappedTo` when it succeeds. Where a project has stated permitted elevations
 * and a joint landed on none of them, the joint is somewhere the structure did
 * not offer — most often a strip too shallow above or below it to form or
 * vibrate. A warning rather than an error: it is buildable, and sometimes it is
 * what the engineer wanted.
 */
function liftJointElevations(elements: readonly CastableElement[], limits: PourLimits): Finding[] {
  const permitted = limits.permittedJointElevations ?? []
  if (permitted.length === 0) return []
  const out: Finding[] = []
  for (const element of elements) {
    for (const lift of splitIntoLifts(element, limits)) {
      if (!lift.hasJointBelow) continue
      if (lift.snappedTo !== undefined) continue
      const nearest = permitted.reduce(
        (best, candidate) =>
          Math.abs(candidate - lift.baseElevation) < Math.abs(best - lift.baseElevation)
            ? candidate
            : best,
        permitted[0] as number,
      )
      if (Math.abs(nearest - lift.baseElevation) <= JOINT_SNAP_REPORT_TOLERANCE) continue
      out.push(
        finding(
          'LIFT_JOINT_OFF_PERMITTED_ELEVATION',
          'warning',
          [element.id],
          `${element.id}: the lift joint at ${lift.baseElevation.toFixed(2)} m is not on a permitted elevation — the nearest is ${nearest.toFixed(2)} m, ${Math.abs(nearest - lift.baseElevation).toFixed(2)} m away, outside the snap tolerance. A joint short of a slab soffit leaves a strip too shallow to form.`,
          { elevationM: lift.baseElevation, liftIndex: lift.index },
        ),
      )
    }
  }
  return out
}

/**
 * A pour unit bigger than one delivery can place before the first of it sets.
 *
 * `maxPourVolume` drives the segment split, so a wall cannot fail this: the split
 * cuts its centreline until every bay is inside the cap. What can fail is
 * everything with no centreline to cut. `pourUnitsForElement` returns a slab as
 * one pour by construction — bay-splitting a polygon is a partition nobody has
 * written — and a column's volume comes from its plan area, which no length cut
 * reduces either. So a 400 m³ raft and a 3 m-diameter core both come back as a
 * single pour that no plant can deliver, and the split reports no cut because
 * there was none to make.
 *
 * That is precisely the case worth an error. The number is real, it is on the
 * takeoff, and nothing else in the feature says the pour cannot be placed in one
 * operation.
 */
function pourVolumes(
  units: readonly PourUnit[],
  elements: readonly CastableElement[],
  limits: PourLimits,
): Finding[] {
  const cap = limits.maxPourVolume
  if (cap === undefined || cap <= 0) return []
  const kindOf = new Map(elements.map((element) => [element.id, element.kind]))
  const out: Finding[] = []
  for (const unit of units) {
    const perElement = elements.find((element) => element.id === unit.elementId)?.maxPourVolume
    const governing = perElement !== undefined && perElement > 0 ? Math.min(cap, perElement) : cap
    if (unit.volumeCuM <= governing) continue
    const kind = kindOf.get(unit.elementId)
    out.push(
      finding(
        'POUR_VOLUME_OVER_SUPPLY',
        'error',
        [unit.elementId],
        kind === 'wall'
          ? `${unit.elementId} segment ${unit.segmentIndex + 1} lift ${unit.liftIndex + 1} is ${unit.volumeCuM.toFixed(1)} m³ against a ${governing.toFixed(1)} m³ limit, and the plan split did not cut it. The first concrete placed sets before the last, which is a cold joint where nobody planned one.`
          : `${unit.elementId} is one pour of ${unit.volumeCuM.toFixed(1)} m³ against a ${governing.toFixed(1)} m³ limit. A ${kind ?? 'element'} is not split into bays by this solver, so this has to be divided by hand — or the pour needs a supply rate nobody has confirmed.`,
        { segmentIndex: unit.segmentIndex, liftIndex: unit.liftIndex },
      ),
    )
  }
  return out
}

/**
 * A design outside the envelope its own code validates.
 *
 * Principle 7: validity gates are outputs. Every pressure standard has bounds —
 * ACI's slump and vibration depth, DIN's 10 m and 7 m/h, CIRIA's derived
 * coefficients — and a design past one is not wrong so much as unsupported: the
 * equation still returns a number and nothing about the number says it came from
 * outside the data. `pressureEnvelope` already collects these as warnings; the
 * gap this closes is that nothing was sweeping them at scope, so a warning on
 * one wall of forty was reported to whoever happened to open that wall's panel.
 */
function codeEnvelopes(envelopes: ReadonlyMap<AnyNodeId, PressureEnvelope>): Finding[] {
  const out: Finding[] = []
  for (const [elementId, envelope] of envelopes) {
    for (const warning of envelope.warnings) {
      out.push(
        finding(
          'DESIGN_OUTSIDE_CODE_ENVELOPE',
          'warning',
          [elementId],
          `${elementId}: ${warning.message} The pressure of ${envelope.maxKnM2.toFixed(1)} kN/m² comes from ${envelope.governingEquation}, outside the range ${envelope.standard} is validated over.`,
        ),
      )
    }
  }
  return out
}

/**
 * The assertions this scene cannot make, and what each one would need.
 *
 * Declared rather than omitted. A report that lists only what it checked reads as
 * a clean bill of health for everything it did not, and "no clashes found" from a
 * suite that never had rebar geometry is the most misleading sentence this
 * feature could print.
 */
function unavailable(
  hasPacks: boolean,
  hasEnvelopes: boolean,
  hasSystem: boolean,
  hasTieFields: boolean,
) {
  const out: ValidationReport['notChecked'] = [
    { invariant: 'TIES_THROUGH_REBAR', needs: 'rebar geometry — no reinforcement is modelled' },
    {
      invariant: 'GANG_WEIGHT_OVER_CRANE_CAPACITY',
      needs: 'gang assembly and a crane capacity curve — neither has a schema home',
    },
    {
      invariant: 'PROPS_ONTO_SLAB_BELOW',
      needs:
        'the slab below’s capacity at the prop position — falsework reactions are not checked against it',
    },
    {
      invariant: 'CURVE_RADIUS_BELOW_SYSTEM_MINIMUM',
      needs: 'a minimum radius per system — the catalogs carry no such field',
    },
    {
      invariant: 'SET_COUNT_SHORTAGE',
      needs:
        'a peak compared against the yard’s own rack — `sets.ts` counts the peak, and nothing yet asks whether the project owns it',
    },
  ]
  if (!hasPacks) {
    out.push({
      invariant: 'UNFORMABLE_STRIP',
      needs: 'the packed runs — pass `packs` from the same layout the panel shows',
    })
  }
  if (!hasEnvelopes) {
    out.push({
      invariant: 'DESIGN_OUTSIDE_CODE_ENVELOPE',
      needs: 'the design envelopes — pass `envelopes` from the same solve the report prints',
    })
  }
  if (!hasSystem) {
    out.push({
      invariant: 'WALL_OUTSIDE_TIE_RANGE',
      needs:
        'the catalog system each element is formed in — pass `systems` to check tie reach and corner fit',
    })
  }
  if (!hasTieFields) {
    out.push({
      invariant: 'OPENING_LEAVES_TIE_GAP',
      needs:
        'the stations a tie passes on each shutter — pass `tieFields` from the same layout that drew the ties',
    })
    out.push({
      invariant: 'TIE_THROUGH_WATERSTOP',
      needs:
        'the same drilled stations — a waterstop with no tie grid over it is a bar nothing has been compared to',
    })
  }
  return out
}

/**
 * Validate a scope.
 *
 * Takes nodes rather than a solved project because the checks divide into two
 * kinds and only one of them can read a solution: the geometric and sequential
 * invariants are functions of the scene, while the layout and pressure ones are
 * functions of a solve that happens a layer up. Rather than re-solve here — which
 * would let the report and the panel disagree about the thing being reported —
 * the caller passes what it already has, and anything absent is declared in
 * `notChecked` instead of silently skipped.
 */
export function validateFormwork(
  nodes: readonly AnyNode[],
  options: ValidateOptions = {},
): ValidationReport {
  const all = collectCastableElements([...nodes])
  const byId = new Map(nodes.map((node) => [node.id as AnyNodeId, node]))
  const named = options.elementIds ? new Set(options.elementIds) : undefined
  const scoped = all.filter(
    (element) =>
      (named === undefined || named.has(element.id)) &&
      (options.parentId === undefined || byId.get(element.id)?.parentId === options.parentId),
  )

  const limits = options.limits ?? {}
  const packs = options.packs ?? new Map<AnyNodeId, readonly StripPack[]>()
  const envelopes = options.envelopes ?? new Map<AnyNodeId, PressureEnvelope>()
  const systems = options.systems ?? new Map<AnyNodeId, FormworkSystem>()
  const tieFields = options.tieFields ?? new Map<AnyNodeId, readonly TieField[]>()

  // Neighbours are the whole level, not the scope: an element outside a selection
  // still buries the face of one inside it, and a junction check that only saw
  // the selection would report a free end where a column stands.
  const abutments = findAbutments(all)
  const coverages = new Map<AnyNodeId, ElementCoverage>()
  const units: PourUnit[] = []
  for (const element of scoped) {
    coverages.set(element.id, classifyElementFaces(element, abutments, { neighbours: all }))
    units.push(...pourUnitsForElement(element, limits, hardCutsForElement(element.id, [...nodes])))
  }

  const findings: Finding[] = [
    ...castOrderCycles(scoped, abutments),
    ...singleSidedAnchors(scoped, abutments),
    ...areaConsistency(coverages),
    ...openingsAcrossLiftJoints(scoped, limits),
    ...expansionJointsBridged(scoped, nodes, limits),
    ...waterstopRuns(scoped, nodes),
    ...tiesThroughWaterstops(scoped, nodes, tieFields),
    ...liftJointElevations(scoped, limits),
    ...pourVolumes(units, scoped, limits),
    ...layoutFindings(packs),
    ...architecturalSymmetry(scoped, packs),
    ...codeEnvelopes(envelopes),
    ...tieReach(scoped, systems),
    ...tiesAroundOpenings(scoped, tieFields),
    ...junctionFit(scoped, systems),
    ...cornerUnitOverlaps(scoped, coverages, systems),
    ...openingsInsideCornerUnits(scoped, coverages, systems),
  ]

  // Errors first, then by element, so the list reads in the order somebody would
  // act on it rather than in the order the checks happen to run.
  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1
    const aid = a.elementIds[0] ?? ''
    const bid = b.elementIds[0] ?? ''
    if (aid !== bid) return aid < bid ? -1 : 1
    return a.invariant < b.invariant ? -1 : a.invariant > b.invariant ? 1 : 0
  })

  return {
    findings,
    errorCount: findings.filter((entry) => entry.severity === 'error').length,
    warningCount: findings.filter((entry) => entry.severity === 'warning').length,
    elementIds: scoped.map((element) => element.id).sort(),
    notChecked: unavailable(
      packs.size > 0,
      envelopes.size > 0,
      systems.size > 0,
      tieFields.size > 0,
    ),
  }
}

/**
 * The report as the sentences a panel, a file and the AI all print.
 *
 * Shared for the same reason `projectFormworkCaveats` is: three phrasings of one
 * fault is how a user comes to believe two of them are different problems.
 */
export function validationSummary(report: ValidationReport): string[] {
  if (report.elementIds.length === 0) return ['Nothing in this scope to check.']
  if (report.findings.length === 0) {
    return [
      `${report.elementIds.length} ${report.elementIds.length === 1 ? 'element' : 'elements'} checked, nothing found. ${report.notChecked.length} ${report.notChecked.length === 1 ? 'assertion' : 'assertions'} could not run — clashes against rebar and crane checks are not among what was verified.`,
    ]
  }
  const parts: string[] = []
  if (report.errorCount > 0) {
    parts.push(
      `${report.errorCount} ${report.errorCount === 1 ? 'thing' : 'things'} here cannot be built as specified.`,
    )
  }
  if (report.warningCount > 0) {
    parts.push(
      `${report.warningCount} ${report.warningCount === 1 ? 'needs' : 'need'} an exception somebody has to accept.`,
    )
  }
  return [...parts, ...report.findings.map((entry) => entry.message)]
}

/** Every element `report` found an error against — what a panel would select. */
export function failingElementIds(report: ValidationReport): AnyNodeId[] {
  const out = new Set<AnyNodeId>()
  for (const entry of report.findings) {
    if (entry.severity !== 'error') continue
    for (const id of entry.elementIds) out.add(id)
  }
  return [...out].sort()
}
