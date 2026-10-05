import {
  type AnyNode,
  type AnyNodeId,
  createLevelStructurePreview,
  DEFAULT_LEVEL_HEIGHT,
  floorPlateGestureMinimum,
  generateId,
  getStoredLevelHeight,
  getWallBaseElevationForNodes,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallEffectiveHeightForNodes,
  getWallFaceOffsets,
  groundFloorConstruction,
  type NodeChange,
  type Point,
  planWallDivision,
  resolveMovedWallSupportSlabPatch,
  runAsSingleSceneHistoryStep,
  type StructureNodes,
  type StructurePlan,
  setRoomFloorConstruction,
  setWallGeometry,
  setZoneEdges,
  setZoneIntent,
  upperFloorHeightControl,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { Ray } from 'three'
import { create } from 'zustand'
import { ARROW_COLOR } from '../components/editor/handles/handle-arrow'
import { resolveResizeSnapValue } from '../components/editor/handles/resize-snap'
import { swallowNextClick } from '../components/editor/handles/use-handle-drag'
import { getRoomSelectionIndex } from '../hooks/use-selected-room'
import useEditor, { isGridSnapActive } from '../store/use-editor'
import { useWallMoveGhosts } from '../store/use-wall-move-ghosts'
import { footprintHeightPatch, footprintHeightValue } from './floor-footprints'
import { clientToPlan } from './floorplan/plan-coords'
import { beginGesture } from './gesture-lifecycle'
import { isHistoryShortcut } from './history'
import { MEZZANINE_FAILED_MESSAGE, mezzanineConflictMessage } from './mezzanine-messages'
import { roomOwnPlate } from './room-built-on'
import {
  mezzanineEdgeDimensions,
  type RoomDimension,
  wallPushDimensionRooms,
  wallPushDimensions,
} from './room-push-dimensions'
import { applyRoomPlan } from './room-structure-commands'
import { sfxEmitter } from './sfx-bus'
import { type SpatialPointerId, spatialPointerInput } from './spatial-pointer-input'
import { isTypingTarget } from './typing-target'

export const ROOM_ELEVATION_DRAG_LABEL = 'room-elevation'
/** Scope label of every wall push: a selected wall's side arrow and a room's boundary arrow. */
export const WALL_PUSH_DRAG_LABEL = 'wall-push'
/** Scope label of a mezzanine edge push (its plate grows or shrinks). */
export const MEZZANINE_EDGE_DRAG_LABEL = 'mezzanine-edge'

/** A wall a push would create (a moved span piece, a bridge), drawn as a ghost. */
export type RoomPushGhost = { start: Point; end: Point; thickness: number; height: number }

/** The drag in flight, read by the preview overlays (handles hide while it runs). */
export type RoomHandleDrag =
  | {
      kind: 'elevation'
      zoneId: string
      levelId: string
      /** Handle spot and the room's outline, in level plan coordinates. */
      anchor: Point
      outline: Point[][]
      from: number
      value: number
    }
  | {
      kind: 'push'
      /** The room whose arrow started it; absent for a selected wall's own arrow. */
      zoneId?: string
      levelId: string
      wallId: string
      /** Arrow position and outward direction at rest, in level plan coordinates. */
      anchor: Point
      height: number
      /** Base elevation of the pushed wall, where its ghost pieces stand. */
      base: number
      outward: Point
      distance: number
      ghosts: RoomPushGhost[]
      /** The pushed rooms' live widths, moving face to each facing parallel wall. */
      dimensions: RoomDimension[]
      message?: string
    }
  | {
      kind: 'mezzanine-edge'
      zoneId: string
      levelId: string
      /** The plate's walking surface, where the preview outline is drawn. */
      elevation: number
      /** The mezzanine outline the push would leave, in level plan coordinates. */
      outline: Point[]
      anchor: Point
      outward: Point
      distance: number
      /** The mezzanine's live widths, moving edge to each facing parallel edge. */
      dimensions: RoomDimension[]
      message?: string
    }

export const useRoomHandleDrag = create<{ drag: RoomHandleDrag | null }>(() => ({ drag: null }))

type Nodes = Record<string, AnyNode>

/** The walking surface of a room: its own elevation, else its plate's. */
export function roomFloorElevation(nodes: Nodes, zoneId: string): number {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone') return 0
  const own = roomOwnPlate(nodes, zoneId)
  if (own) return own.elevation
  if (typeof zone.floor?.elevation === 'number') return zone.floor.elevation
  const plate = Object.values(nodes).find(
    (node) => node.type === 'slab' && node.zoneIds?.includes(zoneId),
  )
  return plate?.type === 'slab' ? (plate.elevation ?? 0.05) : 0.05
}

/**
 * The stretch of a wall a push moves: `[0, 1]` is the whole wall (its
 * neighbours follow through the junction planner), anything shorter is split
 * off first and only that piece moves.
 */
export type WallPushSpan = { wallId: string; t0: number; t1: number }

/** One push/pull arrow: a selected wall's side arrow or a room's boundary arrow. */
export type WallPushHandle = WallPushSpan & {
  key: string
  /** Arrow position (plan) just outside the wall face it points out of. */
  position: Point
  /** Arrow height in the level frame (wall base included). */
  height: number
  outward: Point
  /** The wall's reference line as a coordinate along `outward` (grid snap lands it on the lattice). */
  line: number
}

const HANDLE_OFFSET = 0.27
const HANDLE_MIN_OFFSET = 0.33
const HANDLE_MIN_HEIGHT = 0.4
const HANDLE_TOP_INSET = 0.08
const WHOLE = 1e-4

/** The arrow for `[t0, t1]` of `wall`, outside its `side` face and pointing out of it. */
function wallPushHandle(
  nodes: Nodes,
  wall: WallNode,
  span: { t0: number; t1: number },
  side: 'a' | 'b',
  key: string,
): WallPushHandle | null {
  if (Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) < 1e-6) return null
  const frame = getWallCurveFrameAt(wall, (span.t0 + span.t1) / 2)
  const outward: Point =
    side === 'a' ? [frame.normal.x, frame.normal.y] : [-frame.normal.x, -frame.normal.y]
  const offsets = getWallFaceOffsets(wall)
  const face = side === 'a' ? offsets.a : -offsets.b
  const offset = Math.max(face + HANDLE_OFFSET, HANDLE_MIN_OFFSET)
  const wallHeight = getWallEffectiveHeightForNodes(wall, nodes)
  return {
    key,
    wallId: wall.id,
    t0: span.t0,
    t1: span.t1,
    position: [frame.point.x + outward[0] * offset, frame.point.y + outward[1] * offset],
    height:
      getWallBaseElevationForNodes(wall, nodes) +
      Math.max(wallHeight - HANDLE_TOP_INSET, HANDLE_MIN_HEIGHT),
    outward,
    line:
      ((wall.start[0] + wall.end[0]) / 2) * outward[0] +
      ((wall.start[1] + wall.end[1]) / 2) * outward[1],
  }
}

/** A selected wall's two side arrows (front, back): each pushes the whole wall. */
export function wallPushHandles(wall: WallNode, nodes: Nodes): WallPushHandle[] {
  return (['a', 'b'] as const).flatMap((side) => {
    const handle = wallPushHandle(nodes, wall, { t0: 0, t1: 1 }, side, `${wall.id}:${side}`)
    return handle ? [handle] : []
  })
}

/**
 * One push/pull arrow per boundary wall span of the room, outside the wall's
 * far face, pointing away from the room — where the wall's own side arrow for
 * that face sits. `face` is the wall face the room lies on (`a` = front).
 */
export function roomPushHandles(
  nodes: Nodes,
  spans: ReadonlyArray<{
    boundaryId: string
    kind: string
    face: 'a' | 'b'
    t0: number
    t1: number
  }>,
): WallPushHandle[] {
  return spans.flatMap((span) => {
    const wall = nodes[span.boundaryId]
    if (span.kind !== 'wall' || wall?.type !== 'wall') return []
    const handle = wallPushHandle(
      nodes,
      wall,
      span,
      span.face === 'a' ? 'b' : 'a',
      `${span.boundaryId}:${span.face}:${span.t0.toFixed(4)}`,
    )
    return handle ? [handle] : []
  })
}

/**
 * Snaps a push the way the wall move always has: the wall's reference line
 * (not the travel) lands on the grid lattice along its normal, so an off-grid
 * wall steps onto grid lines. Free while grid snapping is off.
 */
export function snapPushDistance(line: number, raw: number): number {
  return (
    resolveResizeSnapValue({
      rawValue: line + raw,
      gridSnapEnabled: true,
      gridSnapActive: isGridSnapActive(),
      gridSnapStep: useEditor.getState().gridSnapStep,
      magneticSnapActive: false,
    }) - line
  )
}

/**
 * Moves a room's floor to `elevation`. A room on its own floor has no height
 * of its own: its plate moves, through the room floor construction command the
 * panel and MCP share — upstairs by its thickness; on the ground by its
 * foundation (the slab stays on it), never below on the ground.
 */
export function planRoomElevation(nodes: StructureNodes, zoneId: string, elevation: number) {
  const own = roomOwnPlate(nodes, zoneId)
  if (!own) return setZoneIntent(nodes, { zoneId, patch: { floor: { elevation } } })
  const patch = upperFloorHeightControl(nodes, own)
    ? footprintHeightPatch(nodes, own, elevation)
    : footprintHeightPatch(
        nodes,
        own,
        elevation - own.thickness - groundFloorConstruction(nodes, own).grade,
      )
  return setRoomFloorConstruction(nodes, { zoneId, slabId: own.id, patch })
}

type Scratch = Record<string, AnyNode>

function applyChanges(scratch: Scratch, changes: readonly NodeChange[]): Scratch {
  const next = { ...scratch }
  for (const change of changes) {
    if (change.op === 'delete') delete next[change.id]
    else if (change.op === 'create') next[change.node.id] = change.node
    else if (next[change.id]) next[change.id] = { ...next[change.id], ...change.data } as AnyNode
  }
  return next
}

function diffNodes(before: Scratch, after: Scratch): NodeChange[] {
  const changes: NodeChange[] = []
  for (const node of Object.values(after)) {
    const previous = before[node.id]
    if (!previous) changes.push({ op: 'create', node })
    else if (previous !== node) {
      const data: Record<string, unknown> = {}
      for (const key of new Set([...Object.keys(previous), ...Object.keys(node)]))
        if (
          JSON.stringify(previous[key as keyof AnyNode]) !==
          JSON.stringify(node[key as keyof AnyNode])
        )
          data[key] = node[key as keyof AnyNode]
      if (Object.keys(data).length)
        changes.push({ op: 'update', id: node.id as AnyNodeId, data: data as Partial<AnyNode> })
    }
  }
  for (const id of Object.keys(before))
    if (!after[id]) changes.push({ op: 'delete', id: id as AnyNodeId })
  return changes
}

/**
 * Pushes the room's stretch of a wall `distance` along `outward`. A span that
 * covers the whole wall moves the wall; a partial span is split off at its
 * ends first (hosted openings stay on their pieces) and only that piece moves,
 * bridged back to the rest by the junction planner. One plan, one undo step.
 */
export function planRoomPush(
  nodes: StructureNodes,
  span: WallPushSpan,
  outward: Point,
  distance: number,
  mintId: (kind: 'zone' | 'wall' | 'separator') => string = generateId,
): StructurePlan {
  const wall = nodes[span.wallId]
  if (wall?.type !== 'wall') throw Error('Select a wall.')
  const shift = ([x, z]: Point): Point => [x + outward[0] * distance, z + outward[1] * distance]
  const whole = span.t0 <= WHOLE && span.t1 >= 1 - WHOLE
  if (whole)
    return setWallGeometry(nodes, {
      wallId: wall.id,
      start: shift(wall.start),
      end: shift(wall.end),
      mintId,
    })
  let scratch: Scratch = { ...nodes }
  let targetId = wall.id as WallNode['id']
  const length = getWallCurveLength(wall)
  try {
    // Far end first: the original id keeps the part before each cut, so the
    // piece created by the second cut is exactly [t0, t1].
    for (const t of [span.t1, span.t0]) {
      if (t <= WHOLE || t >= 1 - WHOLE) continue
      const division = planWallDivision(
        scratch as Record<AnyNodeId, AnyNode>,
        wall.id as WallNode['id'],
        t * length,
        () => mintId('wall'),
      )
      for (const { node, parentId } of division.changes.create)
        scratch[node.id] = { ...node, parentId: parentId ?? node.parentId } as AnyNode
      for (const id of division.changes.delete) delete scratch[id]
      for (const { id, data } of division.changes.update)
        if (scratch[id]) scratch[id] = { ...scratch[id], ...data } as AnyNode
      if (t === span.t0) targetId = division.changes.create[0]!.node.id as WallNode['id']
    }
  } catch (error) {
    return {
      changes: [],
      conflicts: [
        {
          code: 'occupied-split',
          nodeIds: [wall.id],
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  }
  const piece = scratch[targetId] as WallNode
  const moved = setWallGeometry(scratch, {
    wallId: piece.id,
    start: shift(piece.start),
    end: shift(piece.end),
    mintId,
  })
  if (moved.conflicts?.length) return moved
  return { changes: diffNodes(nodes, applyChanges(scratch, moved.changes)) }
}

function previewMint() {
  let n = 0
  return (kind: 'zone' | 'wall' | 'separator') => `${kind}_pushpreview${n++}`
}

let previewIds: string[] = []
let planGhosts = false
// One structure previewer per drag: it keeps its own draft, and the scene is
// untouched until the commit, so it is rebuilt only if the scene moves on.
let surfacePreview: {
  levelId: string
  nodes: Nodes
  run: ReturnType<typeof createLevelStructurePreview>
} | null = null

function clearPushPreview() {
  const overrides = useLiveNodeOverrides.getState()
  for (const id of previewIds) {
    overrides.clear(id as AnyNodeId)
    useScene.getState().markDirty(id as AnyNodeId)
  }
  previewIds = []
  if (planGhosts) useWallMoveGhosts.getState().clear()
  planGhosts = false
}

/** Room floors, ceilings and plates reshaped around the pushed walls, as override patches. */
function previewSurfaces(nodes: Nodes, levelId: string, after: Scratch) {
  if (surfacePreview?.levelId !== levelId || surfacePreview.nodes !== nodes)
    surfacePreview = { levelId, nodes, run: createLevelStructurePreview(levelId, nodes) }
  const walls = Object.values(after).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
  )
  return surfacePreview
    .run(walls)
    .map((patch) => [patch.id as AnyNodeId, patch.data as Partial<AnyNode>] as const)
}

/**
 * Shows the push live: the plan's updates to existing walls — and the room
 * surfaces reshaped around them — ride `useLiveNodeOverrides` (renderers merge
 * them), and the walls it would create come back as ghosts. Returns the
 * conflict code, if any.
 */
export function previewRoomPush(
  span: WallPushSpan,
  outward: Point,
  distance: number,
): { code?: string; ghosts: RoomPushGhost[] } {
  clearPushPreview()
  if (Math.abs(distance) < 1e-6) return { ghosts: [] }
  const nodes = useScene.getState().nodes
  let plan: StructurePlan
  try {
    plan = planRoomPush(nodes, span, outward, distance, previewMint())
  } catch {
    return { code: 'invalid-geometry', ghosts: [] }
  }
  if (plan.conflicts?.length) return { code: plan.conflicts[0]!.code, ghosts: [] }
  const updates: Array<readonly [AnyNodeId, Partial<AnyNode>]> = plan.changes.flatMap((change) =>
    change.op === 'update' ? [[change.id as AnyNodeId, change.data] as const] : [],
  )
  const levelId = nodes[span.wallId as AnyNodeId]?.parentId
  if (levelId) updates.push(...previewSurfaces(nodes, levelId, applyChanges(nodes, plan.changes)))
  useLiveNodeOverrides
    .getState()
    .setMany(updates.map(([id, data]) => [id, data] as [AnyNodeId, Partial<AnyNode>]))
  previewIds = updates.map(([id]) => id)
  for (const id of previewIds) useScene.getState().markDirty(id as AnyNodeId)
  const ghosts = plan.changes.flatMap((change): RoomPushGhost[] =>
    change.op === 'create' && change.node.type === 'wall'
      ? [
          {
            start: change.node.start,
            end: change.node.end,
            thickness: change.node.thickness ?? 0.1,
            height: getWallEffectiveHeightForNodes(change.node, nodes),
          },
        ]
      : [],
  )
  // The floor plan draws the same pieces through its bridge-ghost layer.
  if (ghosts.length) {
    useWallMoveGhosts.getState().setBridges(
      ghosts.map((ghost, index) => ({
        id: `wall-push:${index}`,
        start: ghost.start,
        end: ghost.end,
        thickness: ghost.thickness,
        color: ARROW_COLOR,
      })),
    )
    planGhosts = true
  }
  return { ghosts }
}

export function endRoomPushPreview() {
  clearPushPreview()
  surfacePreview = null
}

/**
 * Commits a push as one undo step; false when the planner refuses. The walls
 * it moved or created then re-elect the slab they stand on, as a wall move
 * always has, inside the same step.
 */
export function commitRoomPush(span: WallPushSpan, outward: Point, distance: number) {
  endRoomPushPreview()
  if (Math.abs(distance) < 1e-6) return true
  try {
    return runAsSingleSceneHistoryStep(useScene, () => {
      const plan = planRoomPush(useScene.getState().nodes, span, outward, distance)
      if (!applyRoomPlan(plan)) return false
      const nodes = useScene.getState().nodes
      const patches = plan.changes.flatMap((change) => {
        const wall = nodes[change.op === 'create' ? change.node.id : change.id]
        if (change.op === 'delete' || wall?.type !== 'wall') return []
        const patch = resolveMovedWallSupportSlabPatch(wall, nodes)
        return patch.supportSlabId === wall.supportSlabId
          ? []
          : [{ id: wall.id as AnyNodeId, data: patch as Partial<AnyNode> }]
      })
      if (patches.length) useScene.getState().updateNodes(patches)
      return true
    })
  } catch {
    return false
  }
}

/** Commits a floor elevation as one undo step. */
/**
 * The floor heights a mezzanine may take (core refuses the rest): above its own
 * plate thickness and at least 0.3 m under the storey top. Null for other rooms.
 */
export function mezzanineElevationBounds(
  nodes: Nodes,
  zoneId: string,
): { min: number; max: number } | null {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || zone.floor?.support !== 'open') return null
  const level = zone.parentId ? nodes[zone.parentId] : undefined
  const height = level?.type === 'level' ? (level.height ?? DEFAULT_LEVEL_HEIGHT) : 0
  const thickness = zone.floor.thickness ?? 0.2
  return { min: Math.round((thickness + 0.01) * 100) / 100, max: height - 0.3 }
}

/**
 * The floor heights an own-floor room's handle may take: core's plate minimum
 * (sunken ground floors are allowed; upstairs the underside stays fixed), up
 * to 0.5 m under the storey top. Null for other rooms.
 */
export function ownFloorElevationBounds(
  nodes: Nodes,
  zoneId: string,
): { min: number; max: number } | null {
  const own = roomOwnPlate(nodes, zoneId)
  if (!own) return null
  const level = own.parentId ? nodes[own.parentId] : undefined
  const max = level?.type === 'level' ? getStoredLevelHeight(level) - 0.5 : 3
  // On the ground the handle moves the foundation (0 up to the panel's limit)
  // under the slab; upstairs it moves the top from its resting minimum.
  const upper = upperFloorHeightControl(nodes, own)
  const offset = upper
    ? own.elevation - footprintHeightValue(nodes, own)
    : groundFloorConstruction(nodes, own).grade + own.thickness
  return {
    min: upper ? Math.min(own.elevation, floorPlateGestureMinimum(nodes, own)) : offset,
    max: Math.max(own.elevation, offset + max),
  }
}

/** One push arrow per edge of a mezzanine's outline, just outside the edge at plate height. */
export type MezzanineEdgeHandle = {
  key: string
  edgeIndex: number
  position: Point
  outward: Point
  /** The edge's offset along `outward`, so a push lands the edge on the grid. */
  line: number
  height: number
}

/** How far outside its edge (m) a mezzanine push arrow sits. */
const MEZZANINE_ARROW_OFFSET = 0.3

export function mezzanineEdgeHandles(nodes: Nodes, zoneId: string): MezzanineEdgeHandle[] {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || zone.floor?.support !== 'open') return []
  const polygon = zone.polygon
  // Core's outward normal for an edge: the polygon's winding decides the side.
  let signed = 0
  for (const [i, p] of polygon.entries()) {
    const q = polygon[(i + 1) % polygon.length]!
    signed += p[0] * q[1] - q[0] * p[1]
  }
  const winding = Math.sign(signed)
  const height = zone.floor.elevation ?? 0
  return polygon.flatMap((start, edgeIndex) => {
    const end = polygon[(edgeIndex + 1) % polygon.length]!
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const length = Math.hypot(dx, dz)
    if (length < 0.2) return []
    const outward: Point = [(winding * dz) / length, (-winding * dx) / length]
    const mid: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    return [
      {
        key: `${zoneId}:${edgeIndex}`,
        edgeIndex,
        position: [
          mid[0] + outward[0] * MEZZANINE_ARROW_OFFSET,
          mid[1] + outward[1] * MEZZANINE_ARROW_OFFSET,
        ],
        outward,
        line: start[0] * outward[0] + start[1] * outward[1],
        height,
      },
    ]
  })
}

/** Core's plan for pushing a mezzanine edge `distance` m outward (negative pulls it in). */
export function planMezzanineEdge(
  nodes: StructureNodes,
  zoneId: string,
  edgeIndex: number,
  distance: number,
) {
  return setZoneEdges(nodes, { zoneId, edgeIndex, distance })
}

/**
 * A mezzanine edge drag: the outline follows the arrow, grid-snapped by where
 * the edge lands; a refused outline turns red with its label and release
 * writes nothing. A valid release is one undo step.
 */
export function runMezzanineEdgeDrag({
  handle,
  zoneId,
  levelId,
  from,
  along,
}: {
  handle: MezzanineEdgeHandle
  zoneId: string
  levelId: string
  from: number
  along: (clientX: number, clientY: number) => number | null
}) {
  const zone = useScene.getState().nodes[zoneId as AnyNodeId]
  if (zone?.type !== 'zone') return null
  const rest = zone.polygon.map(([x, z]) => [x, z] as Point)
  let distance = 0
  let valid = true
  let outline = rest
  const publish = (message?: string) =>
    useRoomHandleDrag.setState({
      drag: {
        kind: 'mezzanine-edge',
        zoneId,
        levelId,
        elevation: handle.height,
        outline,
        anchor: handle.position,
        outward: handle.outward,
        distance,
        dimensions: mezzanineEdgeDimensions({
          rest,
          outline,
          edgeIndex: handle.edgeIndex,
          outward: handle.outward,
          distance,
          elevation: handle.height,
        }),
        message,
      },
    })
  publish()
  return runRoomHandleDrag({
    label: MEZZANINE_EDGE_DRAG_LABEL,
    nodeId: zoneId,
    zoneId,
    levelId,
    requires: [zoneId],
    sample: (x, y) => {
      const at = along(x, y)
      return at === null ? null : snapPushDistance(handle.line, at - from)
    },
    onValue: (next) => {
      if (Math.abs(next - distance) < 1e-6) return
      distance = next
      sfxEmitter.emit('sfx:grid-snap')
      const plan = planMezzanineEdge(useScene.getState().nodes, zoneId, handle.edgeIndex, distance)
      const conflict = plan.conflicts?.[0]
      valid = !conflict
      const update = plan.changes.find((change) => change.op === 'update')
      const polygon =
        update?.op === 'update' ? (update.data as { polygon?: Point[] }).polygon : undefined
      outline = polygon ?? pushedOutline(rest, handle.edgeIndex, handle.outward, distance)
      publish(
        conflict
          ? (mezzanineConflictMessage(conflict.code) ?? MEZZANINE_FAILED_MESSAGE)
          : undefined,
      )
    },
    onCommit: () => {
      if (!valid || Math.abs(distance) < 1e-6) return
      applyRoomPlan(
        planMezzanineEdge(useScene.getState().nodes, zoneId, handle.edgeIndex, distance),
      )
    },
    onCancel: () => {},
  })
}

/** The outline with one edge moved along its outward normal (the refused preview). */
function pushedOutline(polygon: Point[], edgeIndex: number, outward: Point, distance: number) {
  const next = polygon.map(([x, z]) => [x, z] as Point)
  for (const index of [edgeIndex, (edgeIndex + 1) % next.length]) {
    const [x, z] = next[index]!
    next[index] = [x + outward[0] * distance, z + outward[1] * distance]
  }
  return next
}

export function commitRoomElevation(zoneId: string, elevation: number) {
  return applyRoomPlan(planRoomElevation(useScene.getState().nodes, zoneId, elevation))
}

// ── Drag ownership ────────────────────────────────────────────────────────────

type ActiveDrag = {
  label: string
  nodeId: string
  zoneId?: string
  levelId: string
  /** Every node the drag depends on; losing one cancels it. */
  requires: string[]
  cancel: () => void
}

let active: ActiveDrag | null = null

/** The drag in flight, for the gesture owner's lifecycle checks. */
export function getActiveRoomHandleDrag() {
  return active
}

/** Cancels the drag in flight (previews cleared, scope released). Idempotent. */
export function cancelRoomHandleDrag() {
  active?.cancel()
}

/**
 * Runs one handle drag on window listeners, independent of the handle's own
 * mount (handles hide while any scope is active). `sample` maps a pointer to
 * the drag's value (`spatial.sample` a controller ray, for a spatial pointer);
 * release commits, Escape / ⌘Z / the gesture owner cancel. Cleanup runs
 * exactly once whatever happens, and releases only this drag's own scope;
 * nothing republishes a preview after it.
 */
export function runRoomHandleDrag({
  label,
  nodeId,
  zoneId,
  levelId,
  requires,
  sample,
  spatial,
  onValue,
  onCommit,
  onCancel,
}: {
  label: string
  nodeId: string
  zoneId?: string
  levelId: string
  requires: string[]
  sample: (clientX: number, clientY: number) => number | null
  spatial?: { pointerId: SpatialPointerId; sample: (ray: Ray) => number | null }
  onValue: (value: number) => void
  onCommit: () => void
  onCancel: () => void
}) {
  active?.cancel()
  document.body.style.cursor = 'grabbing'
  sfxEmitter.emit('sfx:item-pick')
  useViewer.getState().setInputDragging(true)
  let done = false
  let frame = 0
  let pending: PointerEvent | null = null
  let releaseSpatial: (() => void) | null = null
  const flush = () => {
    frame = 0
    const event = pending
    pending = null
    if (done || !event) return
    const value = sample(event.clientX, event.clientY)
    if (value !== null) onValue(value)
  }
  const onMove = (event: PointerEvent) => {
    pending = event
    if (!frame) frame = requestAnimationFrame(flush) || 0
  }
  let releasing = false
  const cleanup = () => {
    if (done) return
    done = true
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    pending = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onAbort)
    window.removeEventListener('keydown', onKeyDown, true)
    releaseSpatial?.()
    releaseSpatial = null
    if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
    // The release is read in capture, before the scene's own pointerup (which
    // selects what is under the pointer unless input is dragging): keep input
    // dragging until that event is through — its bubbling back to the window,
    // or the next task if something below stops it.
    if (releasing) {
      let released = false
      const release = () => {
        if (released) return
        released = true
        window.removeEventListener('pointerup', release)
        useViewer.getState().setInputDragging(false)
      }
      window.addEventListener('pointerup', release)
      setTimeout(release, 0)
    } else useViewer.getState().setInputDragging(false)
    useRoomHandleDrag.setState({ drag: null })
    if (active === controller) active = null
  }
  // The lifecycle owner claims and releases the scope, and cancels on a mode,
  // level or selection change, a lost scope, a required node deleted or any
  // history command.
  const owner = beginGesture({
    kind: 'room-handle-drag',
    scope: { kind: 'handle-drag', nodeId, handle: label },
    stale: () => {
      const nodes = useScene.getState().nodes
      return requires.some((id) => !nodes[id as AnyNodeId])
    },
    onCancel: () => {
      try {
        onCancel()
      } finally {
        cleanup()
      }
    },
  })
  const onUp = (event?: PointerEvent) => {
    if (done) return
    // Only a release aimed at something below the window can reach the scene.
    releasing = !!event && event.target !== window
    if (event) {
      pending = event
      flush()
    }
    swallowNextClick()
    sfxEmitter.emit('sfx:item-place')
    owner.finish(() => {
      try {
        onCommit()
      } finally {
        cleanup()
      }
    })
  }
  const onAbort = () => {
    if (!done) owner.cancel()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isTypingTarget(event.target)) return
    if (event.key !== 'Escape' && !isHistoryShortcut(event)) return
    event.preventDefault()
    event.stopPropagation()
    swallowNextClick()
    onAbort()
  }
  const controller: ActiveDrag = { label, nodeId, zoneId, levelId, requires, cancel: onAbort }
  active = controller
  window.addEventListener('pointermove', onMove)
  // Capture: the release belongs to this drag whatever is under the pointer.
  // A scene control that stops the native pointerup (a slab hole's hit box,
  // under an upper floor's height arrows) would otherwise swallow it, and the
  // drag would stay live until the next click.
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onAbort)
  window.addEventListener('keydown', onKeyDown, true)
  if (spatial)
    releaseSpatial = spatialPointerInput.capture(spatial.pointerId, {
      onMove: (ray) => {
        const value = done ? null : spatial.sample(ray)
        if (value !== null) onValue(value)
      },
      onRelease: () => onUp(),
      onCancel: onAbort,
    })
  return controller
}

/**
 * The one push/pull drag behind every wall arrow. `along` measures the pointer
 * along `handle.outward` (level plan metres) and `from` is where the press
 * landed on that axis. The push previews live — the wall, its neighbours and
 * the room surfaces through overrides, created pieces as ghosts — and release
 * commits it through `commitRoomPush` (core `setWallGeometry`) as one undo
 * step: the whole wall with its neighbours for a `[0, 1]` span, else the span
 * split off and moved alone.
 */
export function runWallPushDrag({
  handle,
  levelId,
  zoneId,
  from,
  along,
  spatial,
}: {
  handle: WallPushHandle
  levelId: string
  /** The room whose arrow this is: the drag cancels if the room goes. */
  zoneId?: string
  from: number
  along: (clientX: number, clientY: number) => number | null
  spatial?: { pointerId: SpatialPointerId; along: (ray: Ray) => number | null }
}) {
  const nodes = useScene.getState().nodes
  const wall = nodes[handle.wallId as AnyNodeId]
  if (wall?.type !== 'wall') return null
  const base = getWallBaseElevationForNodes(wall, nodes)
  const rooms = pushDimensionRooms(nodes, levelId, handle, base)
  let distance = 0
  let blocked = false
  let ghosts: RoomPushGhost[] = []
  const publish = (message?: string) =>
    useRoomHandleDrag.setState({
      drag: {
        kind: 'push',
        zoneId,
        levelId,
        wallId: handle.wallId,
        anchor: handle.position,
        height: handle.height,
        base,
        outward: handle.outward,
        distance,
        ghosts,
        dimensions: wallPushDimensions({
          rooms,
          wall,
          outward: handle.outward,
          distance,
          resolve: livePreviewNode,
        }),
        message,
      },
    })
  const toDistance = (at: number | null) =>
    at === null ? null : snapPushDistance(handle.line, at - from)
  publish()
  return runRoomHandleDrag({
    label: WALL_PUSH_DRAG_LABEL,
    nodeId: handle.wallId,
    zoneId,
    levelId,
    requires: zoneId ? [zoneId, handle.wallId] : [handle.wallId],
    sample: (x, y) => toDistance(along(x, y)),
    spatial: spatial && {
      pointerId: spatial.pointerId,
      sample: (ray) => toDistance(spatial.along(ray)),
    },
    onValue: (next) => {
      if (Math.abs(next - distance) < 1e-6) return
      distance = next
      sfxEmitter.emit('sfx:grid-snap')
      const preview = previewRoomPush(handle, handle.outward, distance)
      ghosts = preview.ghosts
      blocked = !!preview.code
      publish(preview.code ? "Can't move this wall there" : undefined)
    },
    onCommit: () => {
      if (blocked) endRoomPushPreview()
      else commitRoomPush(handle, handle.outward, distance)
    },
    onCancel: () => endRoomPushPreview(),
  })
}

/**
 * The rooms either side of a pushed stretch, for its live dimensions, each at
 * its own floor height (a room with no zone of its own at the wall's base).
 */
function pushDimensionRooms(nodes: Nodes, levelId: string, span: WallPushSpan, base: number) {
  const index = getRoomSelectionIndex(levelId)
  const records = index.update(nodes)
  const topology = index.topology.getLevelTopology(levelId)
  return wallPushDimensionRooms(topology?.rooms ?? [], span, (roomId) => {
    const zoneId = records.find((record) => record.id === roomId)?.zoneId
    return zoneId ? roomFloorElevation(nodes, zoneId) : base
  })
}

/** A node as the push preview draws it: the scene's, with its live override merged. */
function livePreviewNode(id: string): AnyNode | undefined {
  const node = useScene.getState().nodes[id as AnyNodeId]
  const override = useLiveNodeOverrides.getState().overrides.get(id)
  return node && override ? ({ ...node, ...override } as AnyNode) : node
}

/** Plan point on the wall at `t` — exported for tests. */
export function wallPointAt(wall: WallNode, t: number): Point {
  const frame = getWallCurveFrameAt(wall, t)
  return [frame.point.x, frame.point.y]
}

/**
 * The affordance a floor-plan `move-arrow` carries to be a wall push arrow;
 * its payload is a `WallPushArrowPayload`. The floor plan starts
 * `runFloorplanWallPush` for it instead of a registry affordance session.
 */
export const WALL_PUSH_AFFORDANCE = 'wall-push'

export type WallPushArrowPayload = { wallId: string; side: 'a' | 'b' }

type PlanPointer = (clientX: number, clientY: number) => readonly [number, number] | null

/** The pointer's plan position measured along an arrow's outward normal from its spot. */
function planAlong(position: Point, outward: Point, toPlan: PlanPointer) {
  return (x: number, y: number) => {
    const point = toPlan(x, y)
    return point
      ? (point[0] - position[0]) * outward[0] + (point[1] - position[1]) * outward[1]
      : null
  }
}

/**
 * A floor-plan wall arrow: the 3D arrow's handle (`wallPushHandles`), drag
 * (`runWallPushDrag`) and commit, with the pointer read in plan coordinates.
 */
export function runFloorplanWallPush(
  payload: unknown,
  clientX: number,
  clientY: number,
  toPlan: PlanPointer = clientToPlan,
) {
  const { wallId, side } = (payload ?? {}) as Partial<WallPushArrowPayload>
  const nodes = useScene.getState().nodes
  const wall = wallId ? nodes[wallId as AnyNodeId] : undefined
  if (wall?.type !== 'wall' || !wall.parentId) return null
  const handle = wallPushHandles(wall, nodes).find((h) => h.key === `${wall.id}:${side}`)
  if (!handle) return null
  return runFloorplanRoomPush({ handle, levelId: wall.parentId, clientX, clientY, toPlan })
}

/**
 * A floor-plan room arrow (one per boundary span, `roomPushHandles`): the 3D
 * room arrow's drag and commit — one undo step, the live preview through the
 * same overrides and ghosts — with the pointer read in plan coordinates.
 */
export function runFloorplanRoomPush({
  handle,
  levelId,
  zoneId,
  clientX,
  clientY,
  toPlan = clientToPlan,
}: {
  handle: WallPushHandle
  levelId: string
  zoneId?: string
  clientX: number
  clientY: number
  toPlan?: PlanPointer
}) {
  const along = planAlong(handle.position, handle.outward, toPlan)
  const from = along(clientX, clientY)
  if (from === null) return null
  return runWallPushDrag({ handle, levelId, zoneId, from, along })
}

/** A floor-plan mezzanine edge arrow: the 3D edge drag with the pointer read in plan coordinates. */
export function runFloorplanMezzanineEdge({
  handle,
  levelId,
  zoneId,
  clientX,
  clientY,
  toPlan = clientToPlan,
}: {
  handle: MezzanineEdgeHandle
  levelId: string
  zoneId: string
  clientX: number
  clientY: number
  toPlan?: PlanPointer
}) {
  const along = planAlong(handle.position, handle.outward, toPlan)
  const from = along(clientX, clientY)
  if (from === null) return null
  return runMezzanineEdgeDrag({ handle, zoneId, levelId, from, along })
}
