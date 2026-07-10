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

type Shortcut = {
  keys: string[]
  action: string
  note?: string
}

type ShortcutCategory = {
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

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'Editor Navigation',
    shortcuts: [
      { keys: ['1'], action: 'Switch to Site phase' },
      { keys: ['2'], action: 'Switch to Structure phase' },
      { keys: ['3'], action: 'Switch to Furnish phase' },
      { keys: ['F'], action: 'Switch to Furnish layer' },
      { keys: ['Z'], action: 'Switch to Zones layer' },
      {
        keys: ['Cmd/Ctrl', 'Arrow Up'],
        action: 'Select next level in the active building',
      },
      {
        keys: ['Cmd/Ctrl', 'Arrow Down'],
        action: 'Select previous level in the active building',
      },
      { keys: ['Cmd/Ctrl', 'B'], action: 'Toggle sidebar' },
    ],
  },
  {
    title: 'Modes & History',
    shortcuts: [
      { keys: ['V'], action: 'Switch to Select mode' },
      { keys: ['B'], action: 'Switch to Build mode' },
      { keys: ['X'], action: 'Switch to Delete mode' },
      {
        keys: ['Esc'],
        action: 'Cancel the active tool and return to Select mode',
      },
      { keys: ['Delete / Backspace'], action: 'Delete selected objects' },
      { keys: ['Cmd/Ctrl', 'Z'], action: 'Undo' },
      { keys: ['Cmd/Ctrl', 'Shift', 'Z'], action: 'Redo' },
    ],
  },
  {
    title: 'Selection',
    shortcuts: [
      {
        keys: ['Cmd/Ctrl', 'Left click'],
        action: 'Add or remove an object from multi-selection',
        note: 'Works in Select mode on the 3D canvas, the 2D floor plan, and the scene graph.',
      },
      {
        keys: ['Shift', 'Left click'],
        action: 'Add or remove an object from canvas multi-selection',
        note: 'In the scene graph, Shift-click selects the visible range like a file browser.',
      },
      {
        keys: ['Left click'],
        action: 'Move the whole multi-selection',
        note:
          'With 2+ objects selected, in 2D and 3D alike: drag the selection (or its dashed box) to slide it; click it to pick it up and place with the next click.',
      },
      {
        keys: ['R', 'T'],
        action: 'Rotate a multi-selection ±45° around its center',
        note: 'Also works mid-move while carrying the selection.',
      },
      {
        keys: ['Esc'],
        action: 'Clear the selection',
        note: 'Clicking empty space does the same.',
      },
    ],
  },
  {
    title: 'Direct Manipulation',
    shortcuts: [
      {
        keys: ['Cmd/Ctrl', 'Left click'],
        action: 'Move the selected movable object under the cursor',
        note: 'Drag in Select mode with a single object selected. Guided snapping and guides are enabled by default.',
      },
      {
        keys: ['Cmd/Ctrl', 'Right click'],
        action: 'Rotate the selected object under the cursor',
        note: 'Drag left or right in Select mode with a single object selected. Rotation snaps to 15° increments by default.',
      },
      {
        keys: ['Cmd/Ctrl', 'Shift', 'Right click'],
        action: 'Rotate freely',
        note: 'Hold Shift during the drag to bypass the 15° rotation increment.',
      },
    ],
  },
  {
    title: 'Drawing Tools',
    shortcuts: [
      {
        keys: ['Shift'],
        action: 'Bypass guided snapping and angle constraints',
        note: 'Hold during the active gesture. Passive guide or measurement feedback may stay visible.',
      },
      {
        keys: ['Shift'],
        action: 'Rotate freely, bypassing the default 15° rotation snap',
        note: 'Hold while dragging a rotate handle or direct-rotation gesture.',
      },
    ],
  },
  {
    title: 'Item Placement',
    shortcuts: [
      { keys: ['R', 'T'], action: 'Rotate item; with a door selected, R toggles open/closed and T closes' },
      {
        keys: ['Shift'],
        action: 'Temporarily bypass placement validation constraints',
        note: 'Hold while placing.',
      },
    ],
  },
  {
    title: 'Camera',
    shortcuts: [
      {
        keys: ['W', 'A', 'S', 'D'],
        action: 'Pan camera',
        note: 'Moves in screen space, similar to dragging the camera view.',
      },
      {
        keys: ['Middle click'],
        action: 'Pan camera',
        note: 'Drag with the middle mouse button, or hold Space while dragging with the left mouse button.',
      },
      {
        keys: ['Right click'],
        action: 'Orbit camera',
        note: 'Drag with the right mouse button.',
      },
    ],
  },
]

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
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          <Keyboard className="size-4" />
          Keyboard Shortcuts
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are context-aware. Guided constraints are enabled by default; hold Shift
            during an active gesture to build freely.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {SHORTCUT_CATEGORIES.map((category) => (
            <section className="space-y-2" key={category.title}>
              <h3 className="font-medium text-sm">{category.title}</h3>
              <div className="overflow-hidden rounded-md border border-border/80">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    className="grid grid-cols-[minmax(130px,220px)_1fr] gap-3 px-3 py-2"
                    key={`${category.title}-${shortcut.action}`}
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
