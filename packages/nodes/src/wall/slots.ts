import {
  getCurtainWallConfig,
  type SlotDeclaration,
  WALL_SURFACE_SLOT_DEFAULTS,
  type WallNode,
} from '@pascal-app/core'

/**
 * A wall exposes two paintable faces — `a` (left of start → end) and `b` —
 * plus a skirting, crown and chair rail per face. Painting writes
 * `node.slots[slotId]` via `wallPaint` like every other kind; this declaration
 * surfaces the slot list + declared defaults for the picker and keeps walls on
 * the same `{ slotId, label, default }` contract. Paint regions and room
 * finishes are not slots: they live on `faceRegions` and on the zone.
 */
export function wallSlots(node?: WallNode): SlotDeclaration[] {
  if (node?.wallType === 'curtain') {
    const config = getCurtainWallConfig(node)
    return [
      { slotId: 'curtain-frame', label: 'Frame', default: config.frameColor },
      { slotId: 'curtain-glass', label: 'Glass', default: config.glassColor },
      { slotId: 'curtain-solid', label: 'Solid panels', default: config.solidColor },
    ]
  }
  return [
    { slotId: 'a', label: 'Side A', default: WALL_SURFACE_SLOT_DEFAULTS.a },
    { slotId: 'b', label: 'Side B', default: WALL_SURFACE_SLOT_DEFAULTS.b },
    {
      slotId: 'aSkirting',
      label: 'Skirting (side A)',
      default: WALL_SURFACE_SLOT_DEFAULTS.aSkirting,
    },
    {
      slotId: 'bSkirting',
      label: 'Skirting (side B)',
      default: WALL_SURFACE_SLOT_DEFAULTS.bSkirting,
    },
    { slotId: 'aCrown', label: 'Crown (side A)', default: WALL_SURFACE_SLOT_DEFAULTS.aCrown },
    { slotId: 'bCrown', label: 'Crown (side B)', default: WALL_SURFACE_SLOT_DEFAULTS.bCrown },
    {
      slotId: 'aChairRail',
      label: 'Chair rail (side A)',
      default: WALL_SURFACE_SLOT_DEFAULTS.aChairRail,
    },
    {
      slotId: 'bChairRail',
      label: 'Chair rail (side B)',
      default: WALL_SURFACE_SLOT_DEFAULTS.bChairRail,
    },
  ]
}
