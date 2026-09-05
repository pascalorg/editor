/**
 * The Poppy — PlanCrafters' 792 sf 2-bed / 1-bath ADU (adu-templates.js §12),
 * authored here as a plan DOCUMENT rather than as code: 24' × 33', the living
 * room across the street front, an open dining/kitchen band with the bath on
 * the left, two bedrooms with the laundry closet between them at the back.
 * Front-to-back gable at 9:12, iron-black lap siding, cedar front, metal roof.
 * Room boundaries are wall centrelines; `y` runs from the FRONT.
 */
import type { PlanDocument } from '../document'

export const POPPY: PlanDocument = {
  roomcode: 1,
  name: 'The Poppy',
  units: 'ft',
  mode: 'adu',
  style: 'modern',
  ceiling: 9,
  roof: { form: 'gable', pitch: 9, overhang: 14 / 12, gables: ['front', 'back'] },
  rooms: [
    { name: 'LIVING', kind: 'living', x: 0, y: 0, w: 24, d: 14, floor: 'LVP' },
    { name: 'BATH', kind: 'bath', x: 0, y: 14, w: 7, d: 8, floor: 'TILE' },
    { name: 'DINING', kind: 'dining', x: 7, y: 14, w: 7, d: 8, floor: 'LVP' },
    { name: 'KITCHEN', kind: 'kitchen', x: 14, y: 14, w: 10, d: 8, floor: 'LVP' },
    { name: 'BEDROOM 1', kind: 'bed', x: 0, y: 22, w: 10.5, d: 11, primary: true, floor: 'LVP' },
    { name: 'LAUNDRY', kind: 'laundry', x: 10.5, y: 22, w: 3, d: 11, floor: 'TILE' },
    { name: 'BEDROOM 2', kind: 'bed', x: 13.5, y: 22, w: 10.5, d: 11, floor: 'LVP' },
  ],
  attach: [
    ['LIVING', 'DINING', 'zone'],
    ['LIVING', 'KITCHEN', 'zone'],
    ['DINING', 'KITCHEN', 'zone'],
    ['LIVING', 'BATH', 'door'],
    ['DINING', 'BEDROOM 1', 'door'],
    ['KITCHEN', 'BEDROOM 2', 'door'],
    ['DINING', 'LAUNDRY', 'door'],
  ],
  frontDoor: 'LIVING',
  finishes: { siding: 'lap_black', roofMat: 'metal_gray' },
}

export const TEMPLATES: readonly { id: string; label: string; summary: string; document: PlanDocument }[] = [
  {
    id: 'poppy',
    label: 'The Poppy',
    summary: '792 sf · 2 bd / 1 ba · front-to-back gable, black lap siding',
    document: POPPY,
  },
]
