import { type SlotDeclaration, WALL_SLOT_DEFAULT } from '@pascal-app/core'

/**
 * A wall exposes two paintable faces — interior + exterior. Painting still
 * writes the legacy `interiorMaterial*` / `exteriorMaterial*` fields via
 * `wallPaint` (the inline model isn't migrated to `node.slots` yet); this
 * declaration surfaces the slot list + declared defaults for the picker and
 * keeps walls on the same `{ slotId, label, default }` contract as every other
 * paintable kind. The defaults come from core so the viewer's material
 * resolver renders the identical value.
 */
export function wallSlots(): SlotDeclaration[] {
  return [
    { slotId: 'interior', label: 'Interior', default: WALL_SLOT_DEFAULT.interior },
    { slotId: 'exterior', label: 'Exterior', default: WALL_SLOT_DEFAULT.exterior },
  ]
}
