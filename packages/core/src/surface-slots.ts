import type { SlotDeclaration } from './registry/types'
import type { AnyNode } from './schema'
import {
  type ColumnNode,
  type ElevatorNode,
  type FenceNode,
  type ShelfNode,
  type StairNode,
  WALL_SURFACE_SLOT_DEFAULTS,
} from './schema'
import {
  getResolvedElevatorDoorPanelStyle,
  getResolvedElevatorShaftStyle,
} from './systems/elevator/elevator-geometry'

/**
 * Which surfaces of a node can be painted, and what each looks like unpainted.
 *
 * A kind's `NodeDefinition.slots` reads from here rather than declaring its own
 * list. The declarations used to live one per kind folder in `packages/nodes`,
 * which put them out of reach of everything below that layer — the MCP server
 * in particular, whose node registry is empty because nothing registers kinds
 * server-side. An agent could therefore build geometry but had no way to learn
 * that a wall paints through `interior` / `exterior`. Domain data belongs in
 * core anyway; the alternative was a second hand-written table, which is the
 * thing that goes stale.
 *
 * `default` is either a catalog ref (`library:<id>`) or a `#rrggbb` colour.
 */

export type WallSlotId = keyof typeof WALL_SURFACE_SLOT_DEFAULTS

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
      slotId: 'topInterior',
      label: 'Top band (interior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.topInterior,
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
      slotId: 'topExterior',
      label: 'Top band (exterior)',
      default: WALL_SURFACE_SLOT_DEFAULTS.topExterior,
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

export type SlabSlotId = 'surface' | 'side'

// Declared default appearances for an unpainted slab in colored mode — a
// catalog `library:<id>` finish or a `#rrggbb` colour. Textures-off collapses
// both to the themed floor role (the escape hatch).
//
// `surface` (top face) keeps the wood floor default and the slot id used before
// the top/side split, so existing painted slabs keep their floor finish. `side`
// (walls + underside) defaults to a light grey so a slab's edges read as a
// distinct trim rather than wood end-grain.
export const SLAB_TOP_SLOT_DEFAULT = 'library:wood-woodplank48'
export const SLAB_SIDE_SLOT_DEFAULT = '#cccccc'

/**
 * A slab exposes two paintable faces: the top floor surface and its sides
 * (vertical walls + underside).
 */
export function slabSlots(): SlotDeclaration[] {
  return [
    { slotId: 'surface', label: 'Top', default: SLAB_TOP_SLOT_DEFAULT },
    { slotId: 'side', label: 'Sides', default: SLAB_SIDE_SLOT_DEFAULT },
  ]
}

export type CeilingSlotId = 'surface'

// Soft white — the default underside colour for an unpainted ceiling. (A
// ceiling renders flat-tinted, so this is a colour, not a `library:` finish.)
export const CEILING_SLOT_DEFAULT_COLOR = '#f2eee6'

/** A ceiling exposes a single paintable underside surface. */
export function ceilingSlots(): SlotDeclaration[] {
  return [{ slotId: 'surface', label: 'Surface', default: CEILING_SLOT_DEFAULT_COLOR }]
}

export type DoorSlotId = 'panel' | 'frame' | 'glass' | 'hardware'

// Picker swatches. Rendering falls back to the live body/glass/hardware defaults
// (which already track shading + theme), so these are just the indicator colours.
const DOOR_PANEL_DEFAULT = 'library:preset-softwhite'
const DOOR_FRAME_DEFAULT = 'library:preset-softwhite'
const DOOR_GLASS_DEFAULT = 'library:preset-glass'
// Chrome — a flat (non-PBR) catalog metal finish.
const DOOR_HARDWARE_DEFAULT = 'library:metal-chrome'

/**
 * A door exposes four paintable slots: `panel` (leaf faces), `frame`, `glass`,
 * and `hardware` (handle / hinges / closer / panic bar). The opening reveal
 * keeps its own material.
 */
export function doorSlots(): SlotDeclaration[] {
  return [
    { slotId: 'panel', label: 'Panel', default: DOOR_PANEL_DEFAULT },
    { slotId: 'frame', label: 'Frame', default: DOOR_FRAME_DEFAULT },
    { slotId: 'glass', label: 'Glass', default: DOOR_GLASS_DEFAULT },
    { slotId: 'hardware', label: 'Hardware', default: DOOR_HARDWARE_DEFAULT },
  ]
}

export type WindowSlotId = 'frame' | 'glass'

const WINDOW_FRAME_DEFAULT = 'library:preset-softwhite'
const WINDOW_GLASS_DEFAULT = 'library:preset-glass'

/** A window exposes two paintable slots: the joinery frame and the glass. */
export function windowSlots(): SlotDeclaration[] {
  return [
    { slotId: 'frame', label: 'Frame', default: WINDOW_FRAME_DEFAULT },
    { slotId: 'glass', label: 'Glass', default: WINDOW_GLASS_DEFAULT },
  ]
}

export type ColumnSlotId = 'shaft' | 'base' | 'capital' | 'frame'

export const COLUMN_SHAFT_DEFAULT = 'library:concrete-plaster'
export const COLUMN_BASE_DEFAULT = 'library:concrete-plaster'
export const COLUMN_CAPITAL_DEFAULT = 'library:concrete-plaster'
export const COLUMN_FRAME_DEFAULT = 'library:metal-steel'

/** Omit `node` for every slot the kind can ever expose, whatever its styling. */
export function columnSlots(node?: ColumnNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'shaft', label: 'Shaft', default: COLUMN_SHAFT_DEFAULT },
  ]

  if (node?.baseStyle !== 'none') {
    slots.push({ slotId: 'base', label: 'Base', default: COLUMN_BASE_DEFAULT })
  }

  if (node?.capitalStyle !== 'none') {
    slots.push({ slotId: 'capital', label: 'Capital', default: COLUMN_CAPITAL_DEFAULT })
  }

  if (node?.supportStyle !== 'vertical') {
    slots.push({ slotId: 'frame', label: 'Frame', default: COLUMN_FRAME_DEFAULT })
  }

  return slots
}

export type StairSlotId = 'treads' | 'body' | 'railing'

export const STAIR_TREADS_SLOT_DEFAULT = 'library:wood-woodplank48'
export const STAIR_BODY_SLOT_DEFAULT = 'library:preset-lightgrey'
export const STAIR_RAILING_SLOT_DEFAULT = 'library:metal-steel'

export function stairSlots(node?: StairNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'treads', label: 'Treads', default: STAIR_TREADS_SLOT_DEFAULT },
    { slotId: 'body', label: 'Body', default: STAIR_BODY_SLOT_DEFAULT },
  ]

  if (!node || (node.railingMode && node.railingMode !== 'none')) {
    slots.push({ slotId: 'railing', label: 'Railing', default: STAIR_RAILING_SLOT_DEFAULT })
  }

  return slots
}

// Slots map 1:1 to the fence panel's build options: the end posts, the infill
// slats (the showInfill toggle), the base kickboard, and the top rail.
export type FenceSlotId = 'posts' | 'infill' | 'base' | 'rail'

export const FENCE_POSTS_SLOT_DEFAULT = 'library:preset-charcoal'
export const FENCE_INFILL_SLOT_DEFAULT = 'library:preset-charcoal'
export const FENCE_BASE_SLOT_DEFAULT = 'library:preset-greige'
export const FENCE_RAIL_SLOT_DEFAULT = 'library:preset-greige'

export const FENCE_SLOT_DEFAULTS: Record<FenceSlotId, string> = {
  posts: FENCE_POSTS_SLOT_DEFAULT,
  infill: FENCE_INFILL_SLOT_DEFAULT,
  base: FENCE_BASE_SLOT_DEFAULT,
  rail: FENCE_RAIL_SLOT_DEFAULT,
}

export function fenceSlots(node?: FenceNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'posts', label: 'Posts', default: FENCE_POSTS_SLOT_DEFAULT },
  ]
  if (node?.showInfill !== false) {
    slots.push({ slotId: 'infill', label: 'Infill', default: FENCE_INFILL_SLOT_DEFAULT })
  }
  if (node?.baseStyle !== 'floating') {
    slots.push({ slotId: 'base', label: 'Base', default: FENCE_BASE_SLOT_DEFAULT })
  }
  slots.push({ slotId: 'rail', label: 'Rail', default: FENCE_RAIL_SLOT_DEFAULT })
  return slots
}

export type ElevatorSlotId = 'cab' | 'doors' | 'shaft' | 'glass'

export const ELEVATOR_CAB_SLOT_DEFAULT = 'library:preset-softwhite'
export const ELEVATOR_DOORS_SLOT_DEFAULT = 'library:metal-steel'
export const ELEVATOR_SHAFT_SLOT_DEFAULT = 'library:preset-lightgrey'
export const ELEVATOR_GLASS_SLOT_DEFAULT = 'library:preset-glass'

export function elevatorSlots(node?: ElevatorNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'cab', label: 'Cab', default: ELEVATOR_CAB_SLOT_DEFAULT },
    { slotId: 'doors', label: 'Doors', default: ELEVATOR_DOORS_SLOT_DEFAULT },
    { slotId: 'shaft', label: 'Shaft', default: ELEVATOR_SHAFT_SLOT_DEFAULT },
  ]

  const hasGlass =
    !node ||
    getResolvedElevatorShaftStyle(node.shaftStyle) === 'glass' ||
    getResolvedElevatorDoorPanelStyle(node.doorPanelStyle) === 'glass-frame'

  if (hasGlass)
    slots.push({ slotId: 'glass', label: 'Glass', default: ELEVATOR_GLASS_SLOT_DEFAULT })

  return slots
}

export type CabinetSlotId =
  | 'front'
  | 'carcass'
  | 'countertop'
  | 'plinth'
  | 'hardware'
  | 'glass'
  | 'appliance'
  | 'applianceInterior'

const CABINET_FRONT_DEFAULT = 'library:preset-softwhite'
const CABINET_CARCASS_DEFAULT = 'library:preset-softwhite'
const CABINET_COUNTERTOP_DEFAULT = 'library:wood-finewood27'
const CABINET_PLINTH_DEFAULT = 'library:preset-softwhite'
const CABINET_HARDWARE_DEFAULT = 'library:metal-chrome'
const CABINET_GLASS_DEFAULT = 'library:preset-glass'
const CABINET_APPLIANCE_DEFAULT = 'library:metal-steel'
const CABINET_APPLIANCE_INTERIOR_DEFAULT = 'library:preset-charcoal'

export function cabinetSlots(): SlotDeclaration[] {
  return [
    { slotId: 'front', label: 'Front', default: CABINET_FRONT_DEFAULT },
    { slotId: 'carcass', label: 'Carcass', default: CABINET_CARCASS_DEFAULT },
    { slotId: 'countertop', label: 'Countertop', default: CABINET_COUNTERTOP_DEFAULT },
    { slotId: 'plinth', label: 'Plinth', default: CABINET_PLINTH_DEFAULT },
    { slotId: 'hardware', label: 'Hardware', default: CABINET_HARDWARE_DEFAULT },
    { slotId: 'glass', label: 'Glass', default: CABINET_GLASS_DEFAULT },
    { slotId: 'appliance', label: 'Appliance', default: CABINET_APPLIANCE_DEFAULT },
    {
      slotId: 'applianceInterior',
      label: 'Appliance Interior',
      default: CABINET_APPLIANCE_INTERIOR_DEFAULT,
    },
  ]
}

export type ShelfSlotId = 'shelves' | 'frame' | 'back'

// Visual parity with the retired DEFAULT_SHELF_MATERIAL (off-white).
export const SHELF_SLOT_DEFAULT_COLOR = '#ffffff'

/** Which slots a given shelf actually exposes (depends on style/flags). */
export function shelfSlots(node?: ShelfNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'shelves', label: 'Shelves', default: SHELF_SLOT_DEFAULT_COLOR },
  ]
  const hasFrame = !node || !(node.style === 'wall-shelf' && node.bracketStyle === 'hidden')
  if (hasFrame) slots.push({ slotId: 'frame', label: 'Frame', default: SHELF_SLOT_DEFAULT_COLOR })
  const hasBack = !node || node.style === 'cubby' || (node.style === 'bookshelf' && node.withBack)
  if (hasBack) slots.push({ slotId: 'back', label: 'Back', default: SHELF_SLOT_DEFAULT_COLOR })
  return slots
}

export const DUCT_BODY_SLOT_ID = 'body'
export const DUCT_BODY_SLOT_DEFAULT = '#ffffff'

export function ductBodySlots(): SlotDeclaration[] {
  return [{ slotId: DUCT_BODY_SLOT_ID, label: 'Body', default: DUCT_BODY_SLOT_DEFAULT }]
}

/**
 * The paintable surfaces of any node, without going through the node registry.
 *
 * The registry answer (`nodeRegistry.get(type)?.slots`) is the one the editor
 * uses and stays authoritative — a plugin kind can only be found there. This is
 * for the layers that have no registry: it covers every built-in kind that
 * declares slots, and returns `[]` for the rest.
 *
 * `item` is deliberately absent: an item's slots come from the `slot_` material
 * names inside its GLB, so they are per-asset and unknowable from the schema.
 */
export function surfaceSlotsFor(node: AnyNode): SlotDeclaration[] {
  return slotsFor(node.type, node)
}

/**
 * Every slot a kind can expose, named by type alone.
 *
 * The per-node answer hides slots the current styling has switched off — a
 * column with no capital has no `capital` slot. Callers that only have a type
 * name (the MCP schema index) want the full set instead, because a slot written
 * now applies the moment the styling turns that part back on.
 */
export function surfaceSlotsForKind(type: string): SlotDeclaration[] {
  return slotsFor(type)
}

function slotsFor(type: string, node?: AnyNode): SlotDeclaration[] {
  switch (type) {
    case 'wall':
      return wallSlots()
    case 'slab':
      return slabSlots()
    case 'ceiling':
      return ceilingSlots()
    case 'door':
      return doorSlots()
    case 'window':
      return windowSlots()
    // `type` is a plain string here so the union cannot narrow `node`; the
    // switch arm is the check.
    case 'column':
      return columnSlots(node as ColumnNode | undefined)
    case 'stair':
      return stairSlots(node as StairNode | undefined)
    case 'fence':
      return fenceSlots(node as FenceNode | undefined)
    case 'elevator':
      return elevatorSlots(node as ElevatorNode | undefined)
    case 'cabinet':
    case 'cabinet-module':
      return cabinetSlots()
    case 'shelf':
      return shelfSlots(node as ShelfNode | undefined)
    case 'duct-segment':
    case 'duct-fitting':
      return ductBodySlots()
    default:
      return []
  }
}

/** Node kinds `surfaceSlotsFor` can answer for. Drives the MCP slot index. */
export const SURFACE_SLOT_KINDS = [
  'cabinet',
  'cabinet-module',
  'ceiling',
  'column',
  'door',
  'duct-fitting',
  'duct-segment',
  'elevator',
  'fence',
  'shelf',
  'slab',
  'stair',
  'wall',
  'window',
] as const
