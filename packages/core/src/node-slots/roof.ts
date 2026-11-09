import type { SlotDeclaration } from '../registry/types'
import { getRoofGlazing, isGlazedRoofSegment } from '../schema/nodes/roof-glazing'
import type { RoofSegmentNode } from '../schema/nodes/roof-segment'
export const GLAZED_ROOF_SLOTS = ['glazing-frame', 'glazing-glass', 'glazing-solid'] as const
export function roofSegmentSlots(node: RoofSegmentNode): SlotDeclaration[] {
  if (!isGlazedRoofSegment(node)) return []
  const config = getRoofGlazing(node)
  return GLAZED_ROOF_SLOTS.map((slotId, index) => ({
    slotId,
    label: ['Frame', 'Glass', 'Solid panels'][index]!,
    default: index === 1 ? config.glassColor : config.frameColor,
  }))
}
