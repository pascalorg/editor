import {
  type AnyNode,
  type AnyNodeId,
  area,
  createZone,
  generateId,
  type MultiPolygon,
  type StructurePlan,
  type ToolHint,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import useEditor from '../store/use-editor'
import { CROSSING_MESSAGE, floorRegionSelfIntersects } from './floor-region-geometry'
import {
  cancelFloorRegion,
  type FloorDraftCommit,
  type FloorDraftPurpose,
  type FloorRegionRoom,
  useFloorRegionDraft,
} from './floor-region-session'
import { type FloorRegionPoint, floorRegionSnapTargets } from './floor-region-snap'
import { beginGesture, type GestureHandle } from './gesture-lifecycle'
import { applyRoomPlan } from './room-structure-commands'
import { sfxEmitter } from './sfx-bus'

// "Terrace" (Build panel → Outdoor): draws an outdoor room on the level's
// ground, rectangle or polygon, snapped to the rooms already there and the
// grid. The terrace is a room like any other — bounded by separators (and by
// the walls it shares), no walls of its own and no ceiling — so it gets
// everything rooms have: finish paint, height arrows, Divide, Move, Delete.
// The tool is one lifecycle gesture from `startTerraceDraft` until cancelled;
// each outline commits as one undo step and the tool stays armed, like the
// room tools.

export const TERRACE_DRAFT_HANDLE = 'terrace-draft'
export const TERRACE_NAME = 'Terrace'
export const TERRACE_TOO_SMALL_MESSAGE = 'Too small for a terrace.'
export const TERRACE_FAILED_MESSAGE = "Can't place a terrace here."

export type TerraceShape = 'rectangle' | 'polygon'

export const useTerraceDraft = create<{
  host: FloorRegionRoom | null
  shape: TerraceShape
}>(() => ({ host: null, shape: 'rectangle' }))

/** How far the terrace tool reaches from the origin when the site has no outline. */
const OPEN_GROUND = 500

/**
 * Why a terrace outline cannot be built, or its plan: an outdoor room of the
 * outline, closed with separators where no wall runs, without a ceiling.
 * Core refuses an outline over a room (the same rule MCP's outdoor
 * `create_room` follows) and names the room.
 */
export function planTerrace(
  nodes: Record<string, AnyNode>,
  levelId: string,
  polygon: readonly FloorRegionPoint[],
): { plan: StructurePlan & { zoneId: string } } | { message: string } {
  const outline = polygon.map(([x, z]): [number, number] => [x, z])
  if (floorRegionSelfIntersects(outline)) return { message: CROSSING_MESSAGE }
  if (area([{ outer: outline, holes: [] }]) < 1) return { message: TERRACE_TOO_SMALL_MESSAGE }
  try {
    const plan = createZone(nodes, {
      levelId,
      polygon: outline,
      name: TERRACE_NAME,
      enclose: false,
      intent: { hasCeiling: false },
      mintId: generateId,
    })
    const conflict = plan.conflicts?.[0]
    return conflict ? { message: conflict.message || TERRACE_FAILED_MESSAGE } : { plan }
  } catch {
    return { message: TERRACE_FAILED_MESSAGE }
  }
}

let tool: GestureHandle | null = null

function reset() {
  if (useTerraceDraft.getState().host) useTerraceDraft.setState({ host: null })
  const { draft } = useFloorRegionDraft.getState()
  if (draft?.room.purpose === TERRACE) useFloorRegionDraft.setState({ draft: null, hover: null })
}

function commitTerrace(
  host: FloorRegionRoom,
  polygon: readonly FloorRegionPoint[],
): FloorDraftCommit {
  const result = planTerrace(useScene.getState().nodes, host.levelId, polygon)
  if ('message' in result) return { ok: false, message: result.message }
  applyRoomPlan(result.plan)
  sfxEmitter.emit('sfx:structure-build')
  // The rooms (and this terrace) now snap the next outline.
  useTerraceDraft.setState({ host: describeTerraceHost(useScene.getState().nodes, host.levelId) })
  return { ok: true }
}

function beginTool(host: FloorRegionRoom) {
  const handle = beginGesture({
    kind: 'terrace-draft',
    scope: { kind: 'handle-drag', nodeId: host.levelId, handle: TERRACE_DRAFT_HANDLE },
    stale: () =>
      useScene.getState().readOnly || !useScene.getState().nodes[host.levelId as AnyNodeId],
    onCancel: () => {
      if (tool === handle) tool = null
      reset()
    },
  })
  tool = handle
  useTerraceDraft.setState({ host })
  return handle
}

const TERRACE: FloorDraftPurpose = {
  persistent: true,
  own: (room) => (tool?.active ? tool : beginTool(room)),
  commit: (room, polygon) => {
    const current = useTerraceDraft.getState().host ?? room
    return commitTerrace(current, polygon)
  },
  fill: '#818cf8',
}

/** The level's ground as a draft room: the site (or open ground), snapping to the rooms on it. */
export function describeTerraceHost(
  nodes: Record<string, AnyNode>,
  levelId: string,
): FloorRegionRoom | null {
  const level = nodes[levelId]
  if (level?.type !== 'level') return null
  const site = Object.values(nodes).find((node) => node.type === 'site')
  const outline =
    site?.type === 'site' && site.polygon?.points?.length && site.polygon.points.length >= 3
      ? site.polygon.points.map(([x, z]): [number, number] => [x, z])
      : ([
          [-OPEN_GROUND, -OPEN_GROUND],
          [OPEN_GROUND, -OPEN_GROUND],
          [OPEN_GROUND, OPEN_GROUND],
          [-OPEN_GROUND, OPEN_GROUND],
        ] as [number, number][])
  const clear: MultiPolygon = [{ outer: outline, holes: [] }]
  const rooms = Object.values(nodes).flatMap((node) =>
    node.type === 'zone' && node.parentId === levelId && node.spaceRole === 'room'
      ? [node.polygon]
      : [],
  )
  return {
    zoneId: '',
    levelId,
    clear,
    elevation: 0,
    angle: 0,
    targets: floorRegionSnapTargets([], rooms),
    purpose: TERRACE,
  }
}

/** Arms the terrace tool on the current level (select mode, so nothing else draws). */
export function startTerraceDraft(levelId = useViewer.getState().selection.levelId): boolean {
  if (!levelId || useScene.getState().readOnly) return false
  const host = describeTerraceHost(useScene.getState().nodes, levelId)
  if (!host) return false
  cancelTerraceDraft()
  cancelFloorRegion()
  const editor = useEditor.getState()
  if (editor.phase !== 'structure') editor.setPhase('structure')
  if (editor.mode !== 'select') editor.setMode('select')
  if (editor.room) editor.clearRoom()
  useViewer.getState().setSelection({ selectedIds: [] })
  beginTool(host)
  return true
}

export function cancelTerraceDraft() {
  const current = tool
  tool = null
  if (current?.active) current.cancel()
  else reset()
}

export function terraceDraftActive() {
  return !!useTerraceDraft.getState().host
}

export function setTerraceShape(shape: TerraceShape) {
  if (useTerraceDraft.getState().shape === shape) return
  const { draft } = useFloorRegionDraft.getState()
  if (draft?.room.purpose === TERRACE) useFloorRegionDraft.setState({ draft: null })
  useTerraceDraft.setState({ shape })
}

export function toggleTerraceShape() {
  setTerraceShape(useTerraceDraft.getState().shape === 'rectangle' ? 'polygon' : 'rectangle')
}

/** The HUD's shape chip (T). */
export const TERRACE_SHAPE_HINT: ToolHint = {
  key: 'T',
  label: 'Shape',
  chip: {
    subscribe: (onChange) => useTerraceDraft.subscribe(onChange),
    value: () => useTerraceDraft.getState().shape,
    cycle: toggleTerraceShape,
    labels: { rectangle: 'Shape: Rectangle', polygon: 'Shape: Polygon' },
    icons: { rectangle: 'lucide:square', polygon: 'lucide:pentagon' },
    tooltip: 'Outline shape — click or press T to switch',
  },
}
