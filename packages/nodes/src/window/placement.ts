// The window tool's placement choices: the chips [O] Type and [L] Style.

import type { ToolHint, WindowNode } from '@pascal-app/core'
import {
  getWindowStyleOverrides,
  SILLLESS_WINDOW_TYPES,
  WINDOW_STYLE_CHOICES,
  WINDOW_STYLE_LABELS,
  type WindowStyle,
  windowTakesStyle,
  windowTypeFields,
} from '@pascal-app/core/building'
import { create } from 'zustand'

/** The window panel's Window Type row and the tool's Type chip. */
export const windowTypeOptions: Array<{ label: string; value: WindowNode['windowType'] }> = [
  { label: 'Fixed', value: 'fixed' },
  { label: 'Sliding', value: 'sliding' },
  { label: 'Casement', value: 'casement' },
  { label: 'Awning', value: 'awning' },
  { label: 'Single Hung', value: 'single-hung' },
  { label: 'Double Hung', value: 'double-hung' },
  { label: 'Bay', value: 'bay' },
  { label: 'Bow', value: 'bow' },
  { label: 'Louvered', value: 'louvered' },
]

type WindowPlacementState = {
  type: WindowNode['windowType']
  style: WindowStyle
  cycleType(): void
  cycleStyle(): void
}

const next = <T>(list: readonly T[], value: T) => list[(list.indexOf(value) + 1) % list.length]!

export const useWindowPlacement = create<WindowPlacementState>((set, get) => ({
  type: 'fixed',
  style: 'single',
  cycleType: () =>
    set({
      type: next(
        windowTypeOptions.map((option) => option.value),
        get().type,
      ),
    }),
  cycleStyle: () => set({ style: next(WINDOW_STYLE_CHOICES, get().style) }),
}))

/**
 * The window the tool places: the chips' type and style, as the panel writes them. The draft takes
 * these by merge and the tool has no sill control, so the type always says whether there is a sill:
 * cycled past Bay or Bow, a Fixed window would otherwise keep their "no sill".
 */
export function placedWindowFields(): Partial<WindowNode> {
  const { type, style } = useWindowPlacement.getState()
  return {
    ...windowTypeFields(type),
    sill: !SILLLESS_WINDOW_TYPES.has(type),
    ...(windowTakesStyle(type) ? getWindowStyleOverrides(style) : {}),
  }
}

export const WINDOW_PLACEMENT_HINTS: ToolHint[] = [
  {
    key: 'O',
    label: 'Type',
    chip: {
      subscribe: (onChange) => useWindowPlacement.subscribe(onChange),
      value: () => useWindowPlacement.getState().type,
      cycle: () => useWindowPlacement.getState().cycleType(),
      labels: Object.fromEntries(
        windowTypeOptions.map((option) => [option.value, `Type: ${option.label}`]),
      ),
      tooltip: 'Window type — click or press O to cycle',
    },
  },
  {
    key: 'L',
    label: 'Style',
    // Shown only while the tool places a Fixed window, the one type a style shapes.
    visible: {
      subscribe: (onChange) => useWindowPlacement.subscribe(onChange),
      value: () => windowTakesStyle(useWindowPlacement.getState().type),
    },
    chip: {
      subscribe: (onChange) => useWindowPlacement.subscribe(onChange),
      value: () => useWindowPlacement.getState().style,
      cycle: () => useWindowPlacement.getState().cycleStyle(),
      labels: Object.fromEntries(
        WINDOW_STYLE_CHOICES.map((style) => [style, `Style: ${WINDOW_STYLE_LABELS[style]}`]),
      ),
      tooltip: 'Window style — click or press L to cycle',
    },
  },
]
