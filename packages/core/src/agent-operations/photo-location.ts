import { refuse } from '../agent-tools/refusal'
import { exteriorWallLoops } from '../lib/exterior-wall-loops'
import type { AnyNode, WallNode, ZoneNode } from '../schema'
import { levelBalconies } from './level-balconies'
import { pointInPolygon } from './plan-geometry'
import { hasReferenceInventory } from './reference-items'
import type { AgentOperation, SceneNodes } from './types'

type Pt = [number, number]
type Kind = 'flush' | 'recess' | 'projection'

/** A setback under this is a wall-thickness jog of the same stretch, not a recess or projection. */
const STEP = 0.5
/** A corner whose face is shorter is a recess step or a jog, not a corner a photo is taken of. */
const MIN_FACE = 2
/** A turn longer than this is the building's next face, not a recess return. */
const MAX_RETURN = 15
/** How far in front of (or set into) a stretch a balcony counts as that stretch's. */
const BALCONY_REACH = 3
/** A bay narrower or wider than this cannot be a window bay: the photo's count and the stretch disagree. */
const BAY_PITCH: [number, number] = [2.4, 6]

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0]
const len = (a: Pt) => Math.hypot(a[0], a[1])
const unit = (a: Pt): Pt => [a[0] / len(a), a[1] / len(a)]
const cm = (value: number) => Math.round(value * 100) / 100

type Edge = { a: Pt; b: Pt; wallIds: string[] }

export type PhotoStretch = {
  kind: Kind
  /** Along the face from the corner, metres. */
  from: number
  to: number
  /** Out of the face line through the corner: negative is set back. */
  offset: number
  balconies: number
  wallIds: string[]
}
export type PhotoFace = { wallIds: string[]; segments: PhotoStretch[] }
export type BuildingCorner = {
  point: Pt
  /** From a camera outside the corner toward it. */
  facing: Pt
  zone: string | null
  left: PhotoFace
  right: PhotoFace
}

/**
 * The floor's exterior outline (the outer faces of its largest loop of walls), merged into
 * straight edges and wound so that the outside is on each edge's right in plan coordinates.
 */
function outlineEdges(nodes: SceneNodes, levelId: string, joinTolerance?: number): Edge[] {
  const level = nodes[levelId]
  if (level?.type !== 'level')
    refuse('level_not_found', `Level not found: ${levelId}.`, { levelId })
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' && node.parentId === levelId && node.visible !== false,
  )
  const loops = exteriorWallLoops(walls, joinTolerance)
  if (!loops.length)
    refuse(
      'no_exterior_loop',
      `${level.name ?? levelId} has no closed loop of exterior walls yet: build them first (create_reference_elements, walls, select outline), or pass joinTolerance (metres) when its corners nearly meet: 0.05 joins a vectorised plan's near-miss corners.`,
      { levelId },
    )
  const area = (loop: (typeof loops)[number]) => {
    const points = loop.flatMap((face) => face.points as Pt[])
    return points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]!), 0) / 2
  }
  const largest = loops.reduce((best, loop) =>
    Math.abs(area(loop)) > Math.abs(area(best)) ? loop : best,
  )
  let edges: Edge[] = largest.flatMap((face) =>
    (face.points as Pt[]).slice(1).map((b, i) => ({
      a: (face.points as Pt[])[i]!,
      b,
      wallIds: [face.wallId],
    })),
  )
  edges = edges.filter((edge) => len(sub(edge.b, edge.a)) > 1e-6)
  if (area(largest) < 0)
    edges = edges.reverse().map((edge) => ({ a: edge.b, b: edge.a, wallIds: edge.wallIds }))

  // One edge per straight stretch: collinear neighbours (a wall split where another joins it) merge.
  const merged: Edge[] = []
  for (const edge of edges) {
    const last = merged.at(-1)
    if (last && continues(last, edge))
      merged[merged.length - 1] = {
        a: last.a,
        b: edge.b,
        wallIds: [...last.wallIds, ...edge.wallIds.filter((id) => !last.wallIds.includes(id))],
      }
    else merged.push(edge)
  }
  if (merged.length > 1 && continues(merged.at(-1)!, merged[0]!)) {
    const last = merged.pop()!
    merged[0] = {
      a: last.a,
      b: merged[0]!.b,
      wallIds: [...last.wallIds, ...merged[0]!.wallIds.filter((id) => !last.wallIds.includes(id))],
    }
  }
  return merged
}

const direction = (edge: Edge) => unit(sub(edge.b, edge.a))
const continues = (a: Edge, b: Edge) =>
  Math.abs(cross(direction(a), direction(b))) < 1e-3 && dot(direction(a), direction(b)) > 0
/** With the loop wound to a positive area, the outside lies on each edge's right. */
const outward = (edge: Edge): Pt => {
  const [dx, dz] = direction(edge)
  return [dz, -dx]
}

type Walked = { a: Pt; b: Pt; d: Pt; wallIds: string[] }

/** The face from a corner along one way round the outline, until the building turns away. */
function walkFace(edges: Edge[], corner: Pt, first: number, forward: boolean): PhotoFace {
  const n = edges.length
  const at = (k: number): Walked => {
    const edge = edges[(((forward ? first + k : first - 1 - k) % n) + n) % n]!
    return forward
      ? { a: edge.a, b: edge.b, d: direction(edge), wallIds: edge.wallIds }
      : { a: edge.b, b: edge.a, d: unit(sub(edge.a, edge.b)), wallIds: [...edge.wallIds].reverse() }
  }
  const startEdge = edges[forward ? first : (first - 1 + n) % n]!
  const d0 = at(0).d
  const n0 = outward(startEdge)
  const wallIds: string[] = []
  const segments: PhotoStretch[] = []
  for (let k = 0; k < n; k++) {
    const edge = at(k)
    const c = dot(edge.d, d0)
    if (c > 0.9) {
      const offset = dot(sub(edge.a, corner), n0)
      const from = dot(sub(edge.a, corner), d0)
      const to = dot(sub(edge.b, corner), d0)
      const kind: Kind = offset > STEP ? 'projection' : offset < -STEP ? 'recess' : 'flush'
      const last = segments.at(-1)
      if (last && last.kind === kind && Math.abs(last.offset - offset) < STEP) {
        last.to = to
        last.wallIds.push(...edge.wallIds)
      } else segments.push({ kind, from, to, offset, balconies: 0, wallIds: [...edge.wallIds] })
      wallIds.push(...edge.wallIds)
      continue
    }
    const next = k + 1 < n ? at(k + 1) : null
    const isReturn =
      Math.abs(c) < 0.35 &&
      len(sub(edge.b, edge.a)) <= MAX_RETURN &&
      next !== null &&
      dot(next.d, d0) > 0.9
    if (!isReturn) break
    wallIds.push(...edge.wallIds)
  }
  return { wallIds, segments }
}

function countBalconies(face: PhotoFace, corner: Pt, d0: Pt, n0: Pt, centres: Pt[]) {
  for (const centre of centres) {
    const along = dot(sub(centre, corner), d0)
    const out = dot(sub(centre, corner), n0)
    const owner = face.segments
      .filter((s) => along >= s.from && along <= s.to && Math.abs(out - s.offset) <= BALCONY_REACH)
      .sort((p, q) => Math.abs(out - p.offset) - Math.abs(out - q.offset))[0]
    if (owner) owner.balconies++
  }
}

function balconyCentres(nodes: SceneNodes, levelId: string): { source: string; centres: Pt[] } {
  const decks = Object.values(nodes).filter(
    (node) =>
      node.type === 'slab' &&
      node.parentId === levelId &&
      (node.metadata?.balcony as { role?: string } | undefined)?.role === 'deck',
  ) as Extract<AnyNode, { type: 'slab' }>[]
  const centre = (points: readonly Pt[]): Pt => [
    points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length,
  ]
  if (decks.length)
    return { source: 'decks', centres: decks.map((deck) => centre(deck.polygon as Pt[])) }
  const mapped = levelBalconies(nodes, levelId).balconies
  if (mapped.length) return { source: 'plan', centres: mapped.map((b) => centre(b.corners)) }
  return { source: 'none', centres: [] }
}

/** Every outside corner of the floor a photo could be taken of, with its two faces as seen from outside. */
export function buildingCorners(
  nodes: SceneNodes,
  levelId: string,
  joinTolerance?: number,
): BuildingCorner[] {
  const edges = outlineEdges(nodes, levelId, joinTolerance)
  const { centres } = balconyCentres(nodes, levelId)
  const zones = Object.values(nodes).filter(
    (node): node is ZoneNode => node.type === 'zone' && node.parentId === levelId,
  )
  const n = edges.length
  const corners: BuildingCorner[] = []
  for (let i = 0; i < n; i++) {
    const before = edges[(i - 1 + n) % n]!
    const after = edges[i]!
    // Wound with the outside on the right, an outside corner turns left.
    if (cross(direction(before), direction(after)) <= 1e-6) continue
    const point = after.a
    const bisector = unit([
      outward(before)[0] + outward(after)[0],
      outward(before)[1] + outward(after)[1],
    ])
    const facing: Pt = [-bisector[0], -bisector[1]]
    const ahead = walkFace(edges, point, i, true)
    const back = walkFace(edges, point, i, false)
    const length = (face: PhotoFace) =>
      face.segments[0] ? face.segments[0].to - face.segments[0].from : 0
    if (length(ahead) < MIN_FACE || length(back) < MIN_FACE) continue
    countBalconies(ahead, point, direction(after), outward(after), centres)
    countBalconies(
      back,
      point,
      [-direction(before)[0], -direction(before)[1]],
      outward(before),
      centres,
    )
    // A camera facing f has its right along f × up: (−f.z, f.x) in plan coordinates.
    const right: Pt = [-facing[1], facing[0]]
    const aheadOnRight = dot(direction(after), right) > 0
    const inside: Pt = [point[0] + facing[0], point[1] + facing[1]]
    const zone = zones.find((z) => pointInPolygon(inside, z.polygon as Pt[]))
    corners.push({
      point,
      facing,
      zone: zone?.name ?? null,
      left: aheadOnRight ? back : ahead,
      right: aheadOnRight ? ahead : back,
    })
  }
  return corners
}

type Described = { kind: Kind; bays?: number; balconies?: number }
type LocatePhotoInput = {
  levelId?: string
  joinTolerance?: number
  left: { segments: Described[] }
  right: { segments: Described[] }
}

function compare(
  side: 'left' | 'right',
  described: Described[],
  face: PhotoFace,
  mismatches: string[],
) {
  let score = 0
  if (described.length > face.segments.length) {
    score -= 4 * (described.length - face.segments.length)
    mismatches.push(
      `${side}: the photo shows ${described.length} stretches, this face has ${face.segments.length}`,
    )
  }
  described.forEach((want, i) => {
    const have = face.segments[i]
    if (!have) return
    const label = `${side} stretch ${i + 1}`
    if (have.kind !== want.kind) {
      score -= 4
      mismatches.push(`${label}: the photo shows ${want.kind}, the plan ${have.kind}`)
    } else score += 2
    if (want.balconies !== undefined) {
      if (want.balconies === have.balconies) score += 3
      else {
        score -= 1.5 * Math.abs(want.balconies - have.balconies)
        mismatches.push(
          `${label}: ${want.balconies} balconies in the photo, ${have.balconies} on the plan`,
        )
      }
    }
    // Only a stretch the photo shows whole (another follows it) says how wide its bays are.
    if (want.bays !== undefined && i < described.length - 1) {
      const pitch = (have.to - have.from) / want.bays
      if (pitch >= BAY_PITCH[0] && pitch <= BAY_PITCH[1]) score += 1
      else {
        score -= 1
        mismatches.push(
          `${label}: ${want.bays} bays on ${cm(have.to - have.from)} m would be ${cm(pitch)} m each`,
        )
      }
    }
  })
  return score
}

const faceOut = (face: PhotoFace) => ({
  wallIds: face.wallIds,
  segments: face.segments.map((s) => ({
    kind: s.kind,
    length: cm(s.to - s.from),
    offset: cm(s.offset),
    balconies: s.balconies,
    wallIds: s.wallIds,
  })),
})

function rankCorners(corners: BuildingCorner[], input: LocatePhotoInput) {
  return corners
    .map((corner) => {
      const mismatches: string[] = []
      const score =
        compare('left', input.left.segments, corner.left, mismatches) +
        compare('right', input.right.segments, corner.right, mismatches)
      return { corner, score, mismatches }
    })
    .sort((p, q) => q.score - p.score)
}

/**
 * `locate_photo`: the outside corner a corner photo shows, and the walls of its two faces. Without
 * a floor it tries every floor: one whose walls run straight past the recess (Victor floor 3)
 * fits no corner, and arm B straightened the wrong walls after matching there.
 */
export const locatePhoto: AgentOperation<LocatePhotoInput> = (nodes, input) => {
  const levelIds = input.levelId
    ? [input.levelId]
    : Object.values(nodes)
        .filter((node) => node.type === 'level')
        .sort(
          (a, b) => ((a as { level?: number }).level ?? 0) - ((b as { level?: number }).level ?? 0),
        )
        .map((level) => level.id)
  const tried: { levelId: string; name: string | null; score: number }[] = []
  let best: { levelId: string; ranked: ReturnType<typeof rankCorners> } | null = null
  for (const levelId of levelIds) {
    let ranked: ReturnType<typeof rankCorners>
    try {
      ranked = rankCorners(buildingCorners(nodes, levelId, input.joinTolerance), input)
    } catch (error) {
      // A floor with no exterior walls (a roof level) cannot be the one in the photo.
      if (input.levelId) throw error
      continue
    }
    if (!ranked[0]) continue
    tried.push({ levelId, name: nodes[levelId]?.name ?? null, score: ranked[0].score })
    if (!best || ranked[0].score > best.ranked[0]!.score) best = { levelId, ranked }
  }
  if (!best)
    refuse(
      'no_exterior_loop',
      'No floor has a closed loop of exterior walls yet: build them first (create_reference_elements, walls, select outline).',
    )
  const [first, second] = best.ranked
  const ambiguous = Boolean(first && second && first.score - second.score < 1)
  const confident = Boolean(first && !first.mismatches.length && !ambiguous)
  return {
    result: {
      levelId: best.levelId,
      ...(input.levelId ? {} : { levelsTried: tried }),
      balconySource: balconyCentres(nodes, best.levelId).source,
      assumes:
        'The plan is read as seen from above, not mirrored: a mirrored plan swaps left and right.',
      ambiguous,
      confident,
      candidates: best.ranked.slice(0, 3).map(({ corner, score, mismatches }) => ({
        corner: [cm(corner.point[0]), cm(corner.point[1])],
        zone: corner.zone,
        score,
        mismatches,
        left: faceOut(corner.left),
        right: faceOut(corner.right),
        camera: {
          facing: [cm(corner.facing[0]), cm(corner.facing[1])],
          position: null,
          note: "Outside this corner, looking at it. straighten_facade_photo on both faces gives the photo's camera in the scene (camera.pose).",
        },
      })),
      next: `${
        confident
          ? "Straighten each face with straighten_facade_photo on its flush stretch's walls: a recess is another plane."
          : 'Not confident: do not straighten or build on a guess. Ask the person which corner the photo shows, naming the candidates (their zones, the streets you know), or describe more of the photo and call again.'
      }${hasReferenceInventory(nodes) ? '' : ' The photo is the specification: write down what it shows, item by item, with record_reference, and verify_scene lists what is not built yet.'}`,
    },
  }
}
