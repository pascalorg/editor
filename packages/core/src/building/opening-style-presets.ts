/**
 * Style presets for doors and windows: what a door's leaf or a window's panes look like, never how
 * it opens (doorType, windowType) or its size. `add_door`, `add_window` and `create_room`'s
 * doors[] / windows[] apply them by name; the door and window panels show them as their Style row
 * and read a node's style back from its fields.
 */

import type { DoorSegment } from '../schema'
import { DEFAULT_DOOR_CONTENT_PADDING, defaultDoorSegments } from '../schema/nodes/opening-types'

// ── Doors ────────────────────────────────────────────────────────────────────

export const DOOR_STYLES = [
  'panel',
  'glass',
  'modern',
  'paneled-glass',
  'french',
  'shaker',
  'six-panel',
  'craftsman',
  'half-louvered',
  'barn',
] as const
export type DoorStyle = (typeof DOOR_STYLES)[number]

export const DOOR_STYLE_DESCRIPTIONS: Record<DoorStyle, string> = {
  panel: 'Classic raised-panel door (default).',
  glass: 'Mostly glass; modern interior or patio door.',
  modern: 'Flat slab, no panels, no glass — minimalist look.',
  'paneled-glass': 'Glass top, panel bottom — common entry door.',
  french: 'Two narrow vertical glass leaves — French door look.',
  shaker: 'Single flat panel with a clean inset — minimalist.',
  'six-panel': 'Classic 6-panel (3 rows × 2 columns) — traditional interior.',
  craftsman: '4 narrow vertical raised panels stacked — craftsman style.',
  'half-louvered': 'Top half horizontal slats, bottom half panel — closet / laundry.',
  barn: 'Wide single recessed panel — sliding-barn look.',
}

/** The Style row's labels; the stored and agent value is the style itself. */
export const DOOR_STYLE_LABELS: Record<DoorStyle, string> = {
  panel: 'Panel',
  glass: 'Glass',
  modern: 'Modern',
  'paneled-glass': 'Paneled glass',
  french: 'French',
  shaker: 'Shaker',
  'six-panel': 'Six-panel',
  craftsman: 'Craftsman',
  'half-louvered': 'Half-louvered',
  barn: 'Barn',
}

/** Every field a door style owns. */
export type DoorStyleLook = { segments: DoorSegment[]; contentPadding: [number, number] }

const PANEL_DIVIDER = 0.03
const PANEL_DEPTH = 0.01
const PANEL_INSET = 0.04

function panelSegment(
  type: 'panel' | 'glass' | 'empty',
  heightRatio: number,
  columnRatios: number[] = [1],
  overrides: Partial<DoorSegment> = {},
): DoorSegment {
  return {
    type,
    heightRatio,
    columnRatios,
    dividerThickness: PANEL_DIVIDER,
    panelDepth: PANEL_DEPTH,
    panelInset: PANEL_INSET,
    ...overrides,
  }
}

const look = (
  segments: DoorSegment[],
  contentPadding: [number, number] = DEFAULT_DOOR_CONTENT_PADDING,
): DoorStyleLook => ({ segments, contentPadding: [...contentPadding] })

/**
 * A door style's whole look: applied, it replaces the last style's (a panel door after a modern one
 * gets its margin back), and the panel reads a style back by these fields alone.
 */
export function doorStyleLook(style: DoorStyle): DoorStyleLook {
  switch (style) {
    case 'panel':
      return look(defaultDoorSegments())
    case 'glass':
      return look([panelSegment('glass', 1)])
    case 'modern':
      // A flush slab: one panel over the whole leaf. An 'empty' segment is no leaf at all (a front
      // door once rendered as an open frame).
      return look([panelSegment('panel', 1, [1], { panelDepth: 0, panelInset: 0 })], [0, 0])
    case 'paneled-glass':
      return look([panelSegment('glass', 0.55), panelSegment('panel', 0.45)])
    case 'french':
      return look([panelSegment('glass', 1, [0.5, 0.5])])
    case 'shaker':
      return look([panelSegment('panel', 1, [1], { panelDepth: -0.005, panelInset: 0.06 })])
    case 'six-panel':
      return look([0.34, 0.33, 0.33].map((ratio) => panelSegment('panel', ratio, [0.5, 0.5])))
    case 'craftsman':
      return look([0.25, 0.25, 0.25, 0.25].map((ratio) => panelSegment('panel', ratio)))
    case 'half-louvered':
      // Slats as narrow raised bars on the top half: an 'empty' row would be a hole in the leaf.
      // The door system always raises a panel by |panelDepth|, so a slat reads only when it is
      // deep and narrow against its gap: ten bars about 7 cm tall, 2.2 cm proud, 2.8 cm apart.
      return look([
        ...Array.from({ length: 10 }, () =>
          panelSegment('panel', 0.5 / 10, [1], { panelDepth: 0.022, panelInset: 0.014 }),
        ),
        panelSegment('panel', 0.5),
      ])
    case 'barn':
      return look([panelSegment('panel', 1, [1], { panelDepth: -0.02, panelInset: 0.08 })])
  }
}

const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, i) => same(value, b[i]))
  if (a && b && typeof a === 'object' && typeof b === 'object')
    return Object.keys({ ...a, ...b }).every((key) =>
      same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  return a === b
}

/** The styles a door's leaf is, in list order: none for a leaf made by hand (the panel's Custom). */
export function doorStylesOf(door: DoorStyleLook): DoorStyle[] {
  const { segments, contentPadding } = door
  return DOOR_STYLES.filter((style) => same(doorStyleLook(style), { segments, contentPadding }))
}

// ── Windows ──────────────────────────────────────────────────────────────────

export const WINDOW_STYLES = [
  'single',
  'double-hung',
  'triple-hung',
  'casement',
  'sliding',
  'grid',
  'tall-grid',
  'wide-grid',
  'horizontal-bands',
  'transom',
  'picture',
] as const
export type WindowStyle = (typeof WINDOW_STYLES)[number]

export const WINDOW_STYLE_DESCRIPTIONS: Record<WindowStyle, string> = {
  single: 'Single pane with a frame — simplest look (default).',
  'double-hung': 'Two stacked sashes — classic American style.',
  'triple-hung': 'Three stacked sashes — taller and slimmer.',
  casement: 'Two side-by-side panes — vertical mullion.',
  sliding: 'Three side-by-side panes — wide / sliding-door look.',
  grid: '2×2 grid of panes — colonial / cottage style.',
  'tall-grid': '2 columns × 3 rows — taller proportions.',
  'wide-grid': '3 columns × 2 rows — wider proportions.',
  'horizontal-bands': '4 stacked horizontal bands — modernist strip window.',
  transom: 'Short row on top + larger pane below — transom over a base.',
  picture: 'Large fixed pane, no internal divisions.',
}

/** The Style row's labels; the stored and agent value is the style itself. */
export const WINDOW_STYLE_LABELS: Record<WindowStyle, string> = {
  single: 'Single',
  'double-hung': 'Double-hung',
  'triple-hung': 'Triple-hung',
  casement: 'Casement',
  sliding: 'Sliding',
  grid: 'Grid',
  'tall-grid': 'Tall grid',
  'wide-grid': 'Wide grid',
  'horizontal-bands': 'Horizontal bands',
  transom: 'Transom',
  picture: 'Picture',
}

interface WindowStyleOverrides {
  columnRatios?: number[]
  rowRatios?: number[]
}

export function getWindowStyleOverrides(style: WindowStyle | undefined): WindowStyleOverrides {
  if (!style || style === 'single' || style === 'picture') {
    return { columnRatios: [1], rowRatios: [1] }
  }
  if (style === 'double-hung') {
    return { columnRatios: [1], rowRatios: [0.5, 0.5] }
  }
  if (style === 'triple-hung') {
    return { columnRatios: [1], rowRatios: [1 / 3, 1 / 3, 1 / 3] }
  }
  if (style === 'casement') {
    return { columnRatios: [0.5, 0.5], rowRatios: [1] }
  }
  if (style === 'sliding') {
    return { columnRatios: [1 / 3, 1 / 3, 1 / 3], rowRatios: [1] }
  }
  if (style === 'grid') {
    return { columnRatios: [0.5, 0.5], rowRatios: [0.5, 0.5] }
  }
  if (style === 'tall-grid') {
    return { columnRatios: [0.5, 0.5], rowRatios: [1 / 3, 1 / 3, 1 / 3] }
  }
  if (style === 'wide-grid') {
    return { columnRatios: [1 / 3, 1 / 3, 1 / 3], rowRatios: [0.5, 0.5] }
  }
  if (style === 'horizontal-bands') {
    return { columnRatios: [1], rowRatios: [0.25, 0.25, 0.25, 0.25] }
  }
  if (style === 'transom') {
    // Smaller transom row on top, larger main pane below.
    return { columnRatios: [1], rowRatios: [0.3, 0.7] }
  }
  return {}
}

/** The styles a window's panes are, in list order: single and picture draw the same; none by hand. */
export function windowStylesOf(window: {
  columnRatios: number[]
  rowRatios: number[]
}): WindowStyle[] {
  const { columnRatios, rowRatios } = window
  return WINDOW_STYLES.filter((style) =>
    same(getWindowStyleOverrides(style), { columnRatios, rowRatios }),
  )
}
