import type { SlotDeclaration } from '@pascal-app/core'

export type CabinetSlotId = 'front' | 'carcass' | 'countertop' | 'plinth' | 'hardware'

const FRONT_DEFAULT = 'library:preset-softwhite'
const CARCASS_DEFAULT = 'library:preset-softwhite'
const COUNTERTOP_DEFAULT = 'library:wood-finewood27'
const PLINTH_DEFAULT = 'library:preset-softwhite'
const HARDWARE_DEFAULT = 'library:metal-chrome'

export function cabinetSlots(): SlotDeclaration[] {
  return [
    { slotId: 'front', label: 'Front', default: FRONT_DEFAULT },
    { slotId: 'carcass', label: 'Carcass', default: CARCASS_DEFAULT },
    { slotId: 'countertop', label: 'Countertop', default: COUNTERTOP_DEFAULT },
    { slotId: 'plinth', label: 'Plinth', default: PLINTH_DEFAULT },
    { slotId: 'hardware', label: 'Hardware', default: HARDWARE_DEFAULT },
  ]
}
