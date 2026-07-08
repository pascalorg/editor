import { type SlotDeclaration, WALL_SURFACE_SLOT_DEFAULTS } from '@pascal-app/core'

/**
 * A wall exposes two paintable faces — interior + exterior. Painting writes
 * `node.slots[interior|exterior]` via `wallPaint` like every other kind; this
 * declaration surfaces the slot list + declared defaults for the picker and
 * keeps walls on the same `{ slotId, label, default }` contract. The defaults
 * come from core so the viewer's material resolver renders the identical value.
 */
export function wallSlots(): SlotDeclaration[] {
  return [
    { slotId: 'interior', label: 'Interior', default: WALL_SURFACE_SLOT_DEFAULTS.interior },
    { slotId: 'exterior', label: 'Exterior', default: WALL_SURFACE_SLOT_DEFAULTS.exterior },
    {
      slotId: 'lowerInterior',
      label: 'Lower band (interior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.lowerInterior,
    },
    {
      slotId: 'middleInterior',
      label: 'Middle band (interior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.middleInterior,
    },
    {
      slotId: 'upperInterior',
      label: 'Upper band (interior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.upperInterior,
    },
    {
      slotId: 'lowerExterior',
      label: 'Lower band (exterior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.lowerExterior,
    },
    {
      slotId: 'middleExterior',
      label: 'Middle band (exterior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.middleExterior,
    },
    {
      slotId: 'upperExterior',
      label: 'Upper band (exterior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.upperExterior,
    },
    {
      slotId: 'skirtingInterior',
      label: 'Skirting (interior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.skirtingInterior,
    },
    {
      slotId: 'skirtingExterior',
      label: 'Skirting (exterior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.skirtingExterior,
    },
    {
      slotId: 'crownInterior',
      label: 'Crown (interior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.crownInterior,
    },
    {
      slotId: 'crownExterior',
      label: 'Crown (exterior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.crownExterior,
    },
    {
      slotId: 'chairRailInterior',
      label: 'Chair rail (interior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.chairRailInterior,
    },
    {
      slotId: 'chairRailExterior',
      label: 'Chair rail (exterior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.chairRailExterior,
    },
  ]
}
