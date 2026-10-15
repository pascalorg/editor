import type { AnyNode, AnyNodeId, CabinetModuleNode, CabinetNode } from '@pascal-app/core'
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

export function kitchenItemMatches(id: CabinetPresetId, query: string): boolean {
  const item = KITCHEN_ITEMS.find((entry) => entry.id === id)
  if (!item) return false
  const text = `${item.label} ${item.keywords} kitchen cabinet`.toLowerCase()
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

/** The kitchen's placed modules a query names; fillers are part of their run, not items. */
export function findKitchenItems(
  nodes: Readonly<Record<string, AnyNode>>,
  query: string,
): CabinetModuleNode[] {
  return Object.values(nodes).filter((node): node is CabinetModuleNode => {
    if (node.type !== 'cabinet-module' || node.moduleKind !== 'standard') return false
    const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    const id = kitchenPresetForModule(node, parent?.type === 'cabinet' ? parent : undefined)
    return (
      kitchenItemMatches(id, query) || (node.name ?? '').toLowerCase().includes(query.toLowerCase())
    )
  })
}
