'use client'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { ActionMenuButton } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { DoorClosed, DoorOpen } from 'lucide-react'
import { toggleFenceGate } from './interaction'

/**
 * Open/Close for a single selected gate, the door's button in the action menu.
 * Not a `mechanism`: a gate's open angle is saved on the node, and mechanisms
 * never write the node.
 */
export default function FenceGateActions() {
  const selected = useViewer((s) => s.selection.selectedIds)
  const gate = useScene((s) => {
    const node = selected.length === 1 ? s.nodes[selected[0] as AnyNodeId] : undefined
    return node?.type === 'fence-gate' ? node : undefined
  })
  if (!gate) return null
  const open = (gate.openAngle ?? 0) > 0.01
  return (
    <ActionMenuButton
      keys={['E']}
      label={open ? 'Close' : 'Open'}
      onClick={(event) => {
        event.stopPropagation()
        toggleFenceGate(gate.id as AnyNodeId)
      }}
      pressed={open}
    >
      {open ? <DoorClosed className="h-4 w-4" /> : <DoorOpen className="h-4 w-4" />}
    </ActionMenuButton>
  )
}
