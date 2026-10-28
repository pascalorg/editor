'use client'
import { type AnyNodeId, type DoorNode, useScene } from '@pascal-app/core'
import { ActionMenuButton, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { ArrowLeftRight, ArrowUpDown } from 'lucide-react'
import { canSwapDoorHinge, canSwapDoorSwing, swapDoorHingePatch, swapDoorSwingPatch } from './swing'

function applyDoorPatch(door: DoorNode, patch: Partial<DoorNode>) {
  const scene = useScene.getState()
  scene.updateNode(door.id, patch)
  scene.dirtyNodes.add(door.id as AnyNodeId)
  if (door.parentId) scene.dirtyNodes.add(door.parentId as AnyNodeId)
  triggerSFX('sfx:item-rotate')
}

/**
 * The door's action-menu contributions, in 2D and 3D: swap the hinge side and swap the swing
 * side without opening the panel's Swing section. One undo step each.
 */
export default function DoorActions() {
  const selected = useViewer((s) => s.selection.selectedIds)
  const door = useScene((s) => {
    const node = selected.length === 1 ? s.nodes[selected[0] as AnyNodeId] : undefined
    return node?.type === 'door' ? node : undefined
  })
  const readOnly = useScene((s) => s.readOnly)
  if (!door || readOnly || !canSwapDoorSwing(door)) return null
  return (
    <>
      {canSwapDoorHinge(door) ? (
        <ActionMenuButton
          label="Swap hinge side"
          onClick={(event) => {
            event.stopPropagation()
            applyDoorPatch(door, swapDoorHingePatch(door))
          }}
        >
          <ArrowLeftRight className="h-4 w-4" />
        </ActionMenuButton>
      ) : null}
      <ActionMenuButton
        label="Swap swing side"
        onClick={(event) => {
          event.stopPropagation()
          applyDoorPatch(door, swapDoorSwingPatch(door))
        }}
      >
        <ArrowUpDown className="h-4 w-4" />
      </ActionMenuButton>
    </>
  )
}
