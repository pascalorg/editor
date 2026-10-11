import type { SlotDeclaration } from '../registry/types'

const ACCESSORY_DEFAULT = 'library:preset-softwhite'
export const CUPOLA_LOUVERS_DEFAULT = 'library:preset-metal'

export function boxVentSlots(): SlotDeclaration[] {
  return [
    { slotId: 'base', label: 'Base', default: ACCESSORY_DEFAULT },
    { slotId: 'top', label: 'Top', default: ACCESSORY_DEFAULT },
  ]
}

export function cupolaSlots(): SlotDeclaration[] {
  return [
    { slotId: 'base', label: 'Base', default: ACCESSORY_DEFAULT },
    { slotId: 'body', label: 'Body', default: ACCESSORY_DEFAULT },
    { slotId: 'roof', label: 'Roof', default: ACCESSORY_DEFAULT },
    { slotId: 'louvers', label: 'Louvers', default: CUPOLA_LOUVERS_DEFAULT },
  ]
}

export function eyebrowVentSlots(): SlotDeclaration[] {
  return [
    { slotId: 'hood', label: 'Hood', default: ACCESSORY_DEFAULT },
    { slotId: 'front', label: 'Louvers', default: ACCESSORY_DEFAULT },
  ]
}

export function turbineVentSlots(): SlotDeclaration[] {
  return [
    { slotId: 'base', label: 'Base', default: ACCESSORY_DEFAULT },
    { slotId: 'head', label: 'Head', default: ACCESSORY_DEFAULT },
  ]
}

export function gutterSlots(): SlotDeclaration[] {
  return [{ slotId: 'gutter', label: 'Gutter', default: ACCESSORY_DEFAULT }]
}

export function downspoutSlots(): SlotDeclaration[] {
  return [{ slotId: 'surface', label: 'Surface', default: ACCESSORY_DEFAULT }]
}
