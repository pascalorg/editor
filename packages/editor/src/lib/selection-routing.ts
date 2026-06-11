import { type AnyNode, type ItemNode, nodeRegistry } from '@pascal-app/core'

export type SelectionModifierKeys = {
  meta: boolean
  ctrl: boolean
  shift: boolean
}

export type NodeSelectionTarget = {
  phase: 'site' | 'structure' | 'furnish'
  structureLayer?: 'zones' | 'elements'
}

export function isSelectionModifierActive(keys: SelectionModifierKeys): boolean {
  return keys.meta || keys.ctrl || keys.shift
}

export function selectionModifiersFromEvent(
  event?: {
    metaKey?: boolean
    ctrlKey?: boolean
    shiftKey?: boolean
    nativeEvent?: {
      metaKey?: boolean
      ctrlKey?: boolean
      shiftKey?: boolean
    }
  } | null,
  fallback?: Partial<SelectionModifierKeys>,
): SelectionModifierKeys {
  return {
    meta: Boolean(event?.metaKey || event?.nativeEvent?.metaKey || fallback?.meta),
    ctrl: Boolean(event?.ctrlKey || event?.nativeEvent?.ctrlKey || fallback?.ctrl),
    shift: Boolean(event?.shiftKey || event?.nativeEvent?.shiftKey || fallback?.shift),
  }
}

export function resolveSelectedIdsForNodeClick({
  baseSelectedIds,
  currentSelectedIds,
  modifierKeys,
  nodeId,
}: {
  baseSelectedIds?: readonly string[]
  currentSelectedIds: readonly string[]
  modifierKeys: SelectionModifierKeys
  nodeId: string
}): string[] {
  if (isSelectionModifierActive(modifierKeys)) {
    const selectedIds = baseSelectedIds ?? currentSelectedIds
    if (selectedIds.includes(nodeId)) {
      return selectedIds.filter((id) => id !== nodeId)
    }
    return [...selectedIds, nodeId]
  }

  return [nodeId]
}

export function resolveNodeSelectionTarget(node: AnyNode): NodeSelectionTarget | null {
  if (node.type === 'building') {
    return { phase: 'site' }
  }

  if (node.type === 'zone') {
    return {
      phase: 'structure',
      structureLayer: 'zones',
    }
  }

  if (node.type === 'item') {
    const item = node as ItemNode
    if (item.asset.category === 'door' || item.asset.category === 'window') {
      return {
        phase: 'structure',
        structureLayer: 'elements',
      }
    }
    return { phase: 'furnish' }
  }

  if (
    node.type === 'wall' ||
    node.type === 'fence' ||
    node.type === 'column' ||
    node.type === 'elevator' ||
    node.type === 'slab' ||
    node.type === 'ceiling' ||
    node.type === 'roof' ||
    node.type === 'roof-segment' ||
    node.type === 'stair' ||
    node.type === 'stair-segment' ||
    node.type === 'spawn' ||
    node.type === 'window' ||
    node.type === 'door'
  ) {
    return {
      phase: 'structure',
      structureLayer: 'elements',
    }
  }

  const def = nodeRegistry.get(node.type)
  if (!def) return null

  if (def.category === 'furnish') {
    return { phase: 'furnish' }
  }

  return {
    phase: 'structure',
    structureLayer: 'elements',
  }
}
