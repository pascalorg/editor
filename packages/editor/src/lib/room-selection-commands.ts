import { type AnyNodeId, type BuildingNode, type LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import useSessionGroups from '../store/use-session-groups'
import { type RoomKey, shouldSelectRoom } from './room-selection'
import type { SelectionModifierKeys } from './selection-routing'

export function selectRoom(room: RoomKey) {
  const level = useScene.getState().nodes[room.levelId as AnyNodeId]
  useViewer.getState().setSelection({
    ...(level?.parentId ? { buildingId: level.parentId as BuildingNode['id'] } : {}),
    levelId: room.levelId as LevelNode['id'],
    selectedIds: [],
    zoneId: null,
  })
  useViewer.getState().setHoveredId(null)
  useEditor.getState().selectRoom(room)
}

export function popRoomSelection(): boolean {
  const editor = useEditor.getState()
  if (!editor.room) return false
  if (useViewer.getState().selection.selectedIds.length) {
    useViewer.getState().setSelection({ selectedIds: [] })
    editor.setHoveredRoom(null)
    editor.setSelectedMaterialTarget(null)
  } else editor.clearRoom()
  return true
}

export function shouldInterceptRoom(
  hit: RoomKey | null,
  modifiers: SelectionModifierKeys,
  nodeId: string | null,
): boolean {
  if (!shouldSelectRoom(useEditor.getState().room, hit, modifiers)) return false
  // Live groups take precedence, without constructing a scene-sized Set on hover.
  if (nodeId) {
    const nodes = useScene.getState().nodes
    for (const group of useSessionGroups.getState().groups) {
      if (!group.memberIds.includes(nodeId)) continue
      let liveCount = 0
      for (const id of group.memberIds) {
        if (nodes[id as AnyNodeId] && ++liveCount > 1) return false
      }
    }
  }
  return true
}

export function selectRoomFromHit(
  hit: RoomKey | null,
  modifiers: SelectionModifierKeys,
  nodeId: string | null,
) {
  if (hit && shouldInterceptRoom(hit, modifiers, nodeId)) {
    selectRoom(hit)
    return true
  }
  useEditor.getState().setHoveredRoom(null)
  return false
}
