import type { ProceduralItemNode } from '../procedural-items/node'
import type { SlotDeclaration } from '../registry/types'

export function proceduralItemSlots(node: ProceduralItemNode): SlotDeclaration[] {
  return node.recipe.slots.map((s) => ({ slotId: s.id, label: s.label, default: s.color }))
}
