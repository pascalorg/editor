import type { PascalI18n } from '@pascal-app/core'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import type { ContinuationMode } from './continuation'
import { openSidebarPanel } from './sidebar-panel'
import {
  getWallDrawVariantInfo,
  getWallLineKind,
  getWallTypeOverride,
  selectWallDrawVariant,
  setWallLineKind,
  setWallTypeOverride,
  type WallDrawVariant,
  type WallLineKind,
} from './wall-draw-variant'
import type { WallTypePlacement } from './wall-type'

/**
 * The single-key tools of the editor, and the keys tooltips print for them.
 *
 * The drafting tools (Door, Window, Stairs, Roof, Exterior and Interior wall)
 * sit on their own letter where it was free (I) and on Shift with
 * their letter where the bare key was taken: W/A/S/D pan the view in 2D and 3D,
 * R flips or rotates the selection and the armed placement, and E operates the
 * selected door, window or cabinet. Pan stands down for those Shift chords
 * (`claimsKeyboardPan`), and R/E still work bare as before.
 */
export type ToolShortcutId =
  | 'select'
  | 'delete'
  | 'wall'
  | 'item'
  | 'zone'
  | 'measurement'
  | 'paint'
  | 'terrain'
  | 'door'
  | 'window'
  | 'stair'
  | 'roof'
  | 'exterior-wall'
  | 'interior-wall'

type ArmedByChord = {
  /** `KeyboardEvent.code`: the physical key, as pan reads it. */
  code: string
  shift: boolean
}

/** Keys as `ShortcutToken` names them. */
export const TOOL_SHORTCUT_KEYS: Record<ToolShortcutId, readonly string[]> = {
  select: ['V'],
  delete: ['X'],
  wall: ['B'],
  item: ['F'],
  zone: ['Z'],
  measurement: ['M'],
  paint: ['P'],
  terrain: ['G'],
  door: ['Shift', 'D'],
  window: ['Shift', 'W'],
  stair: ['Shift', 'S'],
  roof: ['Shift', 'R'],
  'exterior-wall': ['Shift', 'E'],
  'interior-wall': ['I'],
}

/** The tools this module arms itself; the older keys stay in `use-keyboard`. */
const CHORDS: Partial<Record<ToolShortcutId, ArmedByChord>> = {
  door: { code: 'KeyD', shift: true },
  window: { code: 'KeyW', shift: true },
  stair: { code: 'KeyS', shift: true },
  roof: { code: 'KeyR', shift: true },
  'exterior-wall': { code: 'KeyE', shift: true },
  'interior-wall': { code: 'KeyI', shift: false },
}

/** A tool's shortcut as a tooltip prints it: `Shift+D`, `B`. Null for a tool without one. */
export function toolShortcutLabel(tool: string): string | null {
  const keys = TOOL_SHORTCUT_KEYS[tool as ToolShortcutId]
  return keys ? keys.join('+') : null
}

/** A tool's tooltip with its shortcut: `Door (Shift+D)`; the bare label when it has none. */
export function withToolShortcut(label: string, tool: string | undefined): string {
  const shortcut = tool ? toolShortcutLabel(tool) : null
  return shortcut ? `${label} (${shortcut})` : label
}

/**
 * A Rooms tile's tooltip with the keys that arm it: Rectangle is B; Walls is what
 * Shift+E (exterior walls) and I (interior walls) draw.
 */
export function wallVariantTooltip(variant: WallDrawVariant, i18n: PascalI18n): string {
  const title = i18n._(getWallDrawVariantInfo(variant).title)
  if (variant === 'rectangle') return withToolShortcut(title, 'wall')
  if (variant === 'walls')
    return i18n._({
      id: 'editor.lib.toolShortcuts.wallsTooltip',
      message: '{title} ({exterior} exterior, {interior} interior)',
      values: {
        title,
        exterior: toolShortcutLabel('exterior-wall'),
        interior: toolShortcutLabel('interior-wall'),
      },
    })
  return title
}

// Gestures a held Shift modifies (free move, free rotate, force place): a Shift
// chord there is part of the gesture, never a tool switch.
const SHIFT_GESTURE_SCOPES = new Set([
  'room-divide',
  'placing',
  'moving',
  'handle-drag',
  'mesh-editing',
  'reshaping',
  'box-select',
  'painting',
  'sculpting',
  'pointing',
])

/**
 * The tool a key press arms, or null: the physical key and Shift, with no other
 * modifier and no repeat. A Shift chord is off while a gesture holds Shift, so
 * Shift+WASD keeps panning there.
 */
export function toolShortcutForKey(
  event: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'repeat'>,
): ToolShortcutId | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return null
  const entry = Object.entries(CHORDS).find(
    ([, chord]) => chord.code === event.code && chord.shift === event.shiftKey,
  )
  if (!entry) return null
  if (event.shiftKey && SHIFT_GESTURE_SCOPES.has(useInteractionScope.getState().scope.kind))
    return null
  return entry[0] as ToolShortcutId
}

/** Whether WASD pan must leave this key to a tool shortcut (Shift+W/S/D). */
export function claimsKeyboardPan(
  event: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'repeat'>,
): boolean {
  // A held key repeats: once claimed, the repeats stay claimed too. (Fields one by
  // one: a DOM event's are getters a spread would drop.)
  return (
    event.shiftKey &&
    toolShortcutForKey({
      code: event.code,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      repeat: false,
    }) !== null
  )
}

/** Arm a build tool from the keyboard, as its Build panel tile does, with the panel showing. */
function armBuildTool(tool: string) {
  const editor = useEditor.getState()
  editor.setPhase('building')
  openSidebarPanel(['build'])
  // A raw tool, as a tile click arms it: no preset carried over from earlier.
  editor.setToolDefaults(tool, null)
  editor.armToolMode({ mode: 'build', tool })
}

// The saved Rooms shape an Exterior / Interior wall shortcut drew over, put back when its walls
// end: the shortcut's Walls shape is for that run, not a new Rooms choice.
let shapeBeforeWallShortcut: ContinuationMode | null = null

/**
 * Arm the tool `id` names. Exterior and Interior wall draw single walls (the Walls
 * shape) with that Build panel wall type wherever they land, until the wall tool
 * is left or its shape changed.
 */
export function armToolShortcut(id: ToolShortcutId): void {
  if (id === 'exterior-wall' || id === 'interior-wall') {
    armWallTypeTool(id === 'exterior-wall' ? 'exterior' : 'interior')
    return
  }
  armBuildTool(id)
}

/**
 * The Exterior / Interior wall tool, from its shortcut or its Rooms tile: single walls
 * (the Walls shape) of that placement's Build panel type and finish wherever they land,
 * until the wall tool is left or its shape changed; leaving puts the Rooms shape back.
 * `arm` arms the wall tool as the host's tiles do (by default as the shortcut does).
 */
export function armWallTypeTool(
  placement: WallTypePlacement,
  arm: () => void = () => armBuildTool('wall'),
): void {
  const shape = useEditor.getState().getContinuation('wall')
  selectWallDrawVariant('walls')
  arm()
  shapeBeforeWallShortcut ??= shape
  setWallTypeOverride(placement)
}

/**
 * The Invisible wall or Railing tool, from its Rooms tile: runs of invisible walls (room
 * separators no wall stands on, room dividers) or of railings, drawn with the
 * wall tool's Walls shape, until the wall tool is left or its shape changed; leaving puts the
 * Rooms shape back. `arm` arms the wall tool as the host's tiles do.
 */
export function armWallLineTool(
  kind: WallLineKind,
  arm: () => void = () => armBuildTool('wall'),
): void {
  const shape = useEditor.getState().getContinuation('wall')
  selectWallDrawVariant('walls')
  arm()
  shapeBeforeWallShortcut ??= shape
  setWallLineKind(kind)
}

/**
 * Drops the Exterior / Interior wall override (or the Invisible wall / Railing line kind) once the
 * wall tool is left or reshaped. Leaving puts the Rooms shape the shortcut replaced back; a shape
 * picked in the tool stays.
 */
export function subscribeWallTypeOverrideReset(): () => void {
  return useEditor.subscribe((state) => {
    const inWallTool = state.mode === 'build' && state.tool === 'wall'
    if (inWallTool && state.getContinuation('wall') === 'single') return
    const restore =
      !inWallTool && (getWallTypeOverride() !== null || getWallLineKind() !== null)
        ? shapeBeforeWallShortcut
        : null
    shapeBeforeWallShortcut = null
    setWallTypeOverride(null)
    if (restore) state.setContinuation('wall', restore)
  })
}
