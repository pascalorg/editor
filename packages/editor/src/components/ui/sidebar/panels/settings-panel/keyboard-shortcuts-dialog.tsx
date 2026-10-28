import { type MessageDescriptor, usePascalI18n } from '@pascal-app/core'
import { Keyboard } from 'lucide-react'
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
import { TOOL_SHORTCUT_KEYS } from './../../../../../lib/tool-shortcuts'

type Shortcut = {
  keys: readonly string[]
  action: string
  note?: string
}

type ShortcutCategory = {
  title: MessageDescriptor
  shortcuts: Shortcut[]
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: /* i18n */ {
      id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.editorNavigation',
      message: 'Editor Navigation',
    },
    shortcuts: [
      { keys: ['1'], action: 'Switch to Site' },
      { keys: ['2'], action: 'Switch to Building' },
      { keys: ['\\'], action: 'Open or close the split view' },
      { keys: TOOL_SHORTCUT_KEYS.item, action: 'Open the items catalog with the item tool' },
      { keys: TOOL_SHORTCUT_KEYS.zone, action: 'Draw a zone' },
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
    title: /* i18n */ {
      id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.modesHistory',
      message: 'Modes & History',
    },
    shortcuts: [
      { keys: TOOL_SHORTCUT_KEYS.select, action: 'Switch to Select mode' },
      { keys: TOOL_SHORTCUT_KEYS.wall, action: 'Switch to Build mode, drawing a rectangle room' },
      { keys: TOOL_SHORTCUT_KEYS.measurement, action: 'Activate the last measurement tool' },
      { keys: TOOL_SHORTCUT_KEYS.paint, action: 'Switch to Paint mode' },
      { keys: TOOL_SHORTCUT_KEYS.terrain, action: 'Sculpt the ground (terrain)' },
      { keys: TOOL_SHORTCUT_KEYS.delete, action: 'Switch to Delete mode' },
      {
        keys: ['Esc'],
        action: 'Cancel the active tool and return to Select mode',
        note: 'Mid-draw it cancels only the chain in progress and keeps the tool armed; press it again to leave the tool.',
      },
      { keys: ['Delete / Backspace'], action: 'Delete selected objects' },
      { keys: ['Cmd/Ctrl', 'Z'], action: 'Undo' },
      { keys: ['Cmd/Ctrl', 'Shift', 'Z'], action: 'Redo' },
      { keys: ['Cmd/Ctrl', 'S'], action: 'Save' },
    ],
  },
  {
    title: /* i18n */ {
      id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.buildTools',
      message: 'Build Tools',
    },
    shortcuts: [
      {
        keys: TOOL_SHORTCUT_KEYS['exterior-wall'],
        action: 'Draw exterior walls',
        note: 'Draws with the Walls shape, each wall with the exterior wall type picked in the Build panel. E alone still opens or closes the selected door or window.',
      },
      {
        keys: TOOL_SHORTCUT_KEYS['interior-wall'],
        action: 'Draw interior walls',
        note: 'Draws with the Walls shape, each wall with the interior wall type picked in the Build panel.',
      },
      {
        keys: TOOL_SHORTCUT_KEYS.door,
        action: 'Place a door',
        note: 'D alone pans the view. While placing, the door swings toward the side of the wall the cursor is on; R flips it.',
      },
      { keys: TOOL_SHORTCUT_KEYS.window, action: 'Place a window', note: 'W alone pans the view.' },
      { keys: TOOL_SHORTCUT_KEYS.stair, action: 'Place stairs', note: 'S alone pans the view.' },
      {
        keys: TOOL_SHORTCUT_KEYS.roof,
        action: 'Draw a roof',
        note: "R alone still rotates or flips the selection, and while placing it stays the placement's own R.",
      },
    ],
  },
  {
    title: /* i18n */ {
      id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.selection',
      message: 'Selection',
    },
    shortcuts: [
      {
        keys: ['Cmd/Ctrl', 'C'],
        action: 'Copy the selected objects',
        note: 'The copied selection can be pasted into another level, project, or browser tab.',
      },
      {
        keys: ['Cmd/Ctrl', 'X'],
        action: 'Cut the selected objects',
        note: 'Copies the selection to the clipboard, then removes it from this scene.',
      },
      {
        keys: ['Cmd/Ctrl', 'V'],
        action: 'Paste and place copied objects',
        note: 'Carries a preview under the cursor. Click to place it, or press Escape to cancel.',
      },
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
        keys: ['Left drag'],
        action: 'Move the whole multi-selection',
        note: 'With 2+ objects selected, in 2D and 3D alike: drag the selection (or its dashed box) to slide it. A click alone never starts a move; use Move in the action menu to pick it up.',
      },
      {
        keys: ['R', 'T'],
        action: 'Rotate a multi-selection ±45° around its center',
        note: 'Also works mid-move while carrying the selection.',
      },
      {
        keys: ['Cmd/Ctrl', 'G'],
        action: 'Group the multi-selection (session only)',
        note: 'Editor-only. Plain click a member later to reselect the whole group. Not saved with the project.',
      },
      {
        keys: ['Cmd/Ctrl', 'Shift', 'G'],
        action: 'Ungroup the session selection',
        note: 'Keeps the current selection; only dissolves the session group.',
      },
      {
        keys: ['Arrow keys'],
        action: 'Nudge the selected wall 1 in (1 cm in metric)',
        note: 'In the floor plan. Stops where it lines up with a parallel wall; joined walls follow.',
      },
      {
        keys: ['Tab'],
        action: 'Select the next object under the pointer',
        note: 'In the floor plan, for walls that overlap or hide under another. Shift+Tab goes back.',
      },
      {
        keys: ['Esc'],
        action: 'Clear the selection',
        note: 'Clicking empty space does the same.',
      },
    ],
  },
  {
    title: /* i18n */ {
      id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.directManipulation',
      message: 'Direct Manipulation',
    },
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
    title: /* i18n */ {
      id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.drawingTools',
      message: 'Drawing Tools',
    },
    shortcuts: [
      // Shift and Ctrl each mean one thing held and another tapped, and only
      // the hold was documented — which read as the taps not existing. Both
      // taps are listed first because they are the ones nobody discovers.
      {
        keys: ['Shift'],
        action: 'Cycle the snapping mode',
        note: 'Tap and release without pressing anything else, while a drawing or move gesture is available.',
      },
      {
        keys: ['Cmd/Ctrl'],
        action: 'Cycle the grid step: 0.5 m → 0.25 m → 0.1 m → 0.05 m',
        note: 'Tap and release on its own. Use it when the default half-metre grid is too coarse — placing a window, for instance.',
      },
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
    title: /* i18n */ {
      id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.itemPlacement',
      message: 'Item Placement',
    },
    shortcuts: [
      {
        keys: ['R', 'T'],
        action: 'Rotate item; with a door selected, R toggles open/closed and T closes',
      },
      {
        keys: ['E'],
        action:
          'Operate the selected node — doors, windows, and cabinet doors/drawers animate open/closed',
      },
      {
        keys: ['Shift'],
        action: 'Temporarily bypass placement validation constraints',
        note: 'Hold while placing.',
      },
    ],
  },
  {
    title: /* i18n */ {
      id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.camera',
      message: 'Camera',
    },
    shortcuts: [
      {
        keys: ['W', 'A', 'S', 'D'],
        action: 'Pan camera',
        note: 'Moves in screen space, similar to dragging the camera view. With Shift, W, S and D place a window, stairs and a door instead.',
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

function ShortcutKeys({ keys }: { keys: readonly string[] }) {
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
  const i18n = usePascalI18n()
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          <Keyboard className="size-4" />
          {i18n._({
            id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.keyboardShortcuts',
            message: 'Keyboard shortcuts',
          })}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>
            {i18n._({
              id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.keyboardShortcuts',
              message: 'Keyboard shortcuts',
            })}
          </DialogTitle>
          <DialogDescription>
            {i18n._({
              id: 'editor.sidebar.panels.settingsPanel.keyboardShortcutsDialog.shortcutsAreContextAwareGuidedConstraints',
              message:
                'Shortcuts are context-aware. Guided constraints are enabled by default; hold Shift during an active gesture to build freely.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {SHORTCUT_CATEGORIES.map((category) => (
            <section className="space-y-2" key={category.title.id}>
              <h3 className="font-medium text-sm">{i18n._(category.title)}</h3>
              <div className="overflow-hidden rounded-md border border-border/80">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    className="grid grid-cols-[minmax(130px,220px)_1fr] gap-3 px-3 py-2"
                    key={`${category.title.id}-${shortcut.action}`}
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
