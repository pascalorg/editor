import { type SlotDeclaration, WALL_SLOT_DEFAULT } from '@pascal-app/core'

/**
 * A wall exposes two paintable faces — interior + exterior. Painting writes
 * `node.slots[interior|exterior]` via `wallPaint` like every other kind; this
 * declaration surfaces the slot list + declared defaults for the picker and
 * keeps walls on the same `{ slotId, label, default }` contract. The defaults
 * come from core so the viewer's material resolver renders the identical value.
 */
export function wallSlots(): SlotDeclaration[] {
  return [
    { slotId: 'interior', label: 'Interior', default: WALL_SLOT_DEFAULT.interior },
    { slotId: 'exterior', label: 'Exterior', default: WALL_SLOT_DEFAULT.exterior },
  ]
}
