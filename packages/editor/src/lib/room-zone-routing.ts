import { type AnyNode, type AnyNodeId, useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { getRoomSelectionIndex, hoverRoomFromHit } from '../hooks/use-selected-room'
import useEditor from '../store/use-editor'
import { expandSessionSelectionForNode } from '../store/use-session-groups'
import { type RoomKey, sameRoom } from './room-selection'
import { selectRoom } from './room-selection-commands'
import { resolveSelectedIdsForNodeClick, type SelectionModifierKeys } from './selection-routing'

// A room is one thing to the user whichever way they reach it: the canvas, the
// Rooms list, the plan's fill or its label. Rooms the room index knows (closed,
// or a mezzanine) are selected as rooms; everything else stays a zone.

export function isRoomZone(node: AnyNode | undefined): node is ZoneNode {
  return node?.type === 'zone' && node.spaceRole === 'room'
}

/** The room key of a zone that is a selectable room, else null. */
export function roomKeyForZone(
  zoneId: string,
  nodes: Record<string, AnyNode> = useScene.getState().nodes,
): RoomKey | null {
  const zone = nodes[zoneId]
  if (!isRoomZone(zone) || !zone.parentId) return null
  const records = getRoomSelectionIndex(zone.parentId).update(
    nodes as ReturnType<typeof useScene.getState>['nodes'],
  )
  return records.some((room) => room.key.zoneId === zoneId)
    ? { levelId: zone.parentId, zoneId }
    : null
}

/**
 * Selects a zone the way the user means it: an enclosed room as the room (its
 * panel, its pill, Escape back out), anything else as the zone. While a unit
 * is focused a zone stays a zone — arranging a unit works on zones.
 */
export function selectZoneOrRoom(zoneId: string): 'room' | 'zone' {
  const room = useViewer.getState().focusedUnitId ? null : roomKeyForZone(zoneId)
  if (room) {
    selectRoom(room)
    return 'room'
  }
  useEditor.getState().clearRoom()
  useViewer.getState().setSelection({ zoneId: zoneId as ZoneNode['id'] })
  return 'zone'
}

/**
 * The hover a pointer on a zone's area shows — its fill or label in the plan,
 * or its pill in either view. A room hovers room-first through the same rule
 * as its floor on the canvas (`hoverRoomFromHit`); held modifiers, or a zone
 * that bounds no room, hover the zone itself (its outline).
 */
export function hoverZoneArea(zoneId: string, modifiers: SelectionModifierKeys): void {
  const room = roomKeyForZone(zoneId)
  if (
    room &&
    sameRoom(useEditor.getState().room, room) &&
    !(modifiers.alt || modifiers.shift || modifiers.ctrl || modifiers.meta)
  ) {
    useEditor.getState().setHoveredRoom(room)
    useViewer.getState().setHoveredId(null)
    return
  }
  if (room && hoverRoomFromHit(room, modifiers, null)) return
  useEditor.getState().setHoveredRoom(null)
  if (useViewer.getState().hoveredId !== zoneId) useViewer.getState().setHoveredId(zoneId as never)
}

/** Ends a `hoverZoneArea` hover, leaving any other hover alone. */
export function leaveZoneArea(zoneId: string): void {
  const room = roomKeyForZone(zoneId)
  if (room && sameRoom(useEditor.getState().hoveredRoom, room))
    useEditor.getState().setHoveredRoom(null)
  if (useViewer.getState().hoveredId === zoneId) useViewer.getState().setHoveredId(null)
}

/**
 * The selection a click on a zone's area makes, whichever surface took it.
 * A plain click on a room selects the room (keeping it when it already is);
 * Shift/Ctrl/Meta toggle and Alt isolate the zone itself, as on any canvas
 * element. A zone that bounds no room selects as itself, which opens its panel
 * and its outline editor.
 */
export function clickZoneArea(zoneId: string, modifiers: SelectionModifierKeys): void {
  const room = roomKeyForZone(zoneId)
  const bypass = modifiers.alt || modifiers.shift || modifiers.ctrl || modifiers.meta
  if (room && !bypass) {
    if (!sameRoom(useEditor.getState().room, room)) selectRoom(room)
    return
  }
  useEditor.getState().clearRoom()
  const { selection, setSelection } = useViewer.getState()
  setSelection({
    zoneId: null,
    selectedIds: resolveSelectedIdsForNodeClick({
      currentSelectedIds: selection.selectedIds,
      modifierKeys: modifiers,
      nodeId: zoneId,
      expandIdsForNode: expandSessionSelectionForNode,
    }),
  })
}

/** Whether a zone's row is the selection, whichever store holds it. */
export function useZoneSelected(zoneId: string): boolean {
  const asRoom = useEditor((state) => state.room?.zoneId === zoneId)
  const asZone = useViewer(
    (state) =>
      state.selection.zoneId === zoneId ||
      (state.selection.selectedIds.length === 1 && state.selection.selectedIds[0] === zoneId),
  )
  return asRoom || asZone
}

/** The user word for a zone: rooms are "Room", every other area stays "Zone". */
export function zoneKindLabel(zone: Pick<ZoneNode, 'spaceRole'> | undefined): 'Room' | 'Zone' {
  return zone?.spaceRole === 'room' ? 'Room' : 'Zone'
}

/** Where a one-shot action on a drilled element started: its room, and a point inside it. */
export type ElementActionOrigin = { room: RoomKey; point: [number, number] | null }

/**
 * The room to come back to once an action on `elementIds` completes: the
 * selected room, when every element is part of it (its walls, separators,
 * floor or ceiling). Null when there is no room context (an Alt-selected
 * element, walls of another room), so the action keeps its own selection.
 */
export function captureElementActionOrigin(
  elementIds: readonly string[],
): ElementActionOrigin | null {
  const room = useEditor.getState().room
  if (!room) return null
  const nodes = useScene.getState().nodes
  const record = getRoomSelectionIndex(room.levelId)
    .update(nodes)
    .find((candidate) => candidate.key.zoneId === room.zoneId)
  if (!record) return null
  const parts = new Set<string>([
    ...record.spans.map((span) => span.boundaryId),
    ...(record.slabId ? [record.slabId] : []),
    ...(record.ceilingId ? [record.ceilingId] : []),
  ])
  if (!elementIds.every((id) => parts.has(id))) return null
  const zone = nodes[room.zoneId as AnyNodeId]
  const seed = zone?.type === 'zone' ? zone.seed : undefined
  return { room, point: seed ? [seed[0], seed[1]] : interiorPoint(record.clearPolygon) }
}

function interiorPoint(
  polygon: readonly { outer: readonly (readonly [number, number])[] }[],
): [number, number] | null {
  const ring = polygon[0]?.outer
  if (!ring?.length) return null
  let x = 0
  let z = 0
  for (const [px, pz] of ring) {
    x += px
    z += pz
  }
  return [x / ring.length, z / ring.length]
}

/**
 * Finishing a one-shot action on a piece of a room (Split, Merge, Delete, a
 * hole's Done) puts the user back on the room: the origin room when it is
 * still a room, else the room it became part of (`survivorZoneId`, or the room
 * now standing where it was), else nothing. Called at successful commits only —
 * a cancelled action keeps its element. Returns whether a room was selected.
 */
export function completeElementAction(
  origin: ElementActionOrigin | null,
  result: { survivorZoneId?: string } = {},
): boolean {
  if (!origin) return false
  const { levelId } = origin.room
  const index = getRoomSelectionIndex(levelId)
  const records = index.update(useScene.getState().nodes)
  const known = (zoneId: string | undefined) =>
    !!zoneId && records.some((room) => room.key.zoneId === zoneId)
  const zoneId = known(origin.room.zoneId)
    ? origin.room.zoneId
    : known(result.survivorZoneId)
      ? result.survivorZoneId!
      : origin.point
        ? (index.roomAtPoint(levelId, origin.point)?.key.zoneId ?? null)
        : null
  if (!zoneId) {
    useViewer.getState().setSelection({ selectedIds: [] })
    useEditor.getState().clearRoom()
    return false
  }
  selectRoom({ levelId, zoneId })
  return true
}
