'use client'
import { type AnyNodeId, usePascalI18n, useScene } from '@pascal-app/core'
import { ActionMenuButton } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { ArrowLeftRight, ArrowUpDown } from 'lucide-react'
import { applyOpeningSwap } from '../shared/opening-swap'
import { doorMechanism } from './mechanism'
import { canSwapDoorHinge, canSwapDoorSwing, swapDoorHingePatch, swapDoorSwingPatch } from './swing'

/**
 * The door's action-menu contributions, in 2D and 3D: swap the hinge side and swap the swing
 * side without opening the panel's Swing section. One undo step each; a closed door opens so
 * the new swing shows.
 */
export default function DoorActions() {
  const i18n = usePascalI18n()
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
          label={i18n._({ id: 'node.door.actions.swapHingeSide', message: 'Swap hinge side' })}
          onClick={(event) => {
            event.stopPropagation()
            applyOpeningSwap(door, swapDoorHingePatch(door), doorMechanism)
          }}
        >
          <ArrowLeftRight className="h-4 w-4" />
        </ActionMenuButton>
      ) : null}
      <ActionMenuButton
        label={i18n._({ id: 'node.door.actions.swapSwingSide', message: 'Swap swing side' })}
        onClick={(event) => {
          event.stopPropagation()
          applyOpeningSwap(door, swapDoorSwingPatch(door), doorMechanism)
        }}
      >
        <ArrowUpDown className="h-4 w-4" />
      </ActionMenuButton>
    </>
  )
}
