import {
  type AnyNodeId,
  deleteZone,
  mergeZones,
  type StructureNodes,
  type StructurePlan,
  setZoneIntent,
  structureChangeBatch,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useDeleteConfirmation from '../store/use-delete-confirmation'
import useEditor from '../store/use-editor'
import { showRoomNotice } from './room-transform-session'
import { completeElementAction, type ElementActionOrigin } from './room-zone-routing'

export function applyRoomPlan(plan: StructurePlan) {
  if (plan.conflicts?.length) return false
  if (plan.changes.length) useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  return true
}

export function renameRoom(zoneId: string, name: string) {
  return applyRoomPlan(setZoneIntent(useScene.getState().nodes, { zoneId, patch: { name } }))
}

/**
 * Asks before deleting a room, per what core's `deleteZone` does with it: a
 * room Divide made merges back into its neighbour, a room with walls of its
 * own goes with them. A room inside walls other rooms share cannot be deleted
 * at all — no dialog, just the reason under its pill.
 */
export function requestRoomDeletion(zoneId: string) {
  const plan = deleteZone(useScene.getState().nodes, { zoneId, contents: 'delete' })
  if (plan.payload.mode === 'blocked') {
    showRoomNotice({ zoneId, message: plan.conflicts?.[0]?.message ?? '' })
    return
  }
  const commit = (contents: 'delete' | 'keep') => {
    if (!useScene.getState().nodes[zoneId as AnyNodeId]) return
    const current = deleteZone(useScene.getState().nodes, { zoneId, contents })
    if (
      JSON.stringify({ ...current.payload, contents: 'delete' }) !== JSON.stringify(plan.payload)
    ) {
      requestRoomDeletion(zoneId)
      return
    }
    // Read before the write: the selection of the deleted room clears with it.
    const levelId = useScene.getState().nodes[zoneId as AnyNodeId]?.parentId
    if (!applyRoomPlan(current)) return
    const merged = current.payload.mergedIntoZoneId
    useViewer.getState().setSelection({ selectedIds: [] })
    // The area is part of the room it merged into now: that room stays selected.
    if (merged && levelId && useScene.getState().nodes[merged as AnyNodeId])
      useEditor.getState().selectRoom({ levelId, zoneId: merged })
    else useEditor.getState().clearRoom()
  }
  useDeleteConfirmation.getState().requestConfirmation({
    count: plan.changes.filter((c) => c.op === 'delete').length,
    room: plan.payload,
    conflict: plan.conflicts?.map((c) => c.message).join(' '),
    onConfirm: () => commit('delete'),
    onKeepContents: plan.payload.mode === 'merge' ? undefined : () => commit('keep'),
  })
}

export function separatorMergePlan(nodes: StructureNodes, separatorId: string): StructurePlan {
  const zones = Object.values(nodes).filter(
    (node) =>
      node.type === 'zone' &&
      node.spaceRole === 'room' &&
      node.boundarySeparatorIds.includes(separatorId),
  )
  if (zones.length !== 2)
    return {
      changes: [],
      conflicts: [
        {
          code: 'separator-room-count',
          nodeIds: [separatorId],
          message: 'Select a separator between exactly two rooms.',
        },
      ],
    }
  return mergeZones(nodes, { zoneIds: [zones[0]!.id, zones[1]!.id] })
}
/** Deleting a separator merges its two rooms; the merged room is selected when the separator was drilled from one. */
export function deleteSelectedSeparator(id: AnyNodeId, origin: ElementActionOrigin | null = null) {
  const plan = separatorMergePlan(useScene.getState().nodes, id)
  if (!applyRoomPlan(plan)) return false
  useViewer.getState().setSelection({ selectedIds: [] })
  completeElementAction(origin)
  return true
}
