import { Keyboard } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'
import { ShortcutToken } from './../../../../../components/ui/primitives/shortcut-token'
import { t } from '../../../../../i18n/t'

type Shortcut = {
  keys: string[]
  action: string
  note?: string
}

type ShortcutCategory = {
  id: string
  title: string
  shortcuts: Shortcut[]
}

const KEY_DISPLAY_MAP: Record<string, string> = {
  'Arrow Up': '↑',
  'Arrow Down': '↓',
  Esc: '⎋',
  Shift: '⇧',
  Space: '␣',
}

function getShortcutCategories(): ShortcutCategory[] {
  return [
    {
      id: 'editorNavigation',
      title: t('sidebar.shortcuts.categories.editorNavigation', 'Editor Navigation'),
      shortcuts: [
        {
          keys: ['1'],
          action: t('sidebar.shortcuts.actions.switchToSitePhase', 'Switch to Site phase'),
        },
        {
          keys: ['2'],
          action: t('sidebar.shortcuts.actions.switchToStructurePhase', 'Switch to Structure phase'),
        },
        {
          keys: ['3'],
          action: t('sidebar.shortcuts.actions.switchToFurnishPhase', 'Switch to Furnish phase'),
        },
        {
          keys: ['S'],
          action: t('sidebar.shortcuts.actions.switchToStructureLayer', 'Switch to Structure layer'),
        },
        {
          keys: ['F'],
          action: t('sidebar.shortcuts.actions.switchToFurnishLayer', 'Switch to Furnish layer'),
        },
        {
          keys: ['Z'],
          action: t('sidebar.shortcuts.actions.switchToZonesLayer', 'Switch to Zones layer'),
        },
        {
          keys: ['Cmd/Ctrl', 'Arrow Up'],
          action: t(
            'sidebar.shortcuts.actions.selectNextLevel',
            'Select next level in the active building',
          ),
        },
        {
          keys: ['Cmd/Ctrl', 'Arrow Down'],
          action: t(
            'sidebar.shortcuts.actions.selectPreviousLevel',
            'Select previous level in the active building',
          ),
        },
        {
          keys: ['Cmd/Ctrl', 'B'],
          action: t('sidebar.shortcuts.actions.toggleSidebar', 'Toggle sidebar'),
        },
      ],
    },
    {
      id: 'modesAndHistory',
      title: t('sidebar.shortcuts.categories.modesAndHistory', 'Modes & History'),
      shortcuts: [
        {
          keys: ['V'],
          action: t('sidebar.shortcuts.actions.switchToSelectMode', 'Switch to Select mode'),
        },
        {
          keys: ['B'],
          action: t('sidebar.shortcuts.actions.switchToBuildMode', 'Switch to Build mode'),
        },
        {
          keys: ['Esc'],
          action: t(
            'sidebar.shortcuts.actions.cancelActiveTool',
            'Cancel the active tool and return to Select mode',
          ),
        },
        {
          keys: ['Delete / Backspace'],
          action: t('sidebar.shortcuts.actions.deleteSelectedObjects', 'Delete selected objects'),
        },
        { keys: ['Cmd/Ctrl', 'Z'], action: t('sidebar.shortcuts.actions.undo', 'Undo') },
        { keys: ['Cmd/Ctrl', 'Shift', 'Z'], action: t('sidebar.shortcuts.actions.redo', 'Redo') },
      ],
    },
    {
      id: 'selection',
      title: t('sidebar.shortcuts.categories.selection', 'Selection'),
      shortcuts: [
        {
          keys: ['Cmd/Ctrl', 'Left click'],
          action: t(
            'sidebar.shortcuts.actions.toggleMultiSelection',
            'Add or remove an object from multi-selection',
          ),
          note: t('sidebar.shortcuts.notes.worksInSelectMode', 'Works while in Select mode.'),
        },
      ],
    },
    {
      id: 'drawingTools',
      title: t('sidebar.shortcuts.categories.drawingTools', 'Drawing Tools'),
      shortcuts: [
        {
          keys: ['Shift'],
          action: t(
            'sidebar.shortcuts.actions.disableAngleSnapping',
            'Temporarily disable angle snapping while drawing walls, slabs, and ceilings',
          ),
          note: t('sidebar.shortcuts.notes.holdWhileDrawing', 'Hold while drawing.'),
        },
      ],
    },
    {
      id: 'itemPlacement',
      title: t('sidebar.shortcuts.categories.itemPlacement', 'Item Placement'),
      shortcuts: [
        {
          keys: ['R'],
          action: t(
            'sidebar.shortcuts.actions.rotateClockwiseOrToggleDoor',
            'Rotate item clockwise, or toggle selected door open/closed',
          ),
        },
        {
          keys: ['T'],
          action: t(
            'sidebar.shortcuts.actions.rotateCounterClockwiseOrCloseDoor',
            'Rotate item counter-clockwise, or close selected door',
          ),
        },
        {
          keys: ['Shift'],
          action: t(
            'sidebar.shortcuts.actions.bypassPlacementValidation',
            'Temporarily bypass placement validation constraints',
          ),
          note: t('sidebar.shortcuts.notes.holdWhilePlacing', 'Hold while placing.'),
        },
      ],
    },
    {
      id: 'camera',
      title: t('sidebar.shortcuts.categories.camera', 'Camera'),
      shortcuts: [
        {
          keys: ['Middle click'],
          action: t('sidebar.shortcuts.actions.panCamera', 'Pan camera'),
          note: t(
            'sidebar.shortcuts.notes.panCamera',
            'Drag with the middle mouse button, or hold Space while dragging with the left mouse button.',
          ),
        },
        {
          keys: ['Right click'],
          action: t('sidebar.shortcuts.actions.orbitCamera', 'Orbit camera'),
          note: t('sidebar.shortcuts.notes.orbitCamera', 'Drag with the right mouse button.'),
        },
      ],
    },
  ]
}

function getDisplayKey(key: string, isMac: boolean): string {
  if (key === 'Cmd/Ctrl') return isMac ? '⌘' : 'Ctrl'
  if (key === 'Delete / Backspace') return isMac ? '⌫' : 'Backspace'
  return KEY_DISPLAY_MAP[key] ?? key
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0)
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <div className="flex items-center gap-1" key={`${key}-${index}`}>
          {index > 0 ? <span className="text-[10px] text-muted-foreground">+</span> : null}
          <ShortcutToken displayValue={getDisplayKey(key, isMac)} value={key} />
        </div>
      ))}
    </div>
  )
}

export function KeyboardShortcutsDialog() {
  const shortcutCategories = getShortcutCategories()

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          <Keyboard className="size-4" />
          {t('sidebar.keyboardShortcuts', 'Keyboard Shortcuts')}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{t('sidebar.keyboardShortcuts', 'Keyboard Shortcuts')}</DialogTitle>
          <DialogDescription>
            {t(
              'sidebar.keyboardShortcutsDesc',
              'Shortcuts are context-aware and depend on the current phase or tool.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {shortcutCategories.map((category) => (
            <section className="space-y-2" key={category.id}>
              <h3 className="font-medium text-sm">{category.title}</h3>
              <div className="overflow-hidden rounded-md border border-border/80">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    className="grid grid-cols-[minmax(130px,220px)_1fr] gap-3 px-3 py-2"
                    key={`${category.id}-${index}`}
                  >
                    <ShortcutKeys keys={shortcut.keys} />
                    <div>
                      <p className="text-sm">{shortcut.action}</p>
                      {shortcut.note ? (
                        <p className="text-muted-foreground text-xs">{shortcut.note}</p>
                      ) : null}
                    </div>
                    {index < category.shortcuts.length - 1 ? (
                      <div className="col-span-2 border-border/60 border-b" />
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
