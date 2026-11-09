import {
  type AnyNode,
  type AnyNodeId,
  area,
  containsPoint,
  createMezzanine,
  generateId,
  getStoredLevelHeight,
  type LevelNode,
  type MultiPolygon,
  type StructurePlan,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { getRoomSelectionIndex } from '../hooks/use-selected-room'
import useEditor from '../store/use-editor'
import {
  CROSSING_MESSAGE,
  clipFloorRegion,
  floorRegionAxisAngle,
  floorRegionSelfIntersects,
} from './floor-region-geometry'
import {
  cancelFloorRegion,
  type FloorDraftCommit,
  type FloorDraftPurpose,
  type FloorRegionRoom,
  useFloorRegionDraft,
} from './floor-region-session'
import { type FloorRegionPoint, floorRegionSnapTargets } from './floor-region-snap'
import { beginGesture, type GestureHandle } from './gesture-lifecycle'
import {
  MEZZANINE_FAILED_MESSAGE,
  MEZZANINE_OUTSIDE_MESSAGE,
  MEZZANINE_TOO_SMALL_MESSAGE,
  mezzanineConflictMessage,
} from './mezzanine-messages'
import { applyRoomPlan } from './room-structure-commands'
import { sfxEmitter } from './sfx-bus'

// "Add mezzanine": draws a mezzanine outline inside one room with the floor
// region draft (rectangle or polygon), snapped to the room's walls, and builds
// it with core's `createMezzanine` at the default half-storey elevation (one
// undo step). The tool is one lifecycle gesture from `startMezzanineDraft`
// until the mezzanine is built or the tool is cancelled (Escape, a mode,
// level or selection change, the room gone); refused outlines stay red with a
// short label and the tool stays armed for another try.

export const MEZZANINE_DRAFT_HANDLE = 'mezzanine-draft'

export type MezzanineShape = 'rectangle' | 'polygon'

export const useMezzanineDraft = create<{
  /** The room the mezzanine is drawn in while the tool is armed. */
  host: FloorRegionRoom | null
  shape: MezzanineShape
}>(() => ({ host: null, shape: 'rectangle' }))

/** The mezzanine's default elevation: half the storey, as `createMezzanine` rounds it. */
export function defaultMezzanineElevation(level: LevelNode) {
  return Math.round(getStoredLevelHeight(level) * 10) / 20
}

const ON_BOUNDARY = 1e-4

function distanceToSegment(p: FloorRegionPoint, a: FloorRegionPoint, b: FloorRegionPoint) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq))
    : 0
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dz - p[1])
}

/** Inside the polygon, or on its boundary (a point snapped onto a wall line). */
function insideOrOn(polygon: MultiPolygon, point: FloorRegionPoint) {
  if (containsPoint(polygon, point)) return true
  return polygon.some(({ outer, holes }) =>
    [outer, ...holes].some((ring) =>
      ring.some((a, i) => distanceToSegment(point, a, ring[(i + 1) % ring.length]!) <= ON_BOUNDARY),
    ),
  )
}

function withoutRepeats(ring: FloorRegionPoint[]) {
  return ring.filter((point, i) => {
    const next = ring[(i + 1) % ring.length]!
    return Math.hypot(next[0] - point[0], next[1] - point[1]) > ON_BOUNDARY
  })
}

function refuse(message: string): FloorDraftCommit {
  return { ok: false, message }
}

/**
 * Why a mezzanine outline cannot be built, or its plan. The outline is clipped
 * to the host's clear floor (inside the wall faces) first; what the clip
 * leaves must be one piece of at least 1 m².
 */
export function planMezzanine(
  nodes: Record<string, AnyNode>,
  host: FloorRegionRoom,
  polygon: readonly FloorRegionPoint[],
): { plan: StructurePlan & { zoneId: string } } | { message: string } {
  const clip = clipFloorRegion(polygon, host.clear)
  if (!clip)
    return {
      message:
        area([{ outer: polygon.map(([x, z]) => [x, z]), holes: [] }]) < 1
          ? MEZZANINE_TOO_SMALL_MESSAGE
          : MEZZANINE_OUTSIDE_MESSAGE,
    }
  if (clip.pieces.length !== 1) return { message: MEZZANINE_OUTSIDE_MESSAGE }
  if (clip.area < 1) return { message: MEZZANINE_TOO_SMALL_MESSAGE }
  const outline = withoutRepeats(clip.polygon)
  let plan: StructurePlan & { zoneId: string }
  try {
    // The height the preview was drawn at, not one recomputed from a storey
    // that may have changed while the tool was armed.
    plan = createMezzanine(nodes, {
      hostZoneId: host.zoneId,
      polygon: outline,
      elevation: host.elevation,
      mintId: generateId,
    })
  } catch {
    return {
      message: floorRegionSelfIntersects(outline)
        ? CROSSING_MESSAGE
        : area([{ outer: outline, holes: [] }]) < 1
          ? MEZZANINE_TOO_SMALL_MESSAGE
          : MEZZANINE_FAILED_MESSAGE,
    }
  }
  const conflict = plan.conflicts?.[0]
  if (!conflict) return { plan }
  return { message: mezzanineConflictMessage(conflict.code) ?? MEZZANINE_FAILED_MESSAGE }
}

// The tool's lifecycle handle, from start until built or cancelled.
let tool: GestureHandle | null = null

function reset() {
  if (useMezzanineDraft.getState().host) useMezzanineDraft.setState({ host: null })
  const { draft } = useFloorRegionDraft.getState()
  if (draft?.room.purpose === MEZZANINE) useFloorRegionDraft.setState({ draft: null, hover: null })
}

function commitMezzanine(host: FloorRegionRoom, polygon: readonly FloorRegionPoint[]) {
  const result = planMezzanine(useScene.getState().nodes, host, polygon)
  if ('message' in result) return refuse(result.message)
  const handle = tool
  tool = null
  try {
    if (handle?.active) handle.finish(() => applyRoomPlan(result.plan))
    else applyRoomPlan(result.plan)
  } finally {
    reset()
  }
  sfxEmitter.emit('sfx:structure-build')
  useEditor.getState().selectRoom({ levelId: host.levelId, zoneId: result.plan.zoneId })
  return { ok: true } as const
}

function hostGone(host: FloorRegionRoom) {
  const scene = useScene.getState()
  const zone = scene.nodes[host.zoneId as AnyNodeId]
  return (
    scene.readOnly ||
    zone?.type !== 'zone' ||
    zone.parentId !== host.levelId ||
    useEditor.getState().room?.zoneId !== host.zoneId
  )
}

function beginTool(host: FloorRegionRoom) {
  const handle = beginGesture({
    kind: 'mezzanine-draft',
    scope: { kind: 'handle-drag', nodeId: host.zoneId, handle: MEZZANINE_DRAFT_HANDLE },
    stale: () => hostGone(host),
    onCancel: () => {
      if (tool === handle) tool = null
      reset()
    },
  })
  tool = handle
  useMezzanineDraft.setState({ host })
  return handle
}

const MEZZANINE: FloorDraftPurpose = {
  persistent: true,
  own: (room) => (tool?.active ? tool : beginTool(room)),
  commit: commitMezzanine,
  pointMessage: (room, point) => (insideOrOn(room.clear, point) ? null : MEZZANINE_OUTSIDE_MESSAGE),
  fill: '#818cf8',
}

/**
 * The room a mezzanine is drawn in: its clear floor (inside the wall faces,
 * which is what core accepts) bounds the outline, which snaps to those faces
 * and the level's other mezzanines. Null when the room cannot host one.
 */
export function describeMezzanineHost(
  nodes: Record<string, AnyNode>,
  hostZoneId: string,
): FloorRegionRoom | null {
  const zone = nodes[hostZoneId]
  if (zone?.type !== 'zone' || zone.floor?.support === 'open' || !zone.parentId) return null
  const level = nodes[zone.parentId]
  if (level?.type !== 'level') return null
  const record = getRoomSelectionIndex(level.id)
    .update(nodes)
    .find((room) => room.zoneId === hostZoneId)
  if (!record) return null
  const clear: MultiPolygon = record.clearPolygon
  const mezzanines = Object.values(nodes).flatMap((node) =>
    node.type === 'zone' && node.floor?.support === 'open' && node.parentId === level.id
      ? [node.polygon]
      : [],
  )
  return {
    zoneId: hostZoneId,
    levelId: level.id,
    clear,
    elevation: defaultMezzanineElevation(level),
    angle: floorRegionAxisAngle(clear),
    targets: floorRegionSnapTargets(clear, mezzanines),
    purpose: MEZZANINE,
  }
}

/**
 * Arms "Add mezzanine" in `hostZoneId`: select mode, the room's level and the
 * room selected first, then the tool's gesture, so setting them up cannot
 * cancel it. Returns false (changing nothing) when the room cannot host one.
 */
export function startMezzanineDraft(
  hostZoneId: string,
  shape: MezzanineShape = 'rectangle',
): boolean {
  const nodes = useScene.getState().nodes
  if (useScene.getState().readOnly) return false
  const host = describeMezzanineHost(nodes, hostZoneId)
  if (!host) return false
  cancelMezzanineDraft()
  cancelFloorRegion()
  useMezzanineDraft.setState({ shape })
  if (useEditor.getState().mode !== 'select') useEditor.getState().setMode('select')
  if (useViewer.getState().selection.levelId !== host.levelId)
    useViewer.getState().setSelection({ levelId: host.levelId as LevelNode['id'] })
  if (useEditor.getState().room?.zoneId !== hostZoneId)
    useEditor.getState().selectRoom({ levelId: host.levelId, zoneId: hostZoneId })
  beginTool(host)
  return true
}

export function cancelMezzanineDraft() {
  const current = tool
  tool = null
  if (current?.active) current.cancel()
  else reset()
}

export function mezzanineDraftActive() {
  return !!useMezzanineDraft.getState().host
}

/** Switches rectangle ↔ polygon; the outline in hand is dropped, the tool stays. */
export function setMezzanineShape(shape: MezzanineShape) {
  if (useMezzanineDraft.getState().shape === shape) return
  const { draft } = useFloorRegionDraft.getState()
  if (draft?.room.purpose === MEZZANINE) useFloorRegionDraft.setState({ draft: null })
  useMezzanineDraft.setState({ shape })
}
