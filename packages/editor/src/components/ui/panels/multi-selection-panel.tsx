'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Trash2 } from 'lucide-react'
import { deleteSelection, duplicateSelectionAndPickUp } from '../../editor/group-actions'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelWrapper } from './panel-wrapper'
import { formatSelectionBreakdown } from './selection-breakdown'

/**
 * Docked right-side panel for a MULTI-selection — the compact sibling of the
 * single-node inspector, rendered by `PanelManager` when more than one node
 * is selected. Same collapsed-by-default `PanelWrapper` shell (header always
 * visible; the shared desktop collapse state carries across single ↔ multi
 * swaps). Actions mirror the floating group pill: Duplicate clones the
 * selection and picks the clones up, Delete removes the whole selection
 * (including its bulk-delete confirm). Unlike the pill, the docked panel
 * stays visible during interactions. `footer` is the host-injected slot
 * (e.g. community's "Save to my catalog").
 */
export function MultiSelectionPanel({ footer }: { footer?: React.ReactNode }) {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  // String selector — recomputed on scene ticks, but the === compare keeps
  // unrelated mutations from re-rendering the panel.
  const breakdown = useScene((s) =>
    formatSelectionBreakdown(selectedIds.map((id) => s.nodes[id as AnyNodeId]?.type)),
  )

  return (
    <PanelWrapper
      footer={footer}
      icon="/icons/select.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title={`${selectedIds.length} selected`}
      width={320}
    >
      {breakdown && <div className="px-3 py-3 text-muted-foreground text-xs">{breakdown}</div>}
      <div className="border-border/50 border-t p-3">
        <ActionGroup>
          <ActionButton
            icon={<Copy className="h-4 w-4" />}
            label="Duplicate"
            onClick={() => duplicateSelectionAndPickUp()}
          />
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={() => deleteSelection()}
          />
        </ActionGroup>
      </div>
    </PanelWrapper>
  )
}
