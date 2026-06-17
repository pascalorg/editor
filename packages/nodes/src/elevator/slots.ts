import {
  type ElevatorNode,
  getResolvedElevatorDoorPanelStyle,
  getResolvedElevatorShaftStyle,
  type SlotDeclaration,
} from '@pascal-app/core'

export type ElevatorSlotId = 'cab' | 'doors' | 'shaft' | 'glass'

export const ELEVATOR_CAB_SLOT_DEFAULT = 'library:preset-softwhite'
export const ELEVATOR_DOORS_SLOT_DEFAULT = 'library:metal-steel'
export const ELEVATOR_SHAFT_SLOT_DEFAULT = 'library:preset-lightgrey'
export const ELEVATOR_GLASS_SLOT_DEFAULT = 'library:preset-glass'

export function elevatorSlots(node: ElevatorNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'cab', label: 'Cab', default: ELEVATOR_CAB_SLOT_DEFAULT },
    { slotId: 'doors', label: 'Doors', default: ELEVATOR_DOORS_SLOT_DEFAULT },
    { slotId: 'shaft', label: 'Shaft', default: ELEVATOR_SHAFT_SLOT_DEFAULT },
  ]

  const hasGlass =
    getResolvedElevatorShaftStyle(node.shaftStyle) === 'glass' ||
    getResolvedElevatorDoorPanelStyle(node.doorPanelStyle) === 'glass-frame'

  if (hasGlass)
    slots.push({ slotId: 'glass', label: 'Glass', default: ELEVATOR_GLASS_SLOT_DEFAULT })

  return slots
}
