'use client'

import type { WindowNode } from '@pascal-app/core'
import { formatFixed, usePascalI18n } from '@pascal-app/core'
import { ActionButton, PanelSection } from '@pascal-app/editor'
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
  const i18n = usePascalI18n()
  const windowName = (window: WindowNode, index: number) =>
    window.name ||
    i18n._({
      id: 'node.dormer.panelWindowsSection.windowNumber',
      message: 'Window {number}',
      values: { number: index + 1 },
    })
  return (
    <PanelSection
      title={i18n._({
        id: 'node.dormer.panelWindowsSection.windowsLength',
        message: 'Windows ({length})',
        values: { length: windows.length },
      })}
    >
      {windows.length > 0 ? (
        <div className="flex flex-col gap-1">
          {windows.map((window, index) => (
            <div
              className="flex items-center gap-1 rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] p-1"
              key={window.id}
            >
              <button
                className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e]"
                onClick={() => onEdit(window)}
                type="button"
              >
                <span className="block truncate font-medium text-foreground text-xs">
                  {windowName(window, index)}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {i18n._({
                    id: 'node.dormer.panelWindowsSection.windowSummary',
                    message:
                      '{face, select, back {Back} left {Left} right {Right} other {Front}} · {width} × {height} m',
                    values: {
                      face: window.dormerFace ?? 'front',
                      width: formatFixed(window.width, 2, i18n.getLocale()),
                      height: formatFixed(window.height, 2, i18n.getLocale()),
                    },
                  })}
                </span>
              </button>
              <button
                aria-label={i18n._({
                  id: 'node.dormer.panelWindowsSection.editNamed',
                  message: 'Edit {name}',
                  values: { name: windowName(window, index) },
                })}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={() => onEdit(window)}
                title={i18n._({
                  id: 'node.dormer.panelWindowsSection.editWindow',
                  message: 'Edit window',
                })}
                type="button"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label={i18n._({
                  id: 'node.dormer.panelWindowsSection.moveNamed',
                  message: 'Move {name}',
                  values: { name: windowName(window, index) },
                })}
                className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-muted-foreground text-xs transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={() => onMove(window)}
                title={i18n._({
                  id: 'node.dormer.panelWindowsSection.moveWindow',
                  message: 'Move window',
                })}
                type="button"
              >
                <Move className="h-3.5 w-3.5" />
                {i18n._({ id: 'node.dormer.panelWindowsSection.move', message: 'Move' })}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-2 py-3 text-center text-muted-foreground text-xs">
          {i18n._({ id: 'node.dormer.panelWindowsSection.noWindows', message: 'No windows' })}
        </div>
      )}

      <div className="px-1 pt-2 pb-1">
        <ActionButton
          className="w-full"
          disabled={!canAdd}
          icon={<Plus className="h-3.5 w-3.5" />}
          label={i18n._({ id: 'node.dormer.panelWindowsSection.addWindow', message: 'Add Window' })}
          onClick={onAdd}
        />
        {!canAdd && (
          <p className="px-1 pt-2 text-center text-[10px] text-muted-foreground">
            {i18n._({
              id: 'node.dormer.panelWindowsSection.increaseTheDormerWidthToAdd',
              message: 'Increase the dormer width to add another window.',
            })}
          </p>
        )}
      </div>
    </PanelSection>
  )
}
