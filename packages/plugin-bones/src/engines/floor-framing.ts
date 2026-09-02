/**
 * Floor framing engine — pure function: SlabSlices (+ the level's walls) +
 * FramingSpec → the platform that carries the floor:
 *
 *   joists at o.c. spacing spanning the SHORT direction, depth from the span
 *   table (IRC R502.3.1-flavored) · rim joists on every perimeter edge · a
 *   FLUSH girder + posts when the table runs out, interrupted joists hung on
 *   hangers · stairwell holes framed with doubled headers + doubled trimmer
 *   joists · sistered joists under parallel bearing walls · mid-span
 *   blocking · LOD 400 bearing validation.
 *
 * Geometry: joist rows are clipped to the slab polygon with an even-odd
 * scanline, then further split at the girder line and hole extents. The
 * platform hangs UNDER the slab walking surface: member tops at
 * (slab.elevation − slab.thickness).
 */

import { LUMBER_CROSS_SECTIONS, type LumberSize } from '../lumber'
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { Member, SlabSlice, WallSlice } from '../core/types'
import { feet, inches } from '../core/units'

const EPS = 1e-9
/** Ignore clipped joist segments shorter than this — unbuildable slivers. */
const MIN_SEGMENT = inches(6)
const POST_SPACING = feet(8)
/** Walls at least this long are treated as bearing (// ASSUMPTION). */
const BEARING_WALL_MIN = 1.5
/** R502.6: joists need >= 1.5in of bearing on wood. */
const BEARING_TOLERANCE = inches(1.5)

type Pt = readonly [number, number]

/** Axis-aligned bounds of a polygon. */
function bounds(polygon: readonly Pt[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ }
}

/** Even-odd ray-cast point-in-polygon (ray toward +X). */
function pointInPoly(p: Pt, polygon: readonly Pt[]): boolean {
  const [px, pz] = p
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i] ?? [0, 0]
    const [xj, zj] = polygon[j] ?? [0, 0]
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/**
 * Even-odd scanline: intersect the line {across = c} with the polygon and
 * return sorted [start, end] spans along the run axis. `axis` names the RUN
 * axis of the joist: 'x' means the joist runs along X and c is a Z value.
 */
export function polygonSpans(
  polygon: readonly Pt[],
  axis: 'x' | 'z',
  c: number,
): [number, number][] {
  const crossings: number[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Pt
    const b = polygon[(i + 1) % polygon.length] as Pt
    const [runA, crossA] = axis === 'x' ? [a[0], a[1]] : [a[1], a[0]]
    const [runB, crossB] = axis === 'x' ? [b[0], b[1]] : [b[1], b[0]]
    const dCross = crossB - crossA
    if (Math.abs(dCross) < EPS) continue
    const t = (c - crossA) / dCross
    if (t >= 0 && t < 1) crossings.push(runA + t * (runB - runA))
  }
  crossings.sort((p, q) => p - q)
  const spans: [number, number][] = []
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const s = crossings[i] as number
    const e = crossings[i + 1] as number
    if (e - s > MIN_SEGMENT) spans.push([s, e])
  }
  return spans
}

/** First size whose table span carries `span`; null when the table runs out. */
export function joistSizeFor(span: number, spec: FramingSpec): LumberSize | null {
  for (const size of spec.joistSizes) {
    const allowable = spec.joistSpans[size]
    if (allowable !== undefined && span <= allowable + EPS) return size
  }
  return null
}

/** Subtract an interval from a list of spans. Exported for the foundation
 * engine's slab-field strips (B17) — one carve implementation repo-wide. */
export function subtractInterval(spans: [number, number][], cut: [number, number]): [number, number][] {
  const out: [number, number][] = []
  for (const [s, e] of spans) {
    if (cut[1] <= s + EPS || cut[0] >= e - EPS) {
      out.push([s, e])
      continue
    }
    if (cut[0] > s + MIN_SEGMENT) out.push([s, cut[0]])
    if (cut[1] < e - MIN_SEGMENT) out.push([cut[1], e])
  }
  return out
}

/** Intersect two interval lists (two-sided girder presence; also the
 * foundation slab field's edge-sampled strips — B17). */
export function intersectIntervals(
  a: [number, number][],
  b: [number, number][],
): [number, number][] {
  const out: [number, number][] = []
  for (const [s1, e1] of a) {
    for (const [s2, e2] of b) {
      const s = Math.max(s1, s2)
      const e = Math.min(e1, e2)
      if (e - s > MIN_SEGMENT) out.push([s, e])
    }
  }
  return out
}

type HoleFrame = {
  /** Hole extent along the run axis (headers sit just outside this). */
  run: [number, number]
  /** Hole extent along the cross axis (trimmers sit just outside this). */
  cross: [number, number]
}

/** Frame one slab. */
function frameSlab(
  slab: SlabSlice,
  walls: WallSlice[],
  spec: FramingSpec,
  storeyBelowHeight: number,
): Member[] {
  const members: Member[] = []
  const polygon = slab.polygon
  if (polygon.length < 3) return members
  const box = bounds(polygon)
  const spanX = box.maxX - box.minX
  const spanZ = box.maxZ - box.minZ
  if (spanX < MIN_SEGMENT || spanZ < MIN_SEGMENT) return members

  // Joists SPAN the short direction; laid out along the long one.
  const runAxis: 'x' | 'z' = spanX <= spanZ ? 'x' : 'z'
  const clearSpan = Math.min(spanX, spanZ)
  const layoutLength = Math.max(spanX, spanZ)
  const layoutStart = runAxis === 'x' ? box.minZ : box.minX
  const runStart = runAxis === 'x' ? box.minX : box.minZ

  // Size from the span table; N girder lines split the span when it runs
  // out (round-9: a 12x12 slab got ONE girder and 62 over-span flags — it
  // needs however many lines make the table fit).
  let size = joistSizeFor(clearSpan, spec)
  let girderCount = 0
  while (!size && girderCount < 3) {
    girderCount += 1
    size = joistSizeFor(clearSpan / (girderCount + 1), spec)
  }
  if (!size) size = spec.joistSizes[spec.joistSizes.length - 1] ?? '2x12'
  const needsGirder = girderCount > 0
  const [t, depth] = LUMBER_CROSS_SECTIONS[size]
  const topY = slab.elevation - slab.thickness
  const centerY = topY - depth / 2

  const runYaw = runAxis === 'x' ? 0 : -Math.PI / 2
  const crossYaw = runAxis === 'x' ? -Math.PI / 2 : 0
  const placeRun = (runCenter: number, cross: number, y = centerY): [number, number, number] =>
    runAxis === 'x' ? [runCenter, y, cross] : [cross, y, runCenter]

  const emit = (
    role: Member['role'],
    memberSize: LumberSize | undefined,
    dims: [number, number, number],
    position: [number, number, number],
    yaw: number,
    length: number,
    material: Member['material'],
    label?: string,
    flag?: string,
    advisory?: string,
  ) => {
    members.push({
      system: 'floor-framing',
      role,
      size: memberSize,
      dims,
      length,
      position,
      rotation: [0, yaw, 0],
      material,
      sourceId: slab.id,
      label,
      flag,
      advisory,
    })
  }

  // ---- girder lines (flush) ----
  const [gt, gd] = LUMBER_CROSS_SECTIONS['4x10']

  // ---- stairwell holes → framing extents ----
  // ASSUMPTION: holes are treated by their bounding box (stair openings are
  // rectangular in practice). // LOD 400+: arbitrary hole outlines.
  const holeFrames: HoleFrame[] = []
  for (const hole of slab.holes) {
    if (hole.length < 3) continue
    const hb = bounds(hole as Pt[])
    // Degenerate holes (zero-area lines/points) framed 4 phantom headers —
    // a hole must be at least a sliver in BOTH directions (round-8).
    if (hb.maxX - hb.minX < MIN_SEGMENT || hb.maxZ - hb.minZ < MIN_SEGMENT) continue
    holeFrames.push({
      run: runAxis === 'x' ? [hb.minX, hb.maxX] : [hb.minZ, hb.maxZ],
      cross: runAxis === 'x' ? [hb.minZ, hb.maxZ] : [hb.minX, hb.maxX],
    })
  }

  // ---- girder PRESENCE (round-6): where along the cross axis the girder
  // actually exists — its polygon spans minus any hole straddling its line.
  // Every consumer (rows, sisters, trimmers, validator) asks presence FIRST,
  // so nothing is ever cut back to a girder face where no girder runs (the
  // round-6 L-shape counterexample: wing rows floated 44.5mm off the notch
  // rim, hung on an absent girder).
  type Girder = { cross: number; cut: [number, number]; presence: [number, number][] }
  const girders: Girder[] = []
  const crossAxis = runAxis === 'x' ? 'z' : 'x'
  for (let i = 1; i <= girderCount; i++) {
    const cross = runStart + (clearSpan * i) / (girderCount + 1)
    // Sample a hair to EACH side of the line and intersect: a girder only
    // exists where slab lies on BOTH sides (its joists hang on both faces).
    // Winding-invariant by construction — round-7 reversed the polygon
    // winding and flipped an even-odd scan collinear with a notch edge;
    // interior samples cannot be collinear.
    let presence = intersectIntervals(
      polygonSpans(polygon, crossAxis, cross - gt),
      polygonSpans(polygon, crossAxis, cross + gt),
    )
      // ends pocket at the rim's inner face, like every joist (round-9 gate:
      // the girder ran through the inset rim band)
      .map(([ps, pe]) => [ps + t, pe - t] as [number, number])
      .filter(([ps, pe]) => pe - ps > MIN_SEGMENT)
    for (const hole of holeFrames) {
      // Straddling OR touching within a header ply pack (2t) — and the
      // carve removes the FULL header band (hole.cross ± 2t), not just the
      // hole, so header bearing extensions never embed inside the 4x10
      // body (round-9: 76mm interpenetration at both header ends).
      if (hole.run[0] < cross + gt / 2 + 2 * t && hole.run[1] > cross - gt / 2 - 2 * t) {
        presence = subtractInterval(presence, [hole.cross[0] - 2 * t, hole.cross[1] + 2 * t])
      }
    }
    girders.push({ cross, cut: [cross - gt / 2, cross + gt / 2], presence })
  }
  const girderAt = (g: Girder, c: number): boolean =>
    g.presence.some(([gs, ge]) => c >= gs - EPS && c <= ge + EPS)

  // ---- joist rows ----
  const rows: number[] = []
  for (let c = layoutStart + t / 2; c <= layoutStart + layoutLength - t / 2 + EPS; c += spec.joistSpacing) {
    rows.push(c)
  }
  const lastRow = layoutStart + layoutLength - t / 2
  if ((rows[rows.length - 1] ?? Number.NEGATIVE_INFINITY) < lastRow - t) rows.push(lastRow)
  // Edge rows shift inward one rim thickness — the rim occupies the edge
  // itself; the edge joist butts its inner face (round-9 gate: they were
  // coincident, interpenetrating boxes).
  if (rows.length > 0) {
    rows[0] = Math.max(rows[0] as number, layoutStart + t + t / 2)
    rows[rows.length - 1] = Math.min(
      rows[rows.length - 1] as number,
      layoutStart + layoutLength - t - t / 2,
    )
  }

  /** Joists END at the rim's inner face — polygon-derived span ends pull
   * in one rim thickness (round-9 gate: joist ends interpenetrated the
   * inset rims). Interior cut faces (girder/header) are NOT inset. */
  const insetSpans = (spansIn: [number, number][]): [number, number][] =>
    spansIn
      .map(([ss, se]) => [ss + t, se - t] as [number, number])
      .filter(([ss, se]) => se - ss > MIN_SEGMENT)

  const emitJoist = (s: number, e: number, cross: number, label?: string) => {
    const len = e - s
    if (len < MIN_SEGMENT) return
    emit('joist', size, [len, depth, t], placeRun((s + e) / 2, cross), runYaw, len, 'lumber', label)
  }

  /** Trimmer cross-lines already emitted — sisters must not coincide. */
  const sisterLines: number[] = []
  const trimmerLines = new Set<number>()

  const emitHanger = (runPos: number, cross: number, host: string) => {
    emit(
      'hanger',
      undefined,
      runAxis === 'x' ? [inches(0.75), depth, inches(3)] : [inches(3), depth, inches(0.75)],
      placeRun(runPos, cross),
      0,
      inches(3),
      'steel',
      `Joist hanger (LUS) @ ${host}`,
    )
  }

  /** Split one row's spans at holes (its cross band) then at the girder —
   * ONLY where the girder is actually present — hanging every real cut.
   * Shared by common rows, sisters, and stair trimmers so all three agree
   * (round-6: trimmers used to pass straight through the girder body, and
   * hole-band rows hung orphan girder hangers before the hole removed
   * their joists). `splitHoles` is off for trimmers — they run continuous
   * past their opening; that is their job. */
  const splitRow = (
    c: number,
    spansIn: [number, number][],
    ownHole: HoleFrame | null,
    band = t / 2,
  ): [number, number][] => {
    let spans = spansIn
    // Collect every cut face first; hangers are decided ONLY on the FINAL
    // pieces (round-7: a hole hanger emitted mid-pipeline was orphaned when
    // the girder cut re-shortened its piece 5mm later).
    const faces: { u: number; host: string }[] = []
    for (const hole of holeFrames) {
      // A trimmer runs continuous past ITS OWN opening (that is its job)
      // but must still split at every OTHER hole (round-7: hole A's far
      // trimmers ran straight across hole B).
      if (hole === ownHole) continue
      if (c > hole.cross[0] - band && c < hole.cross[1] + band) {
        // Tail joists end at the header PACK's outer face (2 plies past the
        // hole edge) — cut at the hole line they interpenetrated both plies
        // by 76mm and fed wrong lengths to the cut list (round-9).
        const packCut: [number, number] = [hole.run[0] - 2 * t, hole.run[1] + 2 * t]
        spans = subtractInterval(spans, packCut)
        faces.push({ u: packCut[0], host: 'stair header' }, { u: packCut[1], host: 'stair header' })
      }
    }
    for (const girder of girders) {
      if (!girderAt(girder, c)) continue
      spans = subtractInterval(spans, girder.cut)
      faces.push({ u: girder.cut[0], host: 'girder' }, { u: girder.cut[1], host: 'girder' })
    }
    // A surviving piece end sitting on a cut face hangs there — one-sided
    // cuts included, dropped slivers can never leave an orphan.
    const hung = new Set<string>()
    for (const [ss, se] of spans) {
      for (const face of faces) {
        for (const end of [ss, se]) {
          if (Math.abs(end - face.u) < 1e-6) {
            const key = `${face.u.toFixed(6)}|${c.toFixed(6)}`
            if (!hung.has(key)) {
              hung.add(key)
              emitHanger(face.u, c, face.host)
            }
          }
        }
      }
    }
    return spans
  }

  // 3/4" T&G subfloor deck (LOD-400 audit B3 — the takeoff booked 33
  // sheets while ZERO deck geometry existed; pure S4 booked-but-absent).
  // One strip per joist row, bay-wide, clipped by the SAME hole/polygon
  // machinery the joists use (stair holes carve automatically), running
  // edge-to-edge over the rims. Rendered ghosted so the joist grid stays
  // readable in the X-ray; the takeoff derives its sheet count from these
  // members now.
  const DECK_T = inches(0.75)
  const deckY = topY + DECK_T / 2
  // Strips tile between ROW MIDPOINTS (edge rows shift inward, so a fixed
  // ±half-bay width overlapped neighbours wherever rows sit closer than
  // the o.c. spacing).
  const deckBounds = (i: number): [number, number] => {
    const c = rows[i] as number
    const lo = i === 0 ? layoutStart : ((rows[i - 1] as number) + c) / 2
    const hi =
      i === rows.length - 1 ? layoutStart + layoutLength : (c + (rows[i + 1] as number)) / 2
    return [lo, hi]
  }
  const emitDeck = (s: number, e: number, lo: number, hi: number) => {
    const width = hi - lo
    const len = e - s
    if (len < MIN_SEGMENT || width < MIN_SEGMENT) return
    const dims: [number, number, number] =
      runAxis === 'x' ? [len, DECK_T, width] : [width, DECK_T, len]
    emit(
      'subfloor',
      undefined,
      dims,
      placeRun((s + e) / 2, (lo + hi) / 2, deckY),
      0,
      len,
      'engineered',
      'Subfloor 3/4" T&G — glued + ring-shank fastened (R503.2.3)',
    )
  }

  // The spans each row ACTUALLY frames (emitJoist's own MIN_SEGMENT
  // predicate) — the blocking loop below needs joist-face truth, not
  // polygon containment.
  const rowJoistSpans: [number, number][][] = []
  for (let ri = 0; ri < rows.length; ri++) {
    const c = rows[ri] as number
    const spans = splitRow(c, insetSpans(polygonSpans(polygon, runAxis, c)), null)
    rowJoistSpans.push(spans.filter(([s, e]) => !(e - s < MIN_SEGMENT)))
    for (const [s, e] of spans) emitJoist(s, e, c)
    if (spec.detail !== '200') {
      // NOT splitRow — that emits hangers as a side effect (duplicate
      // hardware at identical coordinates when called twice per row). The
      // deck only needs the polygon spans minus the HOLE itself (it runs
      // OVER girders and headers; a strip partially straddling the hole's
      // cross band is carved conservatively — slight under-book, never a
      // clash with the stair framing).
      const [lo, hi] = deckBounds(ri)
      // Sample at BOTH strip edges as well as the row line — centerline-only
      // sampling let strips overhang L-shape notch voids by the half-bay
      // (verify night-6: 6.7cm overhang over a 2m notch run).
      let deckSpans = intersectIntervals(
        intersectIntervals(
          polygonSpans(polygon, runAxis, c),
          polygonSpans(polygon, runAxis, Math.min(lo + 0.001, c)),
        ),
        polygonSpans(polygon, runAxis, Math.max(hi - 0.001, c)),
      )
      for (const hole of holeFrames) {
        if (hi > hole.cross[0] - EPS && lo < hole.cross[1] + EPS) {
          deckSpans = subtractInterval(deckSpans, [hole.run[0], hole.run[1]])
        }
      }
      for (const [s, e] of deckSpans) emitDeck(s, e, lo, hi)
    }
  }

  // ---- stairwell headers (doubled) + trimmer joists (doubled) ----
  // Standard stair-opening framing (R502.10): doubled headers across the
  // joist direction at both ends of the hole, carried by doubled trimmer
  // joists running alongside the opening.
  if (spec.detail !== '200') {
    for (const hole of holeFrames) {
      // Header spans BETWEEN the trimmer packs, end-nailed through them —
      // extending over them interpenetrated the plies (round-9 gate).
      const headerLen = hole.cross[1] - hole.cross[0]
      const headerCenterCross = (hole.cross[0] + hole.cross[1]) / 2
      for (const runEnd of [hole.run[0], hole.run[1]]) {
        for (const ply of [0, 1]) {
          const offset = (runEnd === hole.run[0] ? -1 : 1) * (t / 2 + ply * t)
          // Plies must land inside the SLAB POLYGON — the round-5 bbox
          // clamp let an L-shape push a ply into the notch (round-6).
          const plyRun = runEnd + offset
          if (plyRun < runStart + t / 2 - EPS || plyRun > runStart + clearSpan - t / 2 + EPS) {
            continue
          }
          const plyPoint: Pt =
            runAxis === 'x' ? [plyRun, headerCenterCross] : [headerCenterCross, plyRun]
          if (!pointInPoly(plyPoint, polygon)) continue
          emit(
            'header',
            size,
            [headerLen, depth, t],
            placeRun(runEnd + offset, headerCenterCross),
            crossYaw,
            headerLen,
            'lumber',
            'Stair header (doubled, R502.10)',
          )
        }
      }
      for (const crossSide of [hole.cross[0], hole.cross[1]]) {
        for (const ply of [0, 1]) {
          const offset = (crossSide === hole.cross[0] ? -1 : 1) * (t / 2 + ply * t)
          const cc = crossSide + offset
          // Adjacent holes would emit coincident or interpenetrating plies —
          // one trimmer per stud-thickness of line (round-7: 24mm pitch
          // plies of 38mm stock overlapped).
          if ([...trimmerLines].some((v) => Math.abs(v - cc) < t - 1e-9)) continue
          trimmerLines.add(cc)
          for (const [s, e] of splitRow(cc, insetSpans(polygonSpans(polygon, runAxis, cc)), hole)) {
            emitJoist(s, e, cc, 'Stair trimmer (doubled)')
          }
        }
      }
    }
  }

  // ---- sistered joists under parallel bearing walls ----
  // ASSUMPTION: interior walls >= 1.5m running parallel (±10°) to the joists
  // are bearing — real designs check the load path; we sister under all.
  // Each sister EXTENDS past the wall to the nearest bearing on both sides
  // (polygon edge, girder face, or stair header) — a sister clipped to the
  // wall run would end unsupported mid-span, which the LOD-400 checker
  // below rightly flags (round-2 counterexample).
  if (spec.detail !== '200') {
    const runDir: Pt = runAxis === 'x' ? [1, 0] : [0, 1]
    for (const wall of walls) {
      if (wall.length < BEARING_WALL_MIN) continue
      const dot = Math.abs(wall.dir[0] * runDir[0] + wall.dir[1] * runDir[1])
      if (dot < Math.cos((10 * Math.PI) / 180)) continue
      const wallCross =
        runAxis === 'x' ? (wall.start[1] + wall.end[1]) / 2 : (wall.start[0] + wall.end[0]) / 2
      const wallRun: [number, number] = [
        Math.min(
          runAxis === 'x' ? wall.start[0] : wall.start[1],
          runAxis === 'x' ? wall.end[0] : wall.end[1],
        ),
        Math.max(
          runAxis === 'x' ? wall.start[0] : wall.start[1],
          runAxis === 'x' ? wall.end[0] : wall.end[1],
        ),
      ]
      const sisterCross = wallCross + t // one thickness beside the wall line
      // A bearing wall hugging a stairwell lands its sister on the trimmer
      // pack — which IS already the doubling the wall needs. Emitting one
      // anyway interpenetrated a ply (round-8); the trimmers carry it.
      if ([...trimmerLines].some((v) => Math.abs(v - sisterCross) < t - 1e-9)) continue
      // Same for the COMMON GRID (round-14): a sister landing within one
      // thickness of an existing row IS that row's doubling — nudge to the
      // row's far face instead of interpenetrating it.
      const clashRow = rows.find((r) => Math.abs(r - sisterCross) < t - 1e-9)
      const sisterAt = clashRow === undefined ? sisterCross : clashRow + t
      if (rows.some((r) => Math.abs(r - sisterAt) < t - 1e-9)) continue
      sisterLines.push(sisterAt)
      for (const [rawS, rawE] of polygonSpans(polygon, runAxis, sisterAt)) {
        const s = rawS + t // rim inner face (round-9)
        const e = rawE - t
        if (e - s < MIN_SEGMENT) continue
        if (wallRun[1] < s + EPS || wallRun[0] > e - EPS) continue // wall outside this span
        // Bearing coordinates available along this row. A stair hole's
        // headers only exist inside the hole's CROSS band — a hole elsewhere
        // in the slab is no bearing for this sister (round-3 counterexample:
        // a sister clipped to a distant hole's run coordinate hung mid-air).
        const supports = [s, e]
        for (const girder of girders) {
          if (girderAt(girder, sisterAt)) supports.push(girder.cut[0], girder.cut[1])
        }
        for (const hole of holeFrames) {
          if (sisterAt > hole.cross[0] - t && sisterAt < hole.cross[1] + t) {
            supports.push(hole.run[0], hole.run[1])
          }
        }
        const starts = supports.filter((u) => u <= wallRun[0] + EPS)
        const ends = supports.filter((u) => u >= wallRun[1] - EPS)
        const cs = starts.length > 0 ? Math.max(...starts) : s
        const ce = ends.length > 0 ? Math.min(...ends) : e
        // Split at holes then at the girder via the SAME pipeline every
        // other row uses (round-4 counterexample: an unsplit sister bridged
        // the stairwell). Band ±t matches the support band — sisters ride
        // walls with modeling slop (round-5's 19 mm hangerless window).
        const sisterSpans = splitRow(sisterAt, [[cs, ce]], null, t)
        for (const [ss, se] of sisterSpans) {
          if (se - ss > MIN_SEGMENT) {
            emitJoist(ss, se, sisterAt, `Sistered joist under bearing wall ${wall.id}`)
          }
        }
      }
    }
  }

  // ---- rim joists around the perimeter ----
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Pt
    const b = polygon[(i + 1) % polygon.length] as Pt
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < MIN_SEGMENT) continue
    const yaw = Math.atan2(-dz, dx)
    // Rims sit INSIDE the slab, outer face flush with the edge — centered on
    // the edge line they poked t/2 past the deck (round-8 world-AABB gate).
    // Inward is winding-agnostic: test which normal offset lands inside.
    // Each rim starts one thickness past its first vertex so consecutive
    // rims BUTT at corners instead of overlapping t×t (round-9 gate).
    const ux = dx / len
    const uz = dz / len
    const rimLen = len - t
    if (rimLen < MIN_SEGMENT) continue
    const mid: Pt = [a[0] + ux * (t + rimLen / 2), a[1] + uz * (t + rimLen / 2)]
    const nx = -uz
    const nz = ux
    const inward = pointInPoly([mid[0] + (nx * t) / 2, mid[1] + (nz * t) / 2], polygon) ? 1 : -1
    emit(
      'rim-joist',
      size,
      [rimLen, depth, t],
      [mid[0] + (inward * nx * t) / 2, centerY, mid[1] + (inward * nz * t) / 2],
      yaw,
      rimLen,
      'lumber',
      `Rim joist ${size}`,
    )
  }

  // ---- flush girders + posts ----
  for (const girder of girders) {
    // Presence already carved the full header band out of each hole zone
    // (round-9); hang the cut ends that face a stair opening on the
    // trimmers at the carved faces.
    for (const hole of holeFrames) {
      if (hole.run[0] < girder.cross + gt / 2 + 2 * t && hole.run[1] > girder.cross - gt / 2 - 2 * t) {
        const carve: [number, number] = [hole.cross[0] - 2 * t, hole.cross[1] + 2 * t]
        for (const [s, e] of girder.presence) {
          if (Math.abs(e - carve[0]) < EPS * 10 && e - s > MIN_SEGMENT) {
            emitHanger(girder.cross, carve[0], 'stair trimmers (girder)')
          }
          if (Math.abs(s - carve[1]) < EPS * 10 && e - s > MIN_SEGMENT) {
            emitHanger(girder.cross, carve[1], 'stair trimmers (girder)')
          }
        }
      }
    }
    for (const [s, e] of girder.presence) {
      const len = e - s
      // FLUSH: girder top aligns with joist tops; interrupted joists hang on
      // its faces (hangers emitted with the rows above).
      const girderCenterY = topY - gd / 2
      emit(
        'girder',
        '4x10',
        [len, gd, gt],
        placeRun(girder.cross, (s + e) / 2, girderCenterY),
        crossYaw,
        len,
        'engineered',
        'Girder 4x10 (flush, joists hung)',
        undefined,
        'Girder sized schematically — verify with span/load design',
      )
      const [pt, pw] = LUMBER_CROSS_SECTIONS['4x4']
      // The post spans girder UNDERSIDE → the storey below's floor plane
      // (level-local −storeyBelowHeight), where it bears on the ground
      // storey's pad footing (B18d) or the framed floor below. The old
      // fixed storeyBelowHeight length overshot by the girder depth —
      // the post tail punched ~0.23 m through the bearing plane.
      const postTop = topY - gd
      const postHeight = Math.max(0.1, postTop + storeyBelowHeight)
      for (let p = s + POST_SPACING / 2; p < e; p += POST_SPACING) {
        emit(
          'post',
          '4x4',
          [pt, postHeight, pw],
          placeRun(girder.cross, p, postTop - postHeight / 2),
          0,
          postHeight,
          'lumber',
          'Post 4x4 (to storey below)',
        )
      }
    }
  }

  // ---- one row of mid-span blocking between adjacent joist rows ----
  // With a girder, the mid-span line IS the girder line — blocking there
  // would sit embedded inside the 4x10 body (round-6 finding); the girder
  // itself provides the lateral restraint blocking exists for.
  if (!needsGirder) {
    const mid = runStart + clearSpan / 2
    for (let i = 0; i + 1 < rows.length; i++) {
      // Each block fills ITS bay — the clear span between the two adjacent
      // joist faces. A constant nominal-bay length overran the narrower
      // first/last and sistered bays into joists, rims and neighboring
      // blocks (round-11).
      const bayLen = (rows[i + 1] as number) - (rows[i] as number) - t
      if (bayLen < inches(3)) continue
      // A sistered joist OR a stair trimmer ply intruding into this bay
      // occupies the blocking line — skip the bay (round-14: full-bay
      // blocks impaled the sisters; ship-gate round 2: same impale on
      // trimmer plies). The block fills cross [rows[i]+t/2, rows[i+1]−t/2]
      // and a ply at `l` spans l ± t/2, so they overlap iff the ply CENTER
      // is strictly between the row lines — a ply 1mm outside the old
      // ±t/2-shrunk window still poked 18mm into the block.
      const occupiesBay = (line: number): boolean =>
        line > (rows[i] as number) + EPS && line < (rows[i + 1] as number) - EPS
      if (sisterLines.some(occupiesBay) || [...trimmerLines].some(occupiesBay)) continue
      const cross = ((rows[i] as number) + (rows[i + 1] as number)) / 2
      // A bay is only real where OPPOSING JOIST FACES exist. Polygon
      // containment was a proxy and failed twice at the ship gate: near a
      // wedge tip the polygon still contains `mid` while the space there
      // is entirely rim joist (blocking × rim SAT overlap), and a needle
      // sliver whose every joist span fell under MIN_SEGMENT emitted
      // blocks bearing on AIR. The recorded per-row spans are exactly
      // what emitJoist framed — and the FULL block (t thick, mid ± t/2)
      // must sit inside the span: the centerline-only test left a ≤t/2
      // rim-poke window when a cross edge landed just past mid (ship-gate
      // round 2, 5 SAT pairs on an L-notch at mid + t + 8mm).
      const coveredBy = (ri: number): boolean =>
        (rowJoistSpans[ri] ?? []).some(
          ([s, e]) => mid - t / 2 > s + EPS && mid + t / 2 < e - EPS,
        )
      if (!coveredBy(i) || !coveredBy(i + 1)) continue
      // Skip blocking that would land inside a stairwell hole — tested
      // against the BLOCK'S full extent, not the bay center (ship-gate
      // round 2: an off-center narrow hole between rows kept its block).
      const inHole = holeFrames.some(
        (h) =>
          (rows[i + 1] as number) - t / 2 > h.cross[0] &&
          (rows[i] as number) + t / 2 < h.cross[1] &&
          mid + t / 2 > h.run[0] &&
          mid - t / 2 < h.run[1],
      )
      if (inHole) continue
      emit(
        'blocking',
        size,
        [bayLen, depth, t],
        placeRun(mid, cross),
        runYaw + Math.PI / 2,
        bayLen,
        'lumber',
        'Blocking',
      )
    }
  }

  // ---- LOD 400: bearing validation ----
  if (spec.detail === '400') {
    const bearings: BearingLine[] = []
    for (const girder of girders) {
      for (const [gs, ge] of girder.presence) {
        // A girder only bears where it EXISTS (round-6: wing rows cut at an
        // absent girder passed silently with extent-less bearing lines).
        bearings.push(
          { u: girder.cut[0], cross: [gs, ge] },
          { u: girder.cut[1], cross: [gs, ge] },
        )
      }
    }
    for (const hole of holeFrames) {
      // Tails end at the header PACK's outer faces (round-9) — that is
      // where the bearing (hanger on the outer ply) actually is.
      bearings.push(
        { u: hole.run[0] - 2 * t, cross: hole.cross },
        { u: hole.run[1] + 2 * t, cross: hole.cross },
      )
    }
    validateJoistBearing(members, polygon, runAxis, bearings, holeFrames)
    // Safety net: no joist-family member may exceed its size's table span —
    // catches any regression that silently drops a girder/header sliver and
    // leaves full-width lumber sized for half the span (round-7 advisory:
    // twin straddling holes produced 6m trimmers of half-span stock).
    const allowable = spec.joistSpans[size]
    if (allowable !== undefined) {
      for (const m of members) {
        if (m.role !== 'joist' || m.flag) continue
        if (m.dims[0] > allowable + inches(1)) {
          m.flag = `Span ${m.dims[0].toFixed(2)}m exceeds the ${size} table span — needs a girder/header (R502.3.1)`
        }
      }
    }
  }

  return members
}

/**
 * A bearing line along the run axis. Stair-header bearings only exist
 * inside the hole's cross band (`cross`); girder faces bear everywhere.
 */
export type BearingLine = { u: number; cross?: readonly [number, number] }

/**
 * LOD 400 bearing checker (R502.6): every joist end must land on a bearing
 * structure — a polygon edge (rim), a girder face, or a stair-header face
 * WITHIN the hole's cross band — within 1.5" tolerance; anything else gets
 * flagged. Exported so the flag path itself stays testable with an injected
 * bad joist (a checker whose only test asserts silence is no checker at all
 * — round-2 finding; the cross-band condition is the round-3 finding).
 */
export function validateJoistBearing(
  members: Member[],
  polygon: readonly (readonly [number, number])[],
  runAxis: 'x' | 'z',
  bearings: BearingLine[],
  holes: { run: readonly [number, number]; cross: readonly [number, number] }[] = [],
): void {
  for (const m of members) {
    if (m.role !== 'joist') continue
    const half = m.dims[0] / 2
    const center = runAxis === 'x' ? (m.position[0] as number) : (m.position[2] as number)
    const cross = runAxis === 'x' ? (m.position[2] as number) : (m.position[0] as number)
    for (const end of [center - half, center + half]) {
      // Joist ends bear at the rim inner face — one rim thickness inside
      // the polygon line (round-9), so the tolerance covers t + seat.
      const onPolygon = polygonSpans(polygon, runAxis, cross).some(
        ([s, e]) =>
          Math.abs(end - s) < BEARING_TOLERANCE * 2 + inches(0.1) ||
          Math.abs(end - e) < BEARING_TOLERANCE * 2 + inches(0.1),
      )
      const onStructure = bearings.some(
        (b) =>
          Math.abs(end - b.u) < BEARING_TOLERANCE + inches(0.1) &&
          (b.cross === undefined ||
            (cross > b.cross[0] - BEARING_TOLERANCE && cross < b.cross[1] + BEARING_TOLERANCE)),
      )
      if (!onPolygon && !onStructure) {
        m.flag = `Unsupported joist end @ ${end.toFixed(2)}m — needs bearing (R502.6)`
      }
    }
    // A joist BODY may never intrude into a floor opening — well-supported
    // ends do not excuse spanning (or poking into) the stairwell. Round-4
    // pinned the full-crossing case; round-5 showed a PARTIAL overlap (one
    // end at a header face, body over the opening) slipped through — the
    // check is now intrusion-based, tolerating only the 1.5" bearing seat.
    for (const hole of holes) {
      const inBand = cross > hole.cross[0] + BEARING_TOLERANCE && cross < hole.cross[1] - BEARING_TOLERANCE
      const intrusion =
        Math.min(center + half, hole.run[1] - BEARING_TOLERANCE) -
        Math.max(center - half, hole.run[0] + BEARING_TOLERANCE)
      if (inBand && intrusion > inches(0.5)) {
        m.flag = `Joist crosses a floor opening @ ${hole.run[0].toFixed(2)}–${hole.run[1].toFixed(2)}m — split and hang on headers (R502.10)`
      }
    }
  }

  // Girders run PERPENDICULAR to the joists — same opening rule, axes
  // swapped: the girder's line must not pass through a hole's run extent
  // while its body overlaps the hole's cross extent (round-5 blocker).
  // Round-9 adds END bearing: each girder end must land on the polygon
  // boundary (a bearing wall/rim pocket) or on a stair-trimmer carve face.
  for (const m of members) {
    if (m.role !== 'girder') continue
    const half = m.length / 2
    const center = runAxis === 'x' ? (m.position[2] as number) : (m.position[0] as number)
    const line = runAxis === 'x' ? (m.position[0] as number) : (m.position[2] as number)
    for (const hole of holes) {
      const lineInHole = line > hole.run[0] + BEARING_TOLERANCE && line < hole.run[1] - BEARING_TOLERANCE
      const intrusion =
        Math.min(center + half, hole.cross[1] - BEARING_TOLERANCE) -
        Math.max(center - half, hole.cross[0] + BEARING_TOLERANCE)
      if (lineInHole && intrusion > inches(0.5)) {
        m.flag = `Girder crosses a floor opening @ ${hole.cross[0].toFixed(2)}–${hole.cross[1].toFixed(2)}m — interrupt at the stair framing (R502.10)`
      }
    }
    const crossAxis = runAxis === 'x' ? 'z' : 'x'
    // Mirror the generator's TWO-SIDED presence sampling (round-7): the run
    // ends where spans at line±gt intersect, so on a notched rim the end
    // matches a boundary of one of the SAMPLED spans, not necessarily of
    // the span at the exact centerline.
    const [gtv] = LUMBER_CROSS_SECTIONS['4x10']
    const sampled = [
      polygonSpans(polygon, crossAxis, line - gtv),
      polygonSpans(polygon, crossAxis, line),
      polygonSpans(polygon, crossAxis, line + gtv),
    ]
    for (const end of [center - half, center + half]) {
      // A girder end bears either ON the boundary line or POCKETED at the
      // rim's inner face — one 2x thickness inside it (the run is inset so
      // the rim band stays continuous).
      const rimT = inches(1.5)
      const near = (a: number, b: number) => Math.abs(a - b) < BEARING_TOLERANCE
      const onPolygon = sampled.some((spans) =>
        spans.some(
          ([s, e]) =>
            near(end, s) || near(end, e) || near(end, s + rimT) || near(end, e - rimT),
        ),
      )
      const onCarve = holes.some(
        (hole) =>
          Math.abs(end - (hole.cross[0] - 2 * BEARING_TOLERANCE)) < BEARING_TOLERANCE ||
          Math.abs(end - (hole.cross[1] + 2 * BEARING_TOLERANCE)) < BEARING_TOLERANCE,
      )
      if (!onPolygon && !onCarve && !m.flag) {
        m.flag = `Unsupported girder end @ ${end.toFixed(2)}m — needs a pocket, post, or hanger (R502.6)`
      }
    }
  }
}

/**
 * Frame every slab on a level. `walls` sister joists under parallel bearing
 * partitions; `storeyBelowHeight` sizes the girder posts.
 */
/** Dominant edge direction of a polygon (angle of its longest edge). */
function dominantAngle(polygon: SlabSlice['polygon']): number {
  let best = 0
  let bestLen = -1
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as readonly [number, number]
    const b = polygon[(i + 1) % polygon.length] as readonly [number, number]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len > bestLen) {
      bestLen = len
      best = Math.atan2(dz, dx)
    }
  }
  return best
}

const rotPt = (p: readonly [number, number], c: readonly [number, number], ang: number): [number, number] => {
  const cos = Math.cos(ang)
  const sin = Math.sin(ang)
  const dx = p[0] - c[0]
  const dz = p[1] - c[1]
  return [c[0] + dx * cos - dz * sin, c[1] + dx * sin + dz * cos]
}

export function frameFloor(
  slabs: SlabSlice[],
  walls: WallSlice[] = [],
  spec: FramingSpec = DEFAULT_SPEC,
  storeyBelowHeight = 2.4,
): Member[] {
  const members: Member[] = []
  for (const slab of slabs) {
    // Rotated slabs (round-14): the layout math is axis-aligned by design —
    // rotate the slab (and walls) into its own frame, frame it there, and
    // rotate the members back. World yaw = local yaw + slab angle.
    const theta = dominantAngle(slab.polygon)
    const snapped = Math.round(theta / (Math.PI / 2)) * (Math.PI / 2)
    const off = theta - snapped
    if (Math.abs(off) < 1e-4) {
      members.push(...frameSlab(slab, walls, spec, storeyBelowHeight))
      continue
    }
    const c: readonly [number, number] = [slab.polygon[0]?.[0] ?? 0, slab.polygon[0]?.[1] ?? 0]
    const localSlab: SlabSlice = {
      ...slab,
      polygon: slab.polygon.map((p) => rotPt(p, c, -off)),
      holes: slab.holes.map((h) => h.map((p) => rotPt(p, c, -off))),
    }
    const localWalls: WallSlice[] = walls.map((w) => {
      const start = rotPt(w.start, c, -off)
      const end = rotPt(w.end, c, -off)
      const dx = end[0] - start[0]
      const dz = end[1] - start[1]
      const len = Math.max(1e-9, Math.hypot(dx, dz))
      return { ...w, start, end, dir: [dx / len, dz / len] as const }
    })
    for (const m of frameSlab(localSlab, localWalls, spec, storeyBelowHeight)) {
      const [x, y, z] = m.position
      const [wx, wz] = rotPt([x, z], c, off)
      members.push({
        ...m,
        position: [wx, y, wz],
        rotation: [m.rotation[0], m.rotation[1] - off, m.rotation[2]],
      })
    }
  }
  return members
}
