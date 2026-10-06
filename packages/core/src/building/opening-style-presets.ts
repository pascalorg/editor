/**
 * Style presets for doors and windows.
 *
 * Each preset is a small bag of property overrides applied on top of the
 * DoorNode / WindowNode schema defaults. Used by `add_door`, `add_window`,
 * and `create_room`'s inline doors[] / windows[] arrays so the AI (and the
 * dev tester) can pick a recognisable look by name instead of having to
 * spell out segment configurations or pane ratios.
 */

import type { DoorSegment } from '../schema'

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

interface DoorStyleOverrides {
  segments?: DoorSegment[]
  contentPadding?: [number, number]
}

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

export function getDoorStyleOverrides(style: DoorStyle | undefined): DoorStyleOverrides {
  if (!style || style === 'panel') {
    // Schema default — two raised panels stacked.
    return {}
  }
  if (style === 'glass') {
    return { segments: [panelSegment('glass', 1)] }
  }
  if (style === 'modern') {
    // A flush slab: one panel over the whole leaf. An 'empty' segment is no leaf at all (run 4's
    // front door rendered as an open frame).
    return {
      segments: [panelSegment('panel', 1, [1], { panelDepth: 0, panelInset: 0 })],
      contentPadding: [0, 0],
    }
  }
  if (style === 'paneled-glass') {
    return {
      segments: [panelSegment('glass', 0.55), panelSegment('panel', 0.45)],
    }
  }
  if (style === 'french') {
    return { segments: [panelSegment('glass', 1, [0.5, 0.5])] }
  }
  if (style === 'shaker') {
    return {
      segments: [panelSegment('panel', 1, [1], { panelDepth: -0.005, panelInset: 0.06 })],
    }
  }
  if (style === 'six-panel') {
    return {
      segments: [
        panelSegment('panel', 0.34, [0.5, 0.5]),
        panelSegment('panel', 0.33, [0.5, 0.5]),
        panelSegment('panel', 0.33, [0.5, 0.5]),
      ],
    }
  }
  if (style === 'craftsman') {
    return {
      segments: [
        panelSegment('panel', 0.25),
        panelSegment('panel', 0.25),
        panelSegment('panel', 0.25),
        panelSegment('panel', 0.25),
      ],
    }
  }
  if (style === 'half-louvered') {
    // Slats as narrow raised bars on the top half: an 'empty' row would be a hole in the leaf.
    // The door system always raises a panel by |panelDepth|, so a slat reads only when it is
    // deep and narrow against its gap: ten bars about 7 cm tall, 2.2 cm proud, 2.8 cm apart.
    const slat = panelSegment('panel', 0.5 / 10, [1], { panelDepth: 0.022, panelInset: 0.014 })
    return { segments: [...Array.from({ length: 10 }, () => slat), panelSegment('panel', 0.5)] }
  }
  if (style === 'barn') {
    return {
      segments: [panelSegment('panel', 1, [1], { panelDepth: -0.02, panelInset: 0.08 })],
    }
  }
  return {}
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
