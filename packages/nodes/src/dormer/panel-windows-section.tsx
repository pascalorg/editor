'use client'

import type { WindowNode } from '@pascal-app/core'
import { ActionButton, PanelSection, useTranslations } from '@pascal-app/editor'
import { Move, Pencil, Plus } from 'lucide-react'

export function DormerWindowsSection({
  windows,
  canAdd,
  onAdd,
  onEdit,
  onMove,
}: {
  windows: WindowNode[]
  canAdd: boolean
  onAdd: () => void
  onEdit: (window: WindowNode) => void
  onMove: (window: WindowNode) => void
}) {
  const t = useTranslations()
  return (
    <PanelSection title={t('nodes.dormer.windowsTitle', { count: windows.length })}>
      {windows.length > 0 ? (
        <div className="flex flex-col gap-1">
          {windows.map((window, index) => (
            <div
              className="flex items-center gap-1 rounded-lg border border-border/50 bg-[#2C2C2E] p-1"
              key={window.id}
            >
              <button
                className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[#3e3e3e]"
                onClick={() => onEdit(window)}
                type="button"
              >
                <span className="block truncate font-medium text-foreground text-xs">
                  {window.name || `Window ${index + 1}`}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground capitalize">
                  {window.dormerFace ?? 'front'} · {window.width.toFixed(2)} ×{' '}
                  {window.height.toFixed(2)} m
                </span>
              </button>
              <button
                aria-label={`Edit ${window.name || `Window ${index + 1}`}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={() => onEdit(window)}
                title={t('nodes.dormer.editWindow')}
                type="button"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label={`Move ${window.name || `Window ${index + 1}`}`}
                className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-muted-foreground text-xs transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={() => onMove(window)}
                title={t('nodes.dormer.moveWindow')}
                type="button"
              >
                <Move className="h-3.5 w-3.5" />
                {t('editor.move')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-2 py-3 text-center text-muted-foreground text-xs">
          {t('nodes.dormer.noWindows')}
        </div>
      )}

      <div className="px-1 pt-2 pb-1">
        <ActionButton
          className="w-full"
          disabled={!canAdd}
          icon={<Plus className="h-3.5 w-3.5" />}
          label={t('nodes.dormer.addWindow')}
          onClick={onAdd}
        />
        {!canAdd && (
          <p className="px-1 pt-2 text-center text-[10px] text-muted-foreground">
            {t('nodes.dormer.increaseWidth')}
          </p>
        )}
      </div>
    </PanelSection>
  )
}
