import { enclosedWallIds } from '../../lib/exterior-wall-loops'
import type { AnyNode, AnyNodeId, WallNode } from '../../schema'
import { isCurvedWall } from '../../systems/wall/wall-curve'
import { getWallFaceOffsets } from '../../systems/wall/wall-frame'
import {
  WALL_MIN_LENGTH,
  type WallTopologyChanges,
  wallAttachmentSpan,
} from '../../systems/wall/wall-topology'
import type { StructureConflict } from './shared'
import { rehostWallChild, remapWallReferences, wallSlice } from './zone-wall-merge'

/**
 * A wall placed, moved or stretched over part of a parallel wall takes that
 * stretch over: the other wall keeps only what lies past the placed wall's
 * ends (cut back, split in two round it, or deleted when covered), so no
 * length of wall is doubled. Doors, windows and wall items on the stretch
 * taken over move onto the placed wall; rooms that named the cut wall name its
 * pieces and the placed wall.
 *
 * Two walls run along each other when they are parallel and the body centre of
 * the thinner lies inside the thicker's body: the same line, or a wall
 * face-aligned inside a thicker one. Walls side by side, face to face, are
 * left alone. The wall moves, the wall tool and the push arrows all finish
 * through here.
 */

// Walls within about 1° of each other count as parallel.
const PARALLEL_TOLERANCE = Math.sin(Math.PI / 180)
const ON_LINE = 1e-6
const SPAN_TOLERANCE = 1e-4

type Nodes = Record<string, AnyNode>
type Vec = [number, number]

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]]

function straightFrame(wall: WallNode) {
  if (isCurvedWall(wall)) return null
  const delta = sub(wall.end, wall.start)
  const length = Math.hypot(delta[0], delta[1])
  if (length < WALL_MIN_LENGTH) return null
  const dir: Vec = [delta[0] / length, delta[1] / length]
  return { dir, normal: [-dir[1], dir[0]] as Vec, length }
}

/** The wall's body across `normal` (a unit vector square to it), from `origin`. */
function bodyAcross(wall: WallNode, wallNormal: Vec, normal: Vec, origin: Vec): [number, number] {
  const { a, b } = getWallFaceOffsets(wall)
  const line = dot(sub(wall.start, origin), normal)
  const sign = Math.sign(dot(wallNormal, normal)) || 1
  return [line + Math.min(a * sign, b * sign), line + Math.max(a * sign, b * sign)]
}

/** True when `other` runs along `wall`: parallel, the thinner body centred inside the thicker. */
function runsAlong(wall: WallNode, other: WallNode) {
  const own = straightFrame(wall)
  const theirs = straightFrame(other)
  if (!(own && theirs)) return false
  if (Math.abs(own.dir[0] * theirs.dir[1] - own.dir[1] * theirs.dir[0]) > PARALLEL_TOLERANCE) {
    return false
  }
  const ownBody = bodyAcross(wall, own.normal, theirs.normal, other.start)
  const theirBody = bodyAcross(other, theirs.normal, theirs.normal, other.start)
  const [thin, thick] =
    ownBody[1] - ownBody[0] <= theirBody[1] - theirBody[0]
      ? [ownBody, theirBody]
      : [theirBody, ownBody]
  const middle = (thin[0] + thin[1]) / 2
  return middle > thick[0] + SPAN_TOLERANCE && middle < thick[1] - SPAN_TOLERANCE
}

/** Where `winner` covers `other`, as `[lo, hi]` of `other`; null under a wall's length. */
function coveredSpan(winner: WallNode, other: WallNode) {
  const frame = straightFrame(other)
  if (!frame) return null
  const station = (point: Vec) => dot(sub(point, other.start), frame.dir) / frame.length
  const s0 = station(winner.start)
  const s1 = station(winner.end)
  const lo = Math.max(0, Math.min(s0, s1))
  const hi = Math.min(1, Math.max(s0, s1))
  return (hi - lo) * frame.length < WALL_MIN_LENGTH ? null : { frame, s0, s1, lo, hi }
}

/** The walls on `wall`'s level it runs along for more than a sliver: what it would take over. */
export function wallsRunAlong(nodes: Readonly<Nodes>, wall: WallNode): WallNode[] {
  return Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' &&
      node.id !== wall.id &&
      node.parentId === wall.parentId &&
      runsAlong(wall, node) &&
      coveredSpan(wall, node) !== null,
  )
}

function wallAttachments(nodes: Nodes, wall: WallNode) {
  return Object.values(nodes).filter(
    (node) => node.parentId === wall.id || ('wallId' in node && node.wallId === wall.id),
  )
}

/** A kept piece of a cut wall: `[t0, t1]` of it, the first keeping its id. */
type Piece = { id: string; t0: number; t1: number }

/**
 * Cut `winner`'s stretch out of `other` in `nodes` (mutated). Null when done,
 * a conflict when an opening straddles a cut.
 */
function cutAlong(
  nodes: Nodes,
  winner: WallNode,
  other: WallNode,
  mintId: () => string,
): StructureConflict | null {
  const covered = coveredSpan(winner, other)
  if (!covered) return null
  const { frame, s0, s1, lo, hi } = covered

  // Where the cut wall now ends: on the winner's own end when the two share a
  // line, so they meet exactly; else straight across from it on its own line.
  const sameLine =
    Math.abs(dot(sub(winner.start, other.start), frame.normal)) < ON_LINE &&
    Math.abs(dot(sub(winner.end, other.start), frame.normal)) < ON_LINE
  const pointAt = (t: number): Vec => {
    if (t <= 0) return [other.start[0], other.start[1]]
    if (t >= 1) return [other.end[0], other.end[1]]
    if (sameLine) {
      if (Math.abs(s0 - t) * frame.length < ON_LINE) return [winner.start[0], winner.start[1]]
      if (Math.abs(s1 - t) * frame.length < ON_LINE) return [winner.end[0], winner.end[1]]
    }
    return [
      other.start[0] + (other.end[0] - other.start[0]) * t,
      other.start[1] + (other.end[1] - other.start[1]) * t,
    ]
  }

  const spans = [
    [0, lo],
    [hi, 1],
  ].filter(([t0, t1]) => (t1! - t0!) * frame.length >= WALL_MIN_LENGTH)
  const pieces: Piece[] = spans.map(([t0, t1], index) => ({
    id: index === 0 ? other.id : mintId(),
    t0: t0!,
    t1: t1!,
  }))

  // Every attachment goes to the kept piece it sits on, or onto the winner
  // when it sits on the stretch taken over; one across a cut stops the edit.
  const placed = new Map<string, Piece | 'winner'>()
  for (const child of wallAttachments(nodes, other)) {
    const span = wallAttachmentSpan(child)
    if (!span) {
      placed.set(child.id, pieces[0] ?? 'winner')
      continue
    }
    const t0 = span.min / frame.length
    const t1 = span.max / frame.length
    const tolerance = SPAN_TOLERANCE / frame.length
    const piece = pieces.find((p) => t0 >= p.t0 - tolerance && t1 <= p.t1 + tolerance)
    if (piece) placed.set(child.id, piece)
    else if (t0 >= lo - tolerance && t1 <= hi + tolerance) placed.set(child.id, 'winner')
    else
      return {
        code: 'hosted-openings',
        nodeIds: [child.id],
        message: 'A door or window would sit across where the walls meet.',
      }
  }

  const slices = pieces.map((piece) =>
    wallSlice(other, pointAt(piece.t0), pointAt(piece.t1), piece.id, [piece.t0, piece.t1]),
  )
  const winnerChildren = new Set<string>(winner.children ?? [])
  for (const child of wallAttachments(nodes, other)) {
    const target = placed.get(child.id)
    if (target === 'winner') {
      rehostWallChild(nodes, child, other, winner)
      winnerChildren.add(child.id)
      continue
    }
    if (!target) continue
    const slice = slices[pieces.indexOf(target)]!
    slice.children = [...(slice.children ?? []), child.id] as WallNode['children']
    if (!('position' in child && Array.isArray(child.position))) {
      nodes[child.id] = { ...child, parentId: slice.id } as AnyNode
      continue
    }
    const x = child.position[0] - target.t0 * frame.length
    const length = (target.t1 - target.t0) * frame.length
    nodes[child.id] = {
      ...child,
      parentId: slice.id,
      ...('wallId' in child ? { wallId: slice.id } : {}),
      position: [x, child.position[1], child.position[2]],
      ...('wallT' in child ? { wallT: length > 1e-6 ? x / length : 0 } : {}),
    } as AnyNode
  }
  nodes[winner.id] = { ...winner, children: [...winnerChildren] } as AnyNode
  remapWallReferences(nodes, other, [...slices, nodes[winner.id] as WallNode])
  delete nodes[other.id]
  for (const slice of slices) nodes[slice.id] = slice
  return null
}

/**
 * Let each wall of `winnerIds` take over the stretches of parallel walls it
 * runs along (`nodes` is mutated). Walls among the winners don't cut each
 * other. A conflict when an opening would straddle a cut; `nodes` may then
 * be half done, so callers work on a copy.
 */
export function trimWallOverlaps(
  nodes: Nodes,
  winnerIds: readonly string[],
  mintId: () => string,
): StructureConflict | null {
  const winners = new Set(winnerIds)
  for (const id of winnerIds) {
    const winner = nodes[id]
    if (winner?.type !== 'wall' || !straightFrame(winner)) continue
    for (const other of wallsRunAlong(nodes, winner).filter((node) => !winners.has(node.id))) {
      const conflict = cutAlong(nodes, nodes[id] as WallNode, other, mintId)
      if (conflict) return conflict
    }
  }
  return null
}

/**
 * The fields that make a wall's construction (its wall type): assembly,
 * thickness, finishes and trims. Position, support, paint regions, height and
 * justification stay with each wall.
 */
export const WALL_CONSTRUCTION_FIELDS = [
  'thickness',
  'wallType',
  'curtainWall',
  'railing',
  'assembly',
  'material',
  'materialPreset',
  'interiorMaterial',
  'interiorMaterialPreset',
  'exteriorMaterial',
  'exteriorMaterialPreset',
  'slots',
  'legacyFaceMaterials',
  'skirting',
  'crown',
  'chairRail',
  'finishScripts',
  'cap',
] as const satisfies ReadonlyArray<keyof WallNode>

/** `wall`'s construction as a patch for another wall (unset fields cleared). */
export function wallConstructionPatch(wall: WallNode): Partial<WallNode> {
  const patch: Record<string, unknown> = {}
  for (const field of WALL_CONSTRUCTION_FIELDS) patch[field] = structuredClone(wall[field])
  return patch as Partial<WallNode>
}

/** True when two walls are built the same (`WALL_CONSTRUCTION_FIELDS`). */
export function sameWallConstruction(a: WallNode, b: WallNode): boolean {
  return JSON.stringify(wallConstructionPatch(a)) === JSON.stringify(wallConstructionPatch(b))
}

/**
 * The jog walls a move bridges in (`bridgeIds`) copy the wall they continue —
 * often a partition, when an outside wall is pushed out past one. A jog left
 * on the outline of the storey, beside a moved wall that is on it too, is an
 * outside wall: it takes the moved wall's construction instead (`nodes` is
 * mutated).
 */
export function retypeOutlineBridges(
  nodes: Nodes,
  movedWallId: string,
  bridgeIds: readonly string[],
): void {
  const moved = nodes[movedWallId]
  if (moved?.type !== 'wall' || bridgeIds.length === 0) return
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' && node.parentId === moved.parentId && node.visible !== false,
  )
  const enclosed = enclosedWallIds(walls)
  if (enclosed.has(moved.id)) return
  const patch = wallConstructionPatch(moved)
  for (const id of bridgeIds) {
    const bridge = nodes[id]
    if (bridge?.type !== 'wall' || enclosed.has(bridge.id)) continue
    nodes[id] = { ...bridge, ...patch } as AnyNode
  }
}

/**
 * `changes` (a planned wall edit against `nodes`) with the overlaps its
 * `winnerIds` now run along trimmed, and its outline jogs (`bridgeIds`, beside
 * `movedWallId`) retyped. The plan unchanged when an opening would straddle a
 * cut.
 */
export function finishWallEdit(
  nodes: Record<AnyNodeId, AnyNode>,
  changes: WallTopologyChanges,
  options: {
    winnerIds: readonly string[]
    movedWallId?: string
    bridgeIds?: readonly string[]
    mintId: () => string
  },
): WallTopologyChanges {
  const scratch: Nodes = { ...nodes }
  for (const id of changes.delete) delete scratch[id]
  for (const { node, parentId } of changes.create)
    scratch[node.id] = { ...node, parentId: parentId ?? node.parentId } as AnyNode
  for (const { id, data } of changes.update)
    if (scratch[id]) scratch[id] = { ...scratch[id], ...data } as AnyNode
  if (options.movedWallId) {
    retypeOutlineBridges(scratch, options.movedWallId, options.bridgeIds ?? [])
  }
  const trimmed = { ...scratch }
  const conflict = trimWallOverlaps(trimmed, options.winnerIds, options.mintId)
  const after = conflict ? scratch : trimmed
  const before = nodes as Nodes
  return {
    create: Object.values(after)
      .filter((node) => !before[node.id])
      .map((node) => ({ node, parentId: node.parentId as AnyNodeId })),
    update: Object.values(after)
      .filter((node) => before[node.id] && node !== before[node.id])
      .map((node) => ({ id: node.id as AnyNodeId, data: node as Partial<AnyNode> })),
    delete: Object.keys(before).filter((id) => !after[id]) as AnyNodeId[],
  }
}
