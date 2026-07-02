import type { SlotDeclaration } from '@pascal-app/core'

export type CabinetSlotId =
  | 'front'
  | 'carcass'
  | 'countertop'
  | 'plinth'
  | 'hardware'
  | 'glass'
  | 'appliance'
  | 'applianceInterior'

const FRONT_DEFAULT = 'library:preset-softwhite'
const CARCASS_DEFAULT = 'library:preset-softwhite'
const COUNTERTOP_DEFAULT = 'library:wood-finewood27'
const PLINTH_DEFAULT = 'library:preset-softwhite'
const HARDWARE_DEFAULT = 'library:metal-chrome'
const GLASS_DEFAULT = 'library:preset-glass'
const APPLIANCE_DEFAULT = 'library:metal-steel'
const APPLIANCE_INTERIOR_DEFAULT = 'library:preset-charcoal'

export function cabinetSlots(): SlotDeclaration[] {
  return [
    { slotId: 'front', label: 'Front', default: FRONT_DEFAULT },
    { slotId: 'carcass', label: 'Carcass', default: CARCASS_DEFAULT },
    { slotId: 'countertop', label: 'Countertop', default: COUNTERTOP_DEFAULT },
    { slotId: 'plinth', label: 'Plinth', default: PLINTH_DEFAULT },
    { slotId: 'hardware', label: 'Hardware', default: HARDWARE_DEFAULT },
    { slotId: 'glass', label: 'Glass', default: GLASS_DEFAULT },
    { slotId: 'appliance', label: 'Appliance', default: APPLIANCE_DEFAULT },
    {
      slotId: 'applianceInterior',
      label: 'Appliance Interior',
      default: APPLIANCE_INTERIOR_DEFAULT,
    },
  ]
}
