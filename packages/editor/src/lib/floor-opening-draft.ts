import {
  type AnyNode,
  type AnyNodeId,
  area,
  cutFloorOpening,
  type FloorOpeningHint,
  generateId,
  type LevelNode,
  type MultiPolygon,
  type StructurePlan,
  structureChangeBatch,
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
import { resolveRoomAssemblyHeights } from './room-assembly-overlay'
import { roomFloorElevation } from './room-handle-drag'
import { sfxEmitter } from './sfx-bus'

// "Cut opening": draws an opening on a room's floor (or its ceiling) with the
// floor region draft, rectangle or polygon, snapped to the room's wall faces
// and its other openings. One outline is one `floor-opening` node (core's
// `cutFloorOpening`), one undo step; the reconciler cuts the surfaces. The new
// opening is then selected so its shape and switch are a click away, and Done
// or Delete returns to the room.

export const OPENING_DRAFT_HANDLE = 'floor-opening-draft'
export const OPENING_OUTSIDE_MESSAGE = 'Draw the opening inside the room.'
export const OPENING_TOO_SMALL_MESSAGE = 'Too small for an opening.'
export const OPENING_FAILED_MESSAGE = "Can't cut an opening here."
/** Smallest opening worth cutting, m². */
const MIN_OPENING_AREA = 0.04

export type OpeningShape = 'rectangle' | 'polygon'
export type OpeningSurface = 'floor' | 'ceiling'

export const useOpeningDraft = create<{
  host: (FloorRegionRoom & { drawnOn: OpeningSurface }) | null
  shape: OpeningShape
  /** Hints the last cut returned (a manual ceiling below that is not cut). */
  hints: FloorOpeningHint[]
}>(() => ({ host: null, shape: 'rectangle', hints: [] }))

/** The plan for an outline, or why it cannot be cut. */
export function planFloorOpening(
  nodes: Record<string, AnyNode>,
  host: FloorRegionRoom,
  drawnOn: OpeningSurface,
  polygon: readonly FloorRegionPoint[],
):
  | { plan: StructurePlan & { openingIds: string[]; hints: FloorOpeningHint[] } }
  | { message: string } {
  const outline = polygon.map(([x, z]): [number, number] => [x, z])
  if (floorRegionSelfIntersects(outline)) return { message: CROSSING_MESSAGE }
  if (area([{ outer: outline, holes: [] }]) < MIN_OPENING_AREA)
    return { message: OPENING_TOO_SMALL_MESSAGE }
  if (!clipFloorRegion(polygon, host.clear)) return { message: OPENING_OUTSIDE_MESSAGE }
  try {
    const plan = cutFloorOpening(nodes, {
      zoneId: host.zoneId,
      polygon: outline,
      drawnOn,
      mintId: generateId,
    })
    const conflict = plan.conflicts?.[0]
    return conflict ? { message: conflict.message || OPENING_FAILED_MESSAGE } : { plan }
  } catch {
    return { message: OPENING_FAILED_MESSAGE }
  }
}

let tool: GestureHandle | null = null

function reset() {
  if (useOpeningDraft.getState().host) useOpeningDraft.setState({ host: null })
  const { draft } = useFloorRegionDraft.getState()
  if (draft?.room.purpose === OPENING) useFloorRegionDraft.setState({ draft: null, hover: null })
}

function commitOpening(room: FloorRegionRoom, polygon: readonly FloorRegionPoint[]) {
  const host = useOpeningDraft.getState().host
  const drawnOn = host?.drawnOn ?? 'floor'
  const result = planFloorOpening(useScene.getState().nodes, room, drawnOn, polygon)
  if ('message' in result) return { ok: false, message: result.message } as FloorDraftCommit
  const apply = () =>
    useScene.getState().applyNodeChanges(structureChangeBatch(result.plan.changes))
  const handle = tool
  tool = null
  try {
    if (handle?.active) handle.finish(apply)
    else apply()
  } finally {
    reset()
  }
  sfxEmitter.emit('sfx:structure-build')
  useOpeningDraft.setState({ hints: result.plan.hints })
  const openingId = result.plan.openingIds[0]
  if (openingId) useViewer.getState().setSelection({ selectedIds: [openingId as AnyNodeId] })
  return { ok: true } as const
}

function hostGone(host: FloorRegionRoom) {
  const scene = useScene.getState()
  const zone = scene.nodes[host.zoneId as AnyNodeId]
  return scene.readOnly || zone?.type !== 'zone' || zone.parentId !== host.levelId
}

function beginTool(host: FloorRegionRoom & { drawnOn: OpeningSurface }) {
  const handle = beginGesture({
    kind: 'floor-opening-draft',
    scope: { kind: 'handle-drag', nodeId: host.zoneId, handle: OPENING_DRAFT_HANDLE },
    stale: () => hostGone(host),
    onCancel: () => {
      if (tool === handle) tool = null
      reset()
    },
  })
  tool = handle
  useOpeningDraft.setState({ host, hints: [] })
  return handle
}

const OPENING: FloorDraftPurpose = {
  persistent: true,
  own: (room) => {
    if (tool?.active) return tool
    const host = useOpeningDraft.getState().host
    return beginTool({ ...room, drawnOn: host?.drawnOn ?? 'floor' })
  },
  commit: commitOpening,
  fill: '#f59e0b',
}

/**
 * The room an opening is drawn in: its clear floor bounds and snaps the
 * outline (with the level's other openings); the draft plane is its floor, or
 * its ceiling for a ceiling opening. A mezzanine draws on its own deck.
 */
export function describeOpeningHost(
  nodes: Record<string, AnyNode>,
  zoneId: string,
  drawnOn: OpeningSurface,
): (FloorRegionRoom & { drawnOn: OpeningSurface }) | null {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || zone.spaceRole !== 'room' || !zone.parentId) return null
  if (zone.floor?.support === 'open' && drawnOn !== 'floor') return null
  const record = getRoomSelectionIndex(zone.parentId)
    .update(nodes as ReturnType<typeof useScene.getState>['nodes'])
    .find((room) => room.zoneId === zoneId)
  if (!record) return null
  const clear: MultiPolygon = record.clearPolygon
  const others = Object.values(nodes).flatMap((node) =>
    node.type === 'floor-opening' && node.parentId === zone.parentId ? [node.polygon] : [],
  )
  const heights = resolveRoomAssemblyHeights(record, nodes)
  const elevation =
    drawnOn === 'ceiling'
      ? (heights.ceiling?.y ?? heights.floorY + 2.5)
      : roomFloorElevation(nodes, zoneId)
  return {
    zoneId,
    levelId: zone.parentId,
    clear,
    elevation,
    angle: floorRegionAxisAngle(clear),
    targets: floorRegionSnapTargets(clear, others),
    purpose: OPENING,
    drawnOn,
  }
}

/** Arms "Cut opening" in a room, on its floor or its ceiling. False when it cannot. */
export function startOpeningDraft(
  zoneId: string,
  drawnOn: OpeningSurface = 'floor',
  shape: OpeningShape = 'rectangle',
): boolean {
  const nodes = useScene.getState().nodes
  if (useScene.getState().readOnly) return false
  const host = describeOpeningHost(nodes, zoneId, drawnOn)
  if (!host) return false
  cancelOpeningDraft()
  cancelFloorRegion()
  useOpeningDraft.setState({ shape })
  if (useEditor.getState().mode !== 'select') useEditor.getState().setMode('select')
  if (useViewer.getState().selection.levelId !== host.levelId)
    useViewer.getState().setSelection({ levelId: host.levelId as LevelNode['id'] })
  beginTool(host)
  return true
}

export function cancelOpeningDraft() {
  const current = tool
  tool = null
  if (current?.active) current.cancel()
  else reset()
}

export function openingDraftActive() {
  return !!useOpeningDraft.getState().host
}
