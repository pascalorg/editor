import { Keyboard } from 'lucide-react'
import { useTranslations } from '../../../../../lib/i18n'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'
import {
  ShortcutToken,
  shortcutDisplayValue,
} from './../../../../../components/ui/primitives/shortcut-token'

type Shortcut = {
  keys: string[]
  actionKey: string
  noteKey?: string
}

type ShortcutCategory = {
  titleKey: string
  shortcuts: Shortcut[]
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    titleKey: 'shortcuts.editorNavigation',
    shortcuts: [
      { keys: ['1'], actionKey: 'shortcuts.switchToSitePhase' },
      { keys: ['2'], actionKey: 'shortcuts.switchToStructurePhase' },
      { keys: ['3'], actionKey: 'shortcuts.switchToFurnishPhase' },
      { keys: ['F'], actionKey: 'shortcuts.switchToFurnishLayer' },
      { keys: ['Z'], actionKey: 'shortcuts.switchToZonesLayer' },
      {
        keys: ['Cmd/Ctrl', 'Arrow Up'],
        actionKey: 'shortcuts.selectNextLevel',
      },
      {
        keys: ['Cmd/Ctrl', 'Arrow Down'],
        actionKey: 'shortcuts.selectPreviousLevel',
      },
      { keys: ['Cmd/Ctrl', 'B'], actionKey: 'shortcuts.toggleSidebar' },
    ],
  },
  {
    titleKey: 'shortcuts.modesAndHistory',
    shortcuts: [
      { keys: ['V'], actionKey: 'shortcuts.switchToSelectMode' },
      { keys: ['B'], actionKey: 'shortcuts.switchToBuildMode' },
      { keys: ['M'], actionKey: 'shortcuts.activateMeasurementTool' },
      { keys: ['X'], actionKey: 'shortcuts.switchToDeleteMode' },
      {
        keys: ['Esc'],
        actionKey: 'shortcuts.cancelTool',
        noteKey: 'shortcuts.cancelToolNote',
      },
      { keys: ['Delete / Backspace'], actionKey: 'shortcuts.deleteSelected' },
      { keys: ['Cmd/Ctrl', 'Z'], actionKey: 'shortcuts.undo' },
      { keys: ['Cmd/Ctrl', 'Shift', 'Z'], actionKey: 'shortcuts.redo' },
    ],
  },
  {
    titleKey: 'shortcuts.selection',
    shortcuts: [
      {
        keys: ['Cmd/Ctrl', 'C'],
        actionKey: 'shortcuts.copySelection',
        noteKey: 'shortcuts.copySelectionNote',
      },
      {
        keys: ['Cmd/Ctrl', 'X'],
        actionKey: 'shortcuts.cutSelection',
        noteKey: 'shortcuts.cutSelectionNote',
      },
      {
        keys: ['Cmd/Ctrl', 'V'],
        actionKey: 'shortcuts.pasteSelection',
        noteKey: 'shortcuts.pasteSelectionNote',
      },
      {
        keys: ['Cmd/Ctrl', 'Left click'],
        actionKey: 'shortcuts.addToSelection',
        noteKey: 'shortcuts.addToSelectionNote',
      },
      {
        keys: ['Shift', 'Left click'],
        actionKey: 'shortcuts.addToCanvasSelection',
        noteKey: 'shortcuts.addToCanvasSelectionNote',
      },
      {
        keys: ['Left click'],
        actionKey: 'shortcuts.moveMultiSelection',
        noteKey: 'shortcuts.moveMultiSelectionNote',
      },
      {
        keys: ['R', 'T'],
        actionKey: 'shortcuts.rotateMultiSelection',
        noteKey: 'shortcuts.rotateMultiSelectionNote',
      },
      {
        keys: ['Cmd/Ctrl', 'G'],
        actionKey: 'shortcuts.groupSelection',
        noteKey: 'shortcuts.groupSelectionNote',
      },
      {
        keys: ['Cmd/Ctrl', 'Shift', 'G'],
        actionKey: 'shortcuts.ungroupSelection',
        noteKey: 'shortcuts.ungroupSelectionNote',
      },
      {
        keys: ['Esc'],
        actionKey: 'shortcuts.clearSelection',
        noteKey: 'shortcuts.clearSelectionNote',
      },
    ],
  },
  {
    titleKey: 'shortcuts.directManipulation',
    shortcuts: [
      {
        keys: ['Cmd/Ctrl', 'Left click'],
        actionKey: 'shortcuts.moveUnderCursor',
        noteKey: 'shortcuts.moveUnderCursorNote',
      },
      {
        keys: ['Cmd/Ctrl', 'Right click'],
        actionKey: 'shortcuts.rotateUnderCursor',
        noteKey: 'shortcuts.rotateUnderCursorNote',
      },
      {
        keys: ['Cmd/Ctrl', 'Shift', 'Right click'],
        actionKey: 'shortcuts.rotateFreely',
        noteKey: 'shortcuts.rotateFreelyNote',
      },
    ],
  },
  {
    titleKey: 'shortcuts.drawingTools',
    shortcuts: [
      // Shift and Ctrl each mean one thing held and another tapped, and only
      // the hold was documented — which read as the taps not existing. Both
      // taps are listed first because they are the ones nobody discovers.
      {
        keys: ['Shift'],
        actionKey: 'shortcuts.cycleSnapMode',
        noteKey: 'shortcuts.cycleSnapModeNote',
      },
      {
        keys: ['Cmd/Ctrl'],
        actionKey: 'shortcuts.cycleGridStep',
        noteKey: 'shortcuts.cycleGridStepNote',
      },
      {
        keys: ['Shift'],
        actionKey: 'shortcuts.bypassGuidedConstraints',
        noteKey: 'shortcuts.bypassGuidedConstraintsNote',
      },
      {
        keys: ['Shift'],
        actionKey: 'shortcuts.bypassRotationSnap',
        noteKey: 'shortcuts.bypassRotationSnapNote',
      },
    ],
  },
  {
    titleKey: 'shortcuts.itemPlacement',
    shortcuts: [
      {
        keys: ['R', 'T'],
        actionKey: 'shortcuts.rotateItemOrToggleDoor',
      },
      {
        keys: ['E'],
        actionKey: 'shortcuts.operateSelectedNode',
      },
      {
        keys: ['Shift'],
        actionKey: 'shortcuts.bypassPlacementValidation',
        noteKey: 'shortcuts.holdWhilePlacing',
      },
    ],
  },
  {
    titleKey: 'shortcuts.camera',
    shortcuts: [
      {
        keys: ['W', 'A', 'S', 'D'],
        actionKey: 'shortcuts.panCamera',
        noteKey: 'shortcuts.panCameraNote',
      },
      {
        keys: ['Middle click'],
        actionKey: 'shortcuts.panCameraMiddle',
        noteKey: 'shortcuts.dragMiddleMouseOrHoldSpace',
      },
      {
        keys: ['Right click'],
        actionKey: 'shortcuts.orbitCamera',
        noteKey: 'shortcuts.dragRightMouse',
      },
    ],
  },
]

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <div className="flex items-center gap-1" key={`${key}-${index}`}>
          {index > 0 ? <span className="text-[10px] text-muted-foreground">+</span> : null}
          <ShortcutToken displayValue={shortcutDisplayValue(key)} value={key} />
        </div>
      ))}
    </div>
  )
}

export function KeyboardShortcutsDialog() {
  const t = useTranslations()
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          <Keyboard className="size-4" />
          {t('shortcuts.keyboardShortcuts')}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{t('shortcuts.keyboardShortcuts')}</DialogTitle>
          <DialogDescription>
            {t('shortcuts.contextAware')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {SHORTCUT_CATEGORIES.map((category) => (
            <section className="space-y-2" key={category.titleKey}>
              <h3 className="font-medium text-sm">{t(category.titleKey)}</h3>
              <div className="overflow-hidden rounded-md border border-border/80">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    className="grid grid-cols-[minmax(130px,220px)_1fr] gap-3 px-3 py-2"
                    key={`${category.titleKey}-${shortcut.actionKey}`}
                  >
                    <ShortcutKeys keys={shortcut.keys} />
                    <div>
                      <p className="text-sm">{t(shortcut.actionKey)}</p>
                      {shortcut.noteKey ? (
                        <p className="text-muted-foreground text-xs">{t(shortcut.noteKey)}</p>
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
