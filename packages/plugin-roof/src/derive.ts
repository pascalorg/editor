/**
 * Derive the roof from the exterior walls — PlanCrafters' roof policy on
 * Pascal's roof segments.
 *
 * PlanCrafters (roof.js, gen.js, ROOF-POLICY-SPEC, ROOF-CONTINUATION-SPEC):
 * the exterior wall loop is the roof's truth; the roof bears on the plates;
 * gable ends follow the style's vocabulary (farmhouse gables everything,
 * craftsman gables the main ends and the street-facing wing caps, ranch and
 * modern hip, cottage gables the main and hips the wings); a footprint that
 * POPS toward the street goes hip everywhere because gables straddling a
 * pop-out junction never resolve; a shed's high side faces AWAY from the
 * street; a coverage gate catches the catastrophic roll and falls back to
 * hip-everything. Here the loop becomes rectangular masses (the largest is
 * the main, the rest wings), each mass a plate-seated segment, each wing run
 * into its neighbour so its planes die in the neighbour's slope (the valley
 * Bones frames), and every exterior wall is told the role it carries.
 */
import {
  type Bounds,
  boundsOf,
  coverageOf,
  decomposeRectilinear,
  dirToFrame,
  dist,
  dot,
  type Frame,
  frameFor,
  fromFrame,
  isRectilinear,
  type Loop,
  mergeCollinear,
  outwardNormal,
  popSide,
  type Pt,
  rectArea,
  toFrame,
  traceExteriorLoop,
  unit,
  type WallInput,
} from './geometry'

export type RoofForm = 'gable' | 'hip' | 'shed' | 'flat'

/** What an exterior wall carries under the derived roof. */
export type WallRoofRole = 'eave' | 'gable-end' | 'hip-end' | 'shed-high' | 'rake' | 'flat'

export type RoofIntent = {
  form: RoofForm
  /** Rise in twelfths. */
  pitchTwelfths: number
  /** Eave overhang in PLAN from the wall centre line, metres (PlanCrafters' `roof.overhang`). */
  overhang: number
  /** Style key — the gable vocabulary. Absent = the form applies to every mass. */
  style?: string
  /**
   * Explicit gable ends as level-local outward normals (a plan document's
   * `roof.gables`). They pick the ridge axis and override the vocabulary.
   */
  gables?: readonly Pt[]
  /** Unit vector toward the street, level-local. Default −Z (a generated house's front). */
  frontDir?: Pt
}

export type AutoRoofSegment = {
  name: string
  roofType: RoofForm
  /** Level-local; y is the plate. */
  position: [number, number, number]
  rotation: number
  width: number
  depth: number
  /** Degrees. */
  pitch: number
  /** Along the slope, metres (the node's convention). */
  overhang: number
  /** Only a shed mass inboard of the governing low eave carries one. */
  wallHeight: number
  wallThickness: number
}

export type AutoRoofResult = {
  ok: boolean
  segments: AutoRoofSegment[]
  roles: Record<string, WallRoofRole>
  warnings: string[]
  /** Fraction of the footprint under a segment. */
  coverage: number
  masses: number
  /** True when the footprint pops toward the street (ROOF-POLICY-SPEC A) and the vocabulary was overridden to hip. */
  popped: boolean
}

/** A pop-out this deep or less that spans most of an end wall rides under the main roof (continuation). */
const CONTINUATION_MAX_DEPTH = 2.44 // 8 ft
const CONTINUATION_MIN_SPAN = 0.6
/** A projection toward the street past this is POPPED massing (24"). */
const POPPED_DEPTH = 0.61
/** Below this share of the footprint under a roof the roll is catastrophic and hips everything. */
const COVERAGE_FLOOR = 0.98

type Mass = {
  rect: Bounds
  /** Rect extended into the neighbouring mass so the planes meet (the roof footprint). */
  roof: Bounds
  /** 'a' when the ridge runs along the frame's u axis. */
  ridge: 'a' | 'b'
  roofType: RoofForm
  /** Frame-space outward normals of the two ridge ends that are gables (for the roles). */
  gableEnds: Pt[]
  name: string
}

const axisNormal = (ridge: 'a' | 'b', sign: 1 | -1): Pt => (ridge === 'a' ? [sign, 0] : [0, sign])

export function deriveRoof(walls: WallInput[], plateY: number, intent: RoofIntent): AutoRoofResult {
  const warnings: string[] = []
  const frontDir: Pt = intent.frontDir ?? [0, -1]
  const thickness = Math.max(...walls.filter((w) => w.frontSide === 'exterior' || w.backSide === 'exterior').map((w) => w.thickness), 0.1)

  // ── the loop, in the building's own frame ──────────────────────────────
  let loop = traceExteriorLoop(walls)
  if (!loop) {
    warnings.push('exterior walls do not close one loop — roof derived over the walls’ bounding box; verify')
    loop = bboxLoop(walls)
    if (!loop) return { ok: false, segments: [], roles: {}, warnings: ['no walls to roof'], coverage: 0, masses: 0, popped: false }
  }
  loop = mergeCollinear(loop)
  const frame = frameFor(loop)
  let polyF = loop.pts.map((p) => toFrame(frame, p))
  if (!isRectilinear(polyF)) {
    warnings.push('footprint is not rectilinear — one roof over its bounding box; verify the roof plan')
    const bb = boundsOf(polyF)
    polyF = [
      [bb.a0, bb.b0],
      [bb.a1, bb.b0],
      [bb.a1, bb.b1],
      [bb.a0, bb.b1],
    ]
  }
  const frontF = unit(dirToFrame(frame, frontDir))
  const pitchRad = Math.atan(intent.pitchTwelfths / 12)
  const pitchDeg = Math.round(((pitchRad * 180) / Math.PI) * 1000) / 1000
  const slopeOverhang = intent.overhang / Math.cos(pitchRad)

  // ── masses ────────────────────────────────────────────────────────────
  let rects = decomposeRectilinear(polyF)
  if (rects.length === 0) {
    warnings.push('roof decomposition found no mass — one roof over the bounding box')
    rects = [boundsOf(polyF)]
  }
  // explicit gable normals (a plan document) fix the ridge axis; otherwise the
  // MAIN MASS's long axis (not the whole footprint's box — an L's leg must not
  // turn the main ridge)
  const explicit = (intent.gables ?? []).map((g) => unit(dirToFrame(frame, g)))
  const main0 = rects[0] as Bounds
  const mainRidge: 'a' | 'b' =
    explicit.length > 0
      ? Math.abs(explicit[0]?.[0] ?? 0) > 0.7
        ? 'a'
        : 'b'
      : main0.a1 - main0.a0 >= main0.b1 - main0.b0
        ? 'a'
        : 'b'
  rects = absorbShallowEndPopouts(rects, mainRidge)

  const popped = intent.form !== 'shed' && intent.form !== 'flat' && popSide(polyF, frontF) > POPPED_DEPTH
  const masses = planMasses(rects, mainRidge, intent, explicit, frontF, popped)
  if (popped && masses.some((m) => m.roofType === 'hip') && intent.form === 'gable') {
    warnings.push('footprint pops toward the street — hip roof everywhere (a gable across the pop-out never resolves)')
  }

  // ── coverage gate ─────────────────────────────────────────────────────
  let coverage = coverageOf(polyF, masses.map((m) => m.roof))
  let finalMasses = masses
  if (coverage < COVERAGE_FLOOR) {
    warnings.push(`roof covered ${Math.round(coverage * 100)}% of the footprint — fell back to one hip over the bounding box; verify`)
    finalMasses = planMasses([boundsOf(polyF)], mainRidge, { ...intent, form: intent.form === 'shed' || intent.form === 'flat' ? intent.form : 'hip' }, [], frontF, false)
    coverage = coverageOf(polyF, finalMasses.map((m) => m.roof))
  }

  // ── segments ──────────────────────────────────────────────────────────
  const segments: AutoRoofSegment[] = []
  const lowEdge = shedLowEdge(finalMasses, frontF)
  for (const m of finalMasses) {
    const r = m.roof
    const centreF: Pt = [(r.a0 + r.a1) / 2, (r.b0 + r.b1) / 2]
    const centre = fromFrame(frame, centreF)
    const alongA = r.a1 - r.a0
    const alongB = r.b1 - r.b0
    if (m.roofType === 'shed') {
      // slope falls toward the segment's +Z: +Z must point toward the street
      const low = dot([(r.a0 + r.a1) / 2, (r.b0 + r.b1) / 2], lowEdge.dir) - (lowEdge.dir[0] !== 0 ? alongA : alongB) / 2
      const hiAxisIsA = Math.abs(lowEdge.dir[0]) > 0.5
      const streetDir: Pt = [-lowEdge.hiDir[0], -lowEdge.hiDir[1]]
      const street = fromFrameDir(frame, streetDir)
      segments.push({
        name: m.name,
        roofType: 'shed',
        position: [centre[0], plateY, centre[1]],
        rotation: Math.atan2(street[0], street[1]),
        width: hiAxisIsA ? alongB : alongA,
        depth: hiAxisIsA ? alongA : alongB,
        pitch: pitchDeg,
        overhang: slopeOverhang,
        wallHeight: Math.max(0, (low - lowEdge.low) * Math.tan(pitchRad)),
        wallThickness: thickness,
      })
      continue
    }
    const ridgeDir: Pt = m.ridge === 'a' ? frame.u : frame.v
    segments.push({
      name: m.name,
      roofType: m.roofType,
      position: [centre[0], plateY, centre[1]],
      rotation: Math.atan2(-ridgeDir[1], ridgeDir[0]),
      width: m.ridge === 'a' ? alongA : alongB,
      depth: m.ridge === 'a' ? alongB : alongA,
      pitch: m.roofType === 'flat' ? 0 : pitchDeg,
      overhang: m.roofType === 'flat' ? intent.overhang : slopeOverhang,
      wallHeight: 0,
      wallThickness: thickness,
    })
  }

  return {
    ok: true,
    segments,
    roles: wallRoles(loop, frame, polyF, finalMasses, lowEdge, intent.form),
    warnings,
    coverage,
    masses: finalMasses.length,
    popped,
  }
}

const fromFrameDir = (f: Frame, d: Pt): Pt => [d[0] * f.u[0] + d[1] * f.v[0], d[0] * f.u[1] + d[1] * f.v[1]]

function bboxLoop(walls: WallInput[]): Loop | null {
  const pts = walls.flatMap((w) => [w.start, w.end])
  if (pts.length === 0) return null
  const bb = boundsOf(pts)
  const corners: Pt[] = [
    [bb.a0, bb.b0],
    [bb.a1, bb.b0],
    [bb.a1, bb.b1],
    [bb.a0, bb.b1],
  ]
  return {
    pts: corners,
    edges: corners.map((c, i) => ({ a: c, b: corners[(i + 1) % 4] as Pt, wallIds: [] })),
  }
}

/**
 * ROOF-CONTINUATION-SPEC: a shallow rectangular bump on a gable END that spans
 * most of that end rides under the main roof — the ridge continues over it —
 * instead of getting a toy roof of its own. The main rect grows over the bump.
 */
function absorbShallowEndPopouts(rects: Bounds[], ridge: 'a' | 'b'): Bounds[] {
  if (rects.length < 2) return rects
  const main = { ...(rects[0] as Bounds) }
  const keep: Bounds[] = []
  for (const r of rects.slice(1)) {
    const along = (x: Bounds) => (ridge === 'a' ? [x.a0, x.a1] : [x.b0, x.b1])
    const across = (x: Bounds) => (ridge === 'a' ? [x.b0, x.b1] : [x.a0, x.a1])
    const [m0, m1] = along(main) as [number, number]
    const [c0, c1] = across(main) as [number, number]
    const [r0, r1] = along(r) as [number, number]
    const [s0, s1] = across(r) as [number, number]
    const depth = r1 - r0
    const span = Math.min(s1, c1) - Math.max(s0, c0)
    const atEnd = Math.abs(r0 - m1) < 0.01 || Math.abs(r1 - m0) < 0.01
    const insideAcross = s0 >= c0 - 0.01 && s1 <= c1 + 0.01
    if (atEnd && insideAcross && depth <= CONTINUATION_MAX_DEPTH && span >= CONTINUATION_MIN_SPAN * (c1 - c0)) {
      if (ridge === 'a') {
        main.a0 = Math.min(main.a0, r.a0)
        main.a1 = Math.max(main.a1, r.a1)
      } else {
        main.b0 = Math.min(main.b0, r.b0)
        main.b1 = Math.max(main.b1, r.b1)
      }
      continue
    }
    keep.push(r)
  }
  return [main, ...keep]
}

/** The gable vocabulary per style, PlanCrafters gen.js `assignRoofGables`. */
function gableVocabulary(style: string | undefined, isMain: boolean, capFacesStreet: boolean): boolean {
  const s = (style ?? '').toLowerCase()
  if (s.includes('farmhouse')) return true
  if (s.includes('craftsman')) return isMain || capFacesStreet
  if (s.includes('cottage')) return isMain
  if (s.includes('ranch') || s.includes('modern')) return false
  return true
}

function planMasses(rects: Bounds[], mainRidge: 'a' | 'b', intent: RoofIntent, explicit: readonly Pt[], frontF: Pt, popped: boolean): Mass[] {
  const main = rects[0] as Bounds
  const masses: Mass[] = rects.map((rect, i) => {
    const isMain = i === 0
    const longAxis: 'a' | 'b' = rect.a1 - rect.a0 >= rect.b1 - rect.b0 ? 'a' : 'b'
    // A wing's ridge runs OUT from the wall it shares with its neighbour so
    // its planes die in the neighbour's slope (PlanCrafters' skeleton gives
    // exactly this: the wing's two side eaves make the ridge, whatever the
    // wing's proportions). A free-standing mass takes its long axis.
    const shared = isMain
      ? null
      : ([axisNormal('a', 1), axisNormal('a', -1), axisNormal('b', 1), axisNormal('b', -1)] as Pt[]).find((n) =>
          rects.some((o, j) => j !== i && touchesAcross(rect, o, n)),
        )
    const ridge: 'a' | 'b' = isMain ? mainRidge : shared ? (shared[0] !== 0 ? 'a' : 'b') : longAxis
    let roofType: RoofForm = intent.form
    const gableEnds: Pt[] = []
    if (intent.form === 'gable' || intent.form === 'hip') {
      const ends: Pt[] = [axisNormal(ridge, 1), axisNormal(ridge, -1)]
      // which ridge ends are free caps (not buried in a neighbour)
      const outerCap = (n: Pt): boolean => !rects.some((o, j) => j !== i && touchesAcross(rect, o, n))
      const capFacesStreet = ends.some((n) => outerCap(n) && dot(n, frontF) > 0.7)
      let gable: boolean
      if (explicit.length > 0) gable = ends.some((n) => explicit.some((g) => dot(g, n) > 0.7))
      else if (popped) gable = false
      else gable = intent.form === 'gable' && gableVocabulary(intent.style, isMain, capFacesStreet)
      roofType = gable ? 'gable' : 'hip'
      if (gable) for (const n of ends) if (outerCap(n) || isMain) gableEnds.push(n)
    }
    return { rect, roof: { ...rect }, ridge, roofType, gableEnds, name: isMain ? 'Main roof' : `Wing ${i} roof` }
  })
  // run each wing into its neighbour so its planes die in the neighbour's slope
  for (let i = 1; i < masses.length; i++) {
    const m = masses[i] as Mass
    const run = (m.ridge === 'a' ? m.rect.b1 - m.rect.b0 : m.rect.a1 - m.rect.a0) / 2
    for (const n of [axisNormal(m.ridge, 1), axisNormal(m.ridge, -1)]) {
      const neighbour = rects.find((o, j) => j !== i && touchesAcross(m.rect, o, n))
      if (!neighbour) continue
      const reach = Math.min(run, (n[0] !== 0 ? neighbour.a1 - neighbour.a0 : neighbour.b1 - neighbour.b0) - 0.01)
      if (n[0] > 0) m.roof.a1 += reach
      else if (n[0] < 0) m.roof.a0 -= reach
      else if (n[1] > 0) m.roof.b1 += reach
      else m.roof.b0 -= reach
    }
  }
  void main
  return masses
}

/** `other` shares the edge of `rect` whose outward normal is `n` (over a real span). */
function touchesAcross(rect: Bounds, other: Bounds, n: Pt): boolean {
  const tol = 0.01
  if (n[0] !== 0) {
    const edge = n[0] > 0 ? rect.a1 : rect.a0
    const otherEdge = n[0] > 0 ? other.a0 : other.a1
    if (Math.abs(edge - otherEdge) > tol) return false
    return Math.min(rect.b1, other.b1) - Math.max(rect.b0, other.b0) > 0.1
  }
  const edge = n[1] > 0 ? rect.b1 : rect.b0
  const otherEdge = n[1] > 0 ? other.b0 : other.b1
  if (Math.abs(edge - otherEdge) > tol) return false
  return Math.min(rect.a1, other.a1) - Math.max(rect.a0, other.a0) > 0.1
}

type ShedLowEdge = { hiDir: Pt; dir: Pt; low: number }

/**
 * PlanCrafters `buildShed`: the plane rises AWAY from the street (the back
 * of the lot is the high side), snapped to the frame axis nearest that
 * direction; the governing low eave is the footprint's lowest extent along
 * the rise, and every mass's own low edge measures its knee wall from there.
 */
function shedLowEdge(masses: Mass[], frontF: Pt): ShedLowEdge {
  const hiDir: Pt = Math.abs(frontF[0]) >= Math.abs(frontF[1]) ? [-Math.sign(frontF[0]) || -1, 0] : [0, -Math.sign(frontF[1]) || -1]
  let low = Number.POSITIVE_INFINITY
  for (const m of masses) {
    const corners: Pt[] = [
      [m.roof.a0, m.roof.b0],
      [m.roof.a1, m.roof.b1],
    ]
    for (const c of corners) low = Math.min(low, dot(c, hiDir))
  }
  return { hiDir, dir: hiDir, low }
}

function wallRoles(loop: Loop, frame: Frame, polyF: readonly Pt[], masses: Mass[], shed: ShedLowEdge, form: RoofForm): Record<string, WallRoofRole> {
  const roles: Record<string, WallRoofRole> = {}
  for (let i = 0; i < loop.edges.length; i++) {
    const e = loop.edges[i] as { a: Pt; b: Pt; wallIds: string[] }
    const a = toFrame(frame, e.a)
    const b = toFrame(frame, e.b)
    const n = outwardNormal(polyF, Math.min(i, polyF.length - 1))
    let role: WallRoofRole = form === 'flat' ? 'flat' : 'eave'
    if (form === 'shed') {
      const d = dot(n, shed.hiDir)
      role = d > 0.7 ? 'shed-high' : d < -0.7 ? 'eave' : 'rake'
    } else if (form !== 'flat') {
      // the mass whose rect edge this wall lies on decides
      for (const m of masses) {
        const onA = Math.abs(a[0] - b[0]) < 0.01
        const line = onA ? a[0] : a[1]
        const edgeCoord = onA ? (n[0] > 0 ? m.rect.a1 : m.rect.a0) : n[1] > 0 ? m.rect.b1 : m.rect.b0
        if (Math.abs(line - edgeCoord) > 0.02) continue
        const lo = Math.min(onA ? a[1] : a[0], onA ? b[1] : b[0])
        const hi = Math.max(onA ? a[1] : a[0], onA ? b[1] : b[0])
        const mlo = onA ? m.rect.b0 : m.rect.a0
        const mhi = onA ? m.rect.b1 : m.rect.a1
        if (Math.min(hi, mhi) - Math.max(lo, mlo) < 0.1) continue
        const alongRidge = (m.ridge === 'a' && !onA) || (m.ridge === 'b' && onA)
        if (alongRidge) role = 'eave'
        else role = m.roofType === 'gable' && m.gableEnds.some((g) => dot(g, n) > 0.7) ? 'gable-end' : 'hip-end'
        break
      }
    }
    for (const id of e.wallIds) roles[id] = role
  }
  return roles
}

export { dist, rectArea }
