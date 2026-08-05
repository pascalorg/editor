import type { WallDesign } from '@pascal-app/core/formwork'
import type { WallNode } from '@pascal-app/core/schema'
import { BoxGeometry, Group, Mesh, type MeshStandardMaterial } from 'three'
import { wallPourDesign } from './design'
import {
  type CornerRun,
  cornerPartName,
  cornerRuns,
  type FacePlan,
  type FaceRun,
  type FormworkScope,
  KICKER_M,
  PANEL_GAP,
  PANEL_THICKNESS,
  type PlannedPiece,
  planFace,
  SCAFFOLD_BAY,
  SCAFFOLD_BRACE_SIZE,
  SCAFFOLD_LEDGER_SIZE,
  SCAFFOLD_LIFT,
  SCAFFOLD_POST_SIZE,
  SCAFFOLD_STANDOFF,
  scaffoldMaterial,
  TIE_SIZE,
  tieMaterial,
  WALER_DEPTH,
  WALER_HEIGHT,
  walerMaterial,
} from './geometry-shared'
import type { FormworkAssemblyNode } from './schema'

/**
 * Wall shutter: panels + walers on BOTH faces (poured concrete pushes on both
 * sides), through-ties clamping the two faces together, box-outs returned
 * inside every opening, bulkheads at the formed ends, and — when
 * `scaffoldRequired` — working scaffold standing off each face, so the assembly
 * matches an actual site erection rather than a decorative front skin.
 *
 * The spacings are not chosen here. `wallDesign` solves the lateral chain —
 * pressure → sheathing → studs → walers → ties — and this places what it returns,
 * as the slab builder places `falseworkDesign` and the column builder
 * `clampSchedule`. That the chain is ordered is the point: the waler centres *are*
 * the studs' allowable span and the tie centres are the walers', so a builder
 * picking its own spacings would draw members checked against a load none of them
 * carries. It also means the grid tightens with the pour rate and the lift height
 * on its own, which a pair of constants cannot do.
 *
 * The tie *rows* come from the design and are graded — wider where there is less
 * head — but on a catalogued panel system the tie *stations* do not: the frames
 * leave the factory drilled, and a rod passes only where a hole on one skin meets a
 * hole on the other. There the design is what the drilled grid is checked against
 * rather than what places it, which is why both paths exist below.
 *
 * Built in the local space `[0, wallLength]` along X that `WallRenderer` and
 * `WallSystem` already establish — see `attach.ts`. No transform applied here.
 */

type Side = 'front' | 'back'
const SIDES: Array<{
  side: Side
  sign: 1 | -1
  role: 'side-a' | 'side-b'
  face: 'a' | 'b'
}> = [
  { side: 'front', sign: 1, role: 'side-a', face: 'a' },
  { side: 'back', sign: -1, role: 'side-b', face: 'b' },
]

/** Vertical post + horizontal ledgers + one diagonal brace per bay, standing off from `faceZ` along +/-Z by `sign`. */
function buildScaffoldSide(
  group: Group,
  side: Side,
  sign: 1 | -1,
  spanStart: number,
  spanEnd: number,
  baseY: number,
  topY: number,
  scaffoldZ: number,
): void {
  const spanLength = spanEnd - spanStart
  const height = topY - baseY
  const bayCount = Math.max(1, Math.ceil(spanLength / SCAFFOLD_BAY))
  const postXs: number[] = []
  for (let i = 0; i <= bayCount; i++) {
    postXs.push(spanStart + Math.min(i * (spanLength / bayCount), spanLength))
  }

  for (let i = 0; i < postXs.length; i++) {
    const x = postXs[i] as number
    const post = new Mesh(
      new BoxGeometry(SCAFFOLD_POST_SIZE, height, SCAFFOLD_POST_SIZE),
      scaffoldMaterial,
    )
    post.name = `scaffold-post-${side}-${i}`
    post.position.set(x, baseY + height / 2, scaffoldZ)
    group.add(post)
  }

  const ledgerRows = Math.max(1, Math.floor(height / SCAFFOLD_LIFT))
  for (let row = 1; row <= ledgerRows; row++) {
    const y = baseY + Math.min(row * SCAFFOLD_LIFT, height - SCAFFOLD_POST_SIZE)
    for (let i = 0; i < postXs.length - 1; i++) {
      const xa = postXs[i] as number
      const xb = postXs[i + 1] as number
      const ledger = new Mesh(
        new BoxGeometry(xb - xa, SCAFFOLD_LEDGER_SIZE, SCAFFOLD_LEDGER_SIZE),
        scaffoldMaterial,
      )
      ledger.name = `scaffold-ledger-${side}-${row}-${i}`
      ledger.position.set((xa + xb) / 2, y, scaffoldZ)
      group.add(ledger)

      // One diagonal brace per bay, base-to-top, alternating direction so
      // adjacent bays cross-brace like a real erected frame.
      const braceRise = Math.min(SCAFFOLD_LIFT, height - SCAFFOLD_POST_SIZE)
      const dx = i % 2 === 0 ? xb - xa : xa - xb
      const braceLength = Math.hypot(dx, braceRise)
      const brace = new Mesh(
        new BoxGeometry(braceLength, SCAFFOLD_BRACE_SIZE, SCAFFOLD_BRACE_SIZE),
        scaffoldMaterial,
      )
      brace.name = `scaffold-brace-${side}-${i}`
      brace.position.set((xa + xb) / 2, baseY + braceRise / 2, scaffoldZ)
      brace.rotation.z = sign * Math.atan2(braceRise, dx)
      group.add(brace)
    }
  }
}

/**
 * The stretches of `[lo, hi]` left for panels once the corner units on this face
 * are placed. Clipped to the pour unit's span, so a corner belonging to a
 * neighbouring lift or segment takes nothing off this one.
 */
function panelRuns(spanStart: number, spanEnd: number, taken: readonly CornerRun[]): FaceRun[] {
  let runs: FaceRun[] = [{ lo: spanStart, hi: spanEnd }]
  for (const corner of taken) {
    const next: FaceRun[] = []
    for (const run of runs) {
      if (corner.blocked.hi <= run.lo || corner.blocked.lo >= run.hi) {
        next.push(run)
        continue
      }
      if (corner.blocked.lo > run.lo) next.push({ lo: run.lo, hi: corner.blocked.lo })
      if (corner.blocked.hi < run.hi) next.push({ lo: corner.blocked.hi, hi: run.hi })
    }
    runs = next
  }
  return runs.filter((run) => run.hi - run.lo > PANEL_GAP)
}

/**
 * Both faces' runs cut at the same stations, so a stretch the two skins share is
 * the same interval on each of them.
 *
 * This is what lets a through-tie exist at all. Each run is packed on its own, so
 * two faces given the same interval come back with the same widths in the same
 * order and their drilled holes coincide; given a 6 m run on one face and 2.6 m +
 * 2.6 m on the other, they do not, and there is nowhere on the wall a rod can pass.
 * A T is where this shows: the stem's corner unit takes a stretch out of the inside
 * face and nothing out of the outside one, and the crew answers that by landing a
 * joint on the outer skin opposite the unit's edge — which is exactly this cut.
 */
function alignRuns(runs: readonly FaceRun[], stations: readonly number[]): FaceRun[] {
  const out: FaceRun[] = []
  for (const run of runs) {
    let lo = run.lo
    for (const station of stations) {
      if (station <= lo + PANEL_GAP || station >= run.hi - PANEL_GAP) continue
      out.push({ lo, hi: station })
      lo = station
    }
    out.push({ lo, hi: run.hi })
  }
  return out.filter((run) => run.hi - run.lo > PANEL_GAP)
}

/** What a piece is called, so a filler and a site-cut board are not both `panel`. */
function pieceKindName(piece: PlannedPiece['piece']): string {
  return piece.kind === 'panel' ? 'panel' : piece.kind === 'filler' ? 'filler' : 'cut'
}

/** Two holes this close are the same hole — a millimetre of float in the frames. */
const HOLE_TOLERANCE = 0.002

/**
 * Where a through-tie can actually pass.
 *
 * On a panel system this is not a spacing: the frames leave the factory drilled, so
 * a rod passes only where a hole on one skin meets a hole on the other. Asking for a
 * tie at 600 mm when the panel is drilled at 575 and 2125 draws steel through a
 * steel frame. So the two faces' hole sets are intersected, and the design's own
 * spacing is used only for a conventional shutter, where the carpenter drills the
 * ply where the calculation asks.
 *
 * On that conventional path the rows come off the design graded: the base row is
 * tied at what the tie hardware and the waler's bending allow under the full head,
 * and the rows above open out as the head falls. Dividing the run into equal bays at
 * each row's spacing rather than stepping along it keeps the layout symmetrical, the
 * way APA sets one out, and puts a tie on each end of the run where the shutter is
 * levered hardest.
 */
function tieStations(
  planByFace: ReadonlyMap<'a' | 'b', FacePlan>,
  design: WallDesign,
  extent: { spanStart: number; spanEnd: number; baseY: number; formTop: number },
): Array<{ x: number; y: number }> {
  const a = planByFace.get('a')?.holes ?? []
  const b = planByFace.get('b')?.holes ?? []
  if (a.length > 0 && b.length > 0) {
    return a
      .filter((hole) =>
        b.some(
          (other) =>
            Math.abs(other.alongM - hole.alongM) <= HOLE_TOLERANCE &&
            Math.abs(other.elevationM - hole.elevationM) <= HOLE_TOLERANCE,
        ),
      )
      .map((hole) => ({ x: hole.alongM, y: hole.elevationM }))
      .sort((first, second) => first.y - second.y || first.x - second.x)
  }

  const span = extent.spanEnd - extent.spanStart
  const out: Array<{ x: number; y: number }> = []
  for (const row of design.rows) {
    const y = extent.baseY + row.elevationMm / 1000
    if (y > extent.formTop) continue
    // Rounded up, so the pitch set out comes in at or below what the row allowed. To
    // the nearest instead would put a 3 m run at 0.9 m centres on three bays of 1 m,
    // over capacity on every one of them.
    const bays = Math.max(1, Math.ceil(span / (row.horizontalSpacingMm / 1000) - 1e-9))
    for (let col = 0; col <= bays; col++) {
      out.push({ x: extent.spanStart + (col / bays) * span, y })
    }
  }
  return out
}

/**
 * The vertical bands of one panel column that survive the openings crossing
 * it: a full-height strip beside a door, a head band above it, and both a head
 * and a sill band around a window.
 */
function subtractOpenings(
  lo: number,
  hi: number,
  left: number,
  right: number,
  openings: Array<{ left: number; right: number; bottom: number; top: number }>,
): Array<{ lo: number; hi: number }> {
  let bands = [{ lo, hi }]
  for (const opening of openings) {
    if (opening.right <= left || opening.left >= right) continue
    const next: Array<{ lo: number; hi: number }> = []
    for (const band of bands) {
      if (opening.top <= band.lo || opening.bottom >= band.hi) {
        next.push(band)
        continue
      }
      if (opening.bottom > band.lo) next.push({ lo: band.lo, hi: opening.bottom })
      if (opening.top < band.hi) next.push({ lo: opening.top, hi: band.hi })
    }
    bands = next
  }
  return bands
}

export function buildWallFormwork(
  wall: WallNode,
  node: FormworkAssemblyNode,
  scope: FormworkScope,
  material: MeshStandardMaterial,
): Group {
  const group = new Group()
  const { element, unit, isFormed, corners } = scope

  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (wallLength <= 0) return group
  const height = wall.height ?? 2.4
  const thickness = wall.thickness ?? 0.15
  const faceOffset = thickness / 2 + PANEL_THICKNESS / 2

  const spanStart = unit?.startAlong ?? 0
  const spanEnd = unit?.endAlong ?? wallLength
  const baseY = unit?.baseElevation ?? 0
  const topY = unit?.topElevation ?? height
  const spanLength = spanEnd - spanStart
  if (spanLength <= 0 || topY - baseY <= 0) return group

  // Openings clipped to this unit: one straddling a lift joint is formed by
  // both shutters, each carrying only the part of the void in its own pour.
  const openings: Array<{
    id: string
    left: number
    right: number
    bottom: number
    top: number
  }> = []
  for (const opening of element.openings) {
    const left = Math.max(spanStart, opening.along - opening.width / 2)
    const right = Math.min(spanEnd, opening.along + opening.width / 2)
    const bottom = Math.max(baseY, opening.centreY - opening.height / 2)
    const top = Math.min(topY, opening.centreY + opening.height / 2)
    if (right - left <= 0 || top - bottom <= 0) continue
    openings.push({ id: opening.id as string, left, right, bottom, top })
  }

  // An outside leg reaches past the element's own end, because it wraps the core
  // it turns onto and that core is outside this wall's footprint. So the element
  // end does not bound the leg; only a pour cut inside the wall does.
  const legLo = spanStart <= 1e-6 ? Number.NEGATIVE_INFINITY : spanStart
  const legHi = spanEnd >= wallLength - 1e-6 ? Number.POSITIVE_INFINITY : spanEnd

  const cornerRunsByFace = new Map<'a' | 'b', CornerRun[]>()
  const panelRunsByFace = new Map<'a' | 'b', FaceRun[]>()
  const planByFace = new Map<'a' | 'b', FacePlan>()
  // A wall stands off a kicker cast with the slab, so the shutter starts at its
  // top. At a lift joint there is no kicker — the concrete below is the wall.
  const kickerM = baseY <= 1e-6 ? KICKER_M : 0
  // The lateral chain for this pour, solved once and shared with the design report:
  // a panel that printed its own solve could disagree with the shutter on screen.
  const { design, system } = wallPourDesign(wall, unit, node.systemId)
  for (const { face } of SIDES) {
    cornerRunsByFace.set(face, cornerRuns(corners, face))
  }
  // Every corner edge on either face is a joint on both, so the two skins are
  // divided identically and a tie has holes to pass through.
  const shared = [
    ...new Set(
      [...cornerRunsByFace.values()]
        .flat()
        .flatMap((run) => [run.blocked.lo, run.blocked.hi])
        .filter((station) => station > spanStart && station < spanEnd),
    ),
  ].sort((a, b) => a - b)
  for (const { role, face } of SIDES) {
    const panelling = alignRuns(
      panelRuns(spanStart, spanEnd, cornerRunsByFace.get(face) ?? []),
      shared,
    )
    panelRunsByFace.set(face, panelling)
    if (!isFormed(role)) continue
    const plan = planFace(panelling, node, system, {
      baseM: baseY,
      heightM: topY - baseY,
      kickerM,
    })
    if (plan) planByFace.set(face, plan)
  }

  // Every face is coursed off the same lift, so the shutter's own extent is one
  // figure: the base of the bottom course to the top of the top one, which stands
  // proud of the concrete by the freeboard rather than stopping short of it.
  const coursed = planByFace.get('a') ?? planByFace.get('b')
  const formBottom = coursed?.courses[0]?.baseM ?? baseY + kickerM
  const formTop = coursed?.courses.at(-1)?.topM ?? topY
  if (formTop - formBottom <= 0) return group

  // Corner units, placed before the panels because the panel run starts clear of
  // them: an outside leg wraps the neighbouring core and so is longer than the
  // inside leg it pairs with. Only the owner's unit is billed, but both walls
  // draw their own leg — the hardware lands on both faces.
  for (const { side, sign, role, face } of SIDES) {
    if (!isFormed(role)) continue
    for (const [index, run] of (cornerRunsByFace.get(face) ?? []).entries()) {
      const lo = Math.max(run.leg.lo, legLo)
      const hi = Math.min(run.leg.hi, legHi)
      if (hi - lo <= PANEL_GAP) continue
      const leg = new Mesh(
        new BoxGeometry(hi - lo, formTop - formBottom, PANEL_THICKNESS),
        material,
      )
      leg.name = `${cornerPartName(run.entry)}-${index}-${side}`
      leg.position.set((lo + hi) / 2, (formBottom + formTop) / 2, sign * faceOffset)
      group.add(leg)
    }
  }

  // Shutter pieces on each formed face — poured concrete pushes outward on both
  // sides, so a face left unformed on a double-sided pour would blow out. Faces
  // butting hardened concrete need no shutter at all. Widths and course heights
  // are the catalog's, and a piece is cut around every opening rather than
  // spanning it. The kind is in the name because a hired panel, a system filler
  // and a board somebody cut are three different lines on the bill.
  for (const { side, sign, role, face } of SIDES) {
    if (!isFormed(role)) continue
    for (const [courseIndex, course] of (planByFace.get(face)?.courses ?? []).entries()) {
      for (const [index, { lo, hi, piece }] of course.pieces.entries()) {
        const bands = subtractOpenings(course.baseM, course.topM, lo, hi, openings)
        const stem = `${pieceKindName(piece)}-${side}-c${courseIndex}-${index}`
        for (const [b, band] of bands.entries()) {
          const bandHeight = band.hi - band.lo
          if (bandHeight <= PANEL_GAP) continue
          const board = new Mesh(
            new BoxGeometry(hi - lo - PANEL_GAP, bandHeight, PANEL_THICKNESS),
            material,
          )
          board.name = bands.length > 1 ? `${stem}-${b}` : stem
          board.position.set((lo + hi) / 2, (band.lo + band.hi) / 2, sign * faceOffset)
          group.add(board)
        }
      }
    }
  }

  // Box-outs: the reveal faces returned inside each opening. These are formed
  // and paid for, and a wall full of small openings gains more reveal area
  // than it loses — so they cannot be a rendering afterthought. A side where
  // the void runs out to a boundary of this pour has no returned face: the
  // concrete simply continues into the next unit.
  for (const opening of openings) {
    const openingWidth = opening.right - opening.left
    const openingHeight = opening.top - opening.bottom
    if (openingWidth <= 0 || openingHeight <= 0) continue
    const centerX = (opening.left + opening.right) / 2
    const centerY = (opening.bottom + opening.top) / 2
    const reveals: Array<{ name: string; w: number; h: number; x: number; y: number }> = []
    if (opening.left > spanStart + PANEL_THICKNESS) {
      reveals.push({
        name: 'jamb-start',
        w: PANEL_THICKNESS,
        h: openingHeight,
        x: opening.left,
        y: centerY,
      })
    }
    if (opening.right < spanEnd - PANEL_THICKNESS) {
      reveals.push({
        name: 'jamb-end',
        w: PANEL_THICKNESS,
        h: openingHeight,
        x: opening.right,
        y: centerY,
      })
    }
    if (opening.top < topY - PANEL_THICKNESS) {
      reveals.push({
        name: 'head',
        w: openingWidth,
        h: PANEL_THICKNESS,
        x: centerX,
        y: opening.top,
      })
    }
    // A door standing on the floor has no sill to form — three sides, not four.
    if (opening.bottom > baseY + PANEL_THICKNESS) {
      reveals.push({
        name: 'sill',
        w: openingWidth,
        h: PANEL_THICKNESS,
        x: centerX,
        y: opening.bottom,
      })
    }
    for (const reveal of reveals) {
      const board = new Mesh(new BoxGeometry(reveal.w, reveal.h, thickness), material)
      board.name = `box-out-${opening.id}-${reveal.name}`
      board.position.set(reveal.x, reveal.y, 0)
      group.add(board)
    }
  }

  // Stop-ends (bulkheads) close the ends of the pour. This is the "all four
  // sides" case: a wall with no neighbours is a box, not two parallel skins.
  // A cut inside the wall is closed the same way — the concrete beyond it is
  // this same wall, cast in a different operation.
  const STOP_ENDS = [
    { role: 'end-start', name: 'stop-end-start', x: spanStart - PANEL_THICKNESS / 2 },
    { role: 'end-end', name: 'stop-end-end', x: spanEnd + PANEL_THICKNESS / 2 },
  ] as const
  for (const stopEnd of STOP_ENDS) {
    if (!isFormed(stopEnd.role)) continue
    const plate = new Mesh(
      new BoxGeometry(PANEL_THICKNESS, formTop - formBottom, thickness + PANEL_THICKNESS * 2),
      material,
    )
    plate.name = stopEnd.name
    plate.position.set(stopEnd.x, (formBottom + formTop) / 2, 0)
    group.add(plate)
  }

  // Through-ties clamp both faces together — one member spans the full wall
  // thickness plus both panel skins, so it doesn't need per-side duplication. A
  // through-tie needs a shutter at both ends to bear on, so a single-sided pour has
  // none: it resists the pour by bracing and anchors into an earlier lift instead.
  //
  // Where the panels come from a catalog the stations are not a spacing at all:
  // the frames are drilled, and a rod passes only where a hole on one skin lines up
  // with a hole on the other. The solved grid is what a conventional shutter gets,
  // because there the carpenter drills the ply where the calculation asks.
  const bothSidesFormed = isFormed('side-a') && isFormed('side-b')
  // A through-tie needs a panel on both faces, so any corner on either face
  // rules the station out.
  const blockedRuns = [
    ...(cornerRunsByFace.get('a') ?? []),
    ...(cornerRunsByFace.get('b') ?? []),
  ].map((run) => run.blocked)
  const passable = (x: number, y: number) =>
    // A tie has to pass through concrete. One landing in an opening has nothing to
    // bear on, so it is dropped rather than drawn floating. Same at a corner: the
    // panel run stops clear of the unit, and the unit ties through its own holes on
    // the catalog's spacing rather than the wall's.
    !openings.some((o) => x > o.left && x < o.right && y > o.bottom && y < o.top) &&
    !blockedRuns.some((run) => x > run.lo && x < run.hi)

  const stations = bothSidesFormed
    ? tieStations(planByFace, design, { spanStart, spanEnd, baseY, formTop })
    : []
  for (const [index, station] of stations.entries()) {
    if (!passable(station.x, station.y)) continue
    const tie = new Mesh(
      new BoxGeometry(TIE_SIZE, TIE_SIZE, thickness + PANEL_THICKNESS * 2),
      tieMaterial,
    )
    tie.name = `tie-${index}`
    tie.position.set(station.x, station.y, 0)
    group.add(tie)
  }

  // Walers (waling beams) on both faces, backing the panels so ties bear
  // on a beam rather than the plywood/steel skin directly. A waler backs a panel
  // run, so a corner unit interrupts it: the unit brings its own backing, and a
  // beam running over it would stand off the skin by the unit's own depth.
  //
  // A tie has to bear on a waler, so where there are ties the tie rows *are* the
  // waler rows — on a drilled panel system that is the factory's grid rather than
  // the solved spacing, and a beam set out on the solved spacing beside it would
  // leave every rod bearing on the skin. A face with no ties through it (the formed
  // side of a single-sided pour) takes the solved spacing, which is the only figure
  // there is for it.
  const walerYs = new Set(stations.map((station) => station.y))
  if (walerYs.size === 0) {
    for (const row of design.rows) {
      const y = baseY + row.elevationMm / 1000
      if (y <= formTop) walerYs.add(y)
    }
  }
  for (const { side, sign, role, face } of SIDES) {
    if (!isFormed(role)) continue
    const walerZ = sign * (faceOffset + PANEL_THICKNESS / 2 + WALER_DEPTH / 2)
    for (const [row, y] of [...walerYs].sort((a, b) => a - b).entries()) {
      let index = 0
      for (const run of panelRunsByFace.get(face) ?? []) {
        const runLength = run.hi - run.lo
        const waler = new Mesh(new BoxGeometry(runLength, WALER_HEIGHT, WALER_DEPTH), walerMaterial)
        waler.name = `waler-${side}-${row}-${index}`
        waler.position.set((run.lo + run.hi) / 2, y, walerZ)
        group.add(waler)
        index++
      }
    }
  }

  // Working scaffold — uprights + ledgers + diagonal braces standing off
  // each face, only when the wall calls for it (tall pours / access).
  if (wall.scaffoldRequired) {
    for (const { side, sign, role } of SIDES) {
      if (!isFormed(role)) continue
      const scaffoldZ = sign * (faceOffset + PANEL_THICKNESS / 2 + WALER_DEPTH + SCAFFOLD_STANDOFF)
      buildScaffoldSide(group, side, sign, spanStart, spanEnd, baseY, topY, scaffoldZ)
    }
  }

  return group
}
