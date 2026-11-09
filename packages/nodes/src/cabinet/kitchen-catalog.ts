import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  MessageDescriptor,
} from '@pascal-app/core'
import { CABINET_PRESETS, type CabinetPresetId } from './presets'

export const KITCHEN_ITEMS = CABINET_PRESETS.map((preset) => ({
  ...preset,
  group: (['base-door', 'drawer-base', 'wall-cabinet', 'tall-pantry'].includes(preset.id)
    ? 'Cabinets'
    : 'Appliances & fixtures') as 'Cabinets' | 'Appliances & fixtures',
  keywords: {
    'base-door': 'storage cupboard lower cabinet',
    'drawer-base': 'drawers storage cutlery',
    'wall-cabinet': 'upper overhead cupboard wall mounted',
    'tall-pantry': 'pantry tall storage cupboard',
    'fridge-single': 'refrigerator refrigeration freezer fridge integrated',
    dishwasher: 'dishwasher dishes integrated',
    'sink-base': 'sink basin washing faucet tap',
    'oven-tower': 'oven tower microwave baking',
    'cooktop-gas': 'gas hob stove cooker cooktop',
    'cooktop-induction': 'electric induction hob stove cooktop',
  }[preset.id],
}))

/**
 * Preset names in the UI language. The presets keep their English labels
 * (agents and MCP read them); the kitchen picker and replace dialog show these.
 */
export const KITCHEN_ITEM_LABELS: Record<CabinetPresetId, MessageDescriptor> = {
  'wall-cabinet': /* i18n */ { id: 'node.cabinet.preset.wallCabinet', message: 'Wall cabinet' },
  'base-door': /* i18n */ { id: 'node.cabinet.preset.baseCabinet', message: 'Base cabinet' },
  'drawer-base': /* i18n */ { id: 'node.cabinet.preset.drawerCabinet', message: 'Drawer cabinet' },
  dishwasher: /* i18n */ { id: 'node.cabinet.preset.dishwasher', message: 'Dishwasher' },
  'cooktop-gas': /* i18n */ { id: 'node.cabinet.preset.gasCooktop', message: 'Gas cooktop' },
  'cooktop-induction': /* i18n */ {
    id: 'node.cabinet.preset.inductionCooktop',
    message: 'Induction cooktop',
  },
  'sink-base': /* i18n */ { id: 'node.cabinet.preset.sinkCabinet', message: 'Sink cabinet' },
  'tall-pantry': /* i18n */ { id: 'node.cabinet.preset.tallPantry', message: 'Tall Pantry' },
  'oven-tower': /* i18n */ { id: 'node.cabinet.preset.ovenTower', message: 'Oven Tower' },
  'fridge-single': /* i18n */ { id: 'node.cabinet.preset.fridge', message: 'Fridge' },
}

export const KITCHEN_GROUP_TITLES: Record<'Cabinets' | 'Appliances & fixtures', MessageDescriptor> =
  {
    Cabinets: /* i18n */ { id: 'node.cabinet.kitchenGroup.cabinets', message: 'Cabinets' },
    'Appliances & fixtures': /* i18n */ {
      id: 'node.cabinet.kitchenGroup.appliances',
      message: 'Appliances & fixtures',
    },
  }

/** `label` is the name the picker shows, when it is not the English one. */
export function kitchenItemMatches(id: CabinetPresetId, query: string, label = ''): boolean {
  const item = KITCHEN_ITEMS.find((entry) => entry.id === id)
  if (!item) return false
  const text = `${item.label} ${label} ${item.keywords} kitchen cabinet`.toLowerCase()
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word))
}

export function kitchenPresetForModule(
  node: CabinetModuleNode,
  run?: CabinetNode,
): CabinetPresetId {
  const types = node.stack?.map((part) => part.type) ?? []
  if (types.some((type) => type.startsWith('fridge-'))) return 'fridge-single'
  if (types.includes('dishwasher')) return 'dishwasher'
  if (types.includes('sink')) return 'sink-base'
  if (types.includes('cooktop-gas')) return 'cooktop-gas'
  if (types.includes('cooktop-induction')) return 'cooktop-induction'
  if (types.includes('oven') || types.includes('microwave')) return 'oven-tower'
  if (run?.runTier === 'wall') return 'wall-cabinet'
  if (node.cabinetType === 'tall') return 'tall-pantry'
  if (types.length > 0 && types.every((type) => type === 'drawer')) return 'drawer-base'
  return 'base-door'
}

/** A placed module's preset, reading its parent: an upper attached to a module is a wall cabinet. */
export function kitchenPresetForPlacedModule(
  nodes: Readonly<Record<string, AnyNode>>,
  node: CabinetModuleNode,
): CabinetPresetId {
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  if (parent?.type === 'cabinet-module') return 'wall-cabinet'
  return kitchenPresetForModule(node, parent?.type === 'cabinet' ? parent : undefined)
}

/**
 * The kitchen's placed modules a query names; fillers are part of their run,
 * not items. `labelFor` gives the name the UI shows for a preset, when it is
 * not the English one.
 */
export function findKitchenItems(
  nodes: Readonly<Record<string, AnyNode>>,
  query: string,
  labelFor?: (id: CabinetPresetId) => string,
): CabinetModuleNode[] {
  return Object.values(nodes).filter((node): node is CabinetModuleNode => {
    if (node.type !== 'cabinet-module' || node.moduleKind !== 'standard') return false
    const id = kitchenPresetForPlacedModule(nodes, node)
    return (
      kitchenItemMatches(id, query, labelFor?.(id)) ||
      (node.name ?? '').toLowerCase().includes(query.toLowerCase())
    )
  })
}
