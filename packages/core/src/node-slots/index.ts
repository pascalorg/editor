import type { SlotDeclaration } from '../registry/types'
import type { AnyNode } from '../schema/types'
import { blockSlots } from './block'
import { cabinetSlots } from './cabinet'
import { ceilingSlots } from './ceiling'
import { columnSlots } from './column'
import { doorSlots } from './door'
import { ductBodySlots } from './duct'
import { elevatorSlots } from './elevator'
import { fenceSlots } from './fence'
import { leanToSlots } from './lean-to-extension'
import { proceduralItemSlots } from './procedural-item'
import {
  boxVentSlots,
  cupolaSlots,
  downspoutSlots,
  eyebrowVentSlots,
  gutterSlots,
  turbineVentSlots,
} from './roof-accessories'
import { shelfSlots } from './shelf'
import { slabSlots } from './slab'
import { stairSlots } from './stair'
import { wallSlots } from './wall'
import { windowSlots } from './window'

export * from './block'
export * from './cabinet'
export * from './ceiling'
export * from './column'
export * from './door'
export * from './duct'
export * from './elevator'
export * from './fence'
export * from './lean-to-extension'
export * from './procedural-item'
export * from './roof-accessories'
export * from './shelf'
export * from './slab'
export * from './stair'
export * from './wall'
export * from './window'

/**
 * The paintable slots a node exposes — the keys its `slots` may carry. A node
 * built from a script exposes its manifest's slots. Null for a kind that
 * declares none here (an item's slots come from its GLB).
 */
export function nodeSlotDeclarations(node: AnyNode): SlotDeclaration[] | null {
  const source = (node as { source?: { manifest?: { slots?: { id: string; label?: string }[] } } })
    .source
  if (source?.manifest?.slots) {
    return source.manifest.slots.map((slot) => ({ slotId: slot.id, label: slot.label ?? slot.id }))
  }
  switch (node.type) {
    case 'block':
      return blockSlots(node)
    case 'box-vent':
      return boxVentSlots()
    case 'cabinet':
    case 'cabinet-module':
      return cabinetSlots()
    case 'ceiling':
      return ceilingSlots()
    case 'column':
      return columnSlots(node)
    case 'cupola':
      return cupolaSlots()
    case 'door':
      return doorSlots()
    case 'downspout':
      return downspoutSlots()
    case 'duct-fitting':
    case 'duct-segment':
      return ductBodySlots()
    case 'elevator':
      return elevatorSlots(node)
    case 'eyebrow-vent':
      return eyebrowVentSlots()
    case 'fence':
      return fenceSlots(node)
    case 'gutter':
      return gutterSlots()
    case 'lean-to-extension':
      return leanToSlots()
    case 'procedural-item':
      return proceduralItemSlots(node)
    case 'shelf':
      return shelfSlots(node)
    case 'slab':
      return slabSlots()
    case 'stair':
      return stairSlots(node)
    case 'turbine-vent':
      return turbineVentSlots()
    case 'wall':
      return wallSlots(node)
    case 'window':
      return windowSlots()
    default:
      return null
  }
}
