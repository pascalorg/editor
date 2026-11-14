'use client'

import { usePascalI18n } from '@pascal-app/core'
import { ActionButton, ActionGroup, PanelSection } from '@pascal-app/editor'
import { Copy, Move, Trash2 } from 'lucide-react'

/**
 * Move / Duplicate / Delete buttons at the bottom of the dormer
 * inspector. Pure presentation — owners pass the three handlers.
 */
export function DormerActionsSection({
  onMove,
  onDuplicate,
  onDelete,
}: {
  onMove: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const i18n = usePascalI18n()
  return (
    <PanelSection
      title={i18n._({ id: 'node.dormer.panelActionsSection.actions', message: 'Actions' })}
    >
      <ActionGroup>
        <ActionButton
          icon={<Move className="h-3.5 w-3.5" />}
          label={i18n._({ id: 'node.dormer.panelActionsSection.move', message: 'Move' })}
          onClick={onMove}
        />
        <ActionButton
          icon={<Copy className="h-3.5 w-3.5" />}
          label={i18n._({ id: 'node.dormer.panelActionsSection.duplicate', message: 'Duplicate' })}
          onClick={onDuplicate}
        />
        <ActionButton
          className="hover:bg-red-500/20"
          icon={<Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
          label={i18n._({ id: 'node.dormer.panelActionsSection.delete', message: 'Delete' })}
          onClick={onDelete}
        />
      </ActionGroup>
    </PanelSection>
  )
}
