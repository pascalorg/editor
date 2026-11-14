'use client'
import { type AnyNodeId, usePascalI18n, useScene } from '@pascal-app/core'
import { ActionMenuButton } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { ArrowLeftRight } from 'lucide-react'
import { applyOpeningSwap } from '../shared/opening-swap'
import { windowMechanism } from './mechanism'
import { canSwapWindowHinge, swapWindowHingePatch } from './swing'

/**
 * The window's action-menu contribution, in 2D and 3D, mirroring the door's: swap a casement's
 * hinge side without opening the panel. One undo step; a closed window opens so the new side
 * shows.
 */
export default function WindowActions() {
  const i18n = usePascalI18n()
  const selected = useViewer((s) => s.selection.selectedIds)
  const windowNode = useScene((s) => {
    const node = selected.length === 1 ? s.nodes[selected[0] as AnyNodeId] : undefined
    return node?.type === 'window' ? node : undefined
  })
  const readOnly = useScene((s) => s.readOnly)
  if (!windowNode || readOnly || !canSwapWindowHinge(windowNode)) return null
  return (
    <ActionMenuButton
      label={i18n._({ id: 'node.window.actions.swapHingeSide', message: 'Swap hinge side' })}
      onClick={(event) => {
        event.stopPropagation()
        applyOpeningSwap(windowNode, swapWindowHingePatch(windowNode), windowMechanism)
      }}
    >
      <ArrowLeftRight className="h-4 w-4" />
    </ActionMenuButton>
  )
}
