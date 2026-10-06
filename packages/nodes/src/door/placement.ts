// The door tool's placement choices: the chips [O] Type and [L] Style (L67).

import type { DoorNode, ToolHint } from '@pascal-app/core'
import {
  DOOR_STYLE_LABELS,
  DOOR_STYLES,
  DOOR_TYPE_SIZES,
  type DoorStyle,
  doorStyleLook,
  doorTypeFields,
} from '@pascal-app/core/building'
import { create } from 'zustand'

/** The door panel's Type row and the tool's Type chip (garage types live under the panel's Garage). */
export const doorTypeOptions = [
  { label: 'Hinged', value: 'hinged', available: true },
  { label: 'Double', value: 'double', available: true },
  { label: 'French', value: 'french', available: true },
  { label: 'Folding', value: 'folding', available: true },
  { label: 'Pocket', value: 'pocket', available: true },
  { label: 'Barn', value: 'barn', available: true },
  { label: 'Sliding', value: 'sliding', available: true },
] satisfies {
  label: string
  value: DoorNode['doorType']
  available: boolean
}[]

type PlacedDoorType = (typeof doorTypeOptions)[number]['value']

type DoorPlacementState = {
  type: PlacedDoorType
  style: DoorStyle
  cycleType(): void
  cycleStyle(): void
}

const next = <T>(list: readonly T[], value: T) => list[(list.indexOf(value) + 1) % list.length]!

export const useDoorPlacement = create<DoorPlacementState>((set, get) => ({
  type: 'hinged',
  style: 'panel',
  cycleType: () =>
    set({
      type: next(
        doorTypeOptions.map((option) => option.value),
        get().type,
      ),
    }),
  cycleStyle: () => set({ style: next(DOOR_STYLES, get().style) }),
}))

/** The door the tool places: the chips' type and style, written as add_door and the panel write them. */
export function placedDoorFields(): Partial<DoorNode> {
  const { type, style } = useDoorPlacement.getState()
  return { ...doorTypeFields(type), ...DOOR_TYPE_SIZES[type], ...doorStyleLook(style) }
}

export const DOOR_PLACEMENT_HINTS: ToolHint[] = [
  {
    key: 'O',
    label: 'Type',
    chip: {
      subscribe: (onChange) => useDoorPlacement.subscribe(onChange),
      value: () => useDoorPlacement.getState().type,
      cycle: () => useDoorPlacement.getState().cycleType(),
      labels: Object.fromEntries(
        doorTypeOptions.map((option) => [option.value, `Type: ${option.label}`]),
      ),
      tooltip: 'Door type — click or press O to cycle',
    },
  },
  {
    key: 'L',
    label: 'Style',
    chip: {
      subscribe: (onChange) => useDoorPlacement.subscribe(onChange),
      value: () => useDoorPlacement.getState().style,
      cycle: () => useDoorPlacement.getState().cycleStyle(),
      labels: Object.fromEntries(
        DOOR_STYLES.map((style) => [style, `Style: ${DOOR_STYLE_LABELS[style]}`]),
      ),
      tooltip: 'Door style — click or press L to cycle',
    },
  },
]
