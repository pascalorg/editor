import {
  type AnyNode,
  emitter,
  type ItemNode,
  nodeRegistry,
  resolveSelectionProxyId,
} from '@pascal-app/core'

export type SelectionModifierKeys = {
  meta: boolean
  ctrl: boolean
  shift: boolean
  /** Alt alone: select one session-group member without expanding. */
  alt: boolean
}

export type NodeSelectionTarget = {
  phase: 'site' | 'structure' | 'furnish'
  structureLayer?: 'zones' | 'elements'
}

export function emitCanvasNodeSelection(node: AnyNode): void {
  emitter.emit('selection:canvas-node-click', node)
}

function shouldBypassSelectionProxy(node: AnyNode, target: AnyNode): boolean {
  if (node.id === target.id) return false
  // Kind-declared bypass (`def.selectionProxy.bypassDirectPick`): the kind
  // keeps a proxy for grouped affordances but wants a direct body click to
  // select the clicked node itself.
  return nodeRegistry.get(node.type)?.selectionProxy?.bypassDirectPick?.(node, target) ?? false
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

function resolveManagedLeanToRoofOwner(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): AnyNode | null {
  if (node.type !== 'roof' && node.type !== 'roof-segment') return null
  const metadata = metadataRecord(node.metadata)
  const role = metadata.leanToRole
  if (role !== 'roof' && role !== 'roof-segment') return null
  const ownerId = metadata.managedByLeanTo
  if (typeof ownerId !== 'string') return null
  const owner = nodes[ownerId]
  return owner?.type === 'lean-to-extension' ? owner : null
}

export function resolveCanvasSelectionNode({
  node,
  nodes,
  selectedIds,
}: {
  node: AnyNode
  nodes: Readonly<Record<string, AnyNode | undefined>>
  selectedIds: readonly string[]
}): AnyNode {
  const managedLeanToOwner = resolveManagedLeanToRoofOwner(node, nodes)
  if (managedLeanToOwner) return managedLeanToOwner

  const proxiedTarget = nodes[resolveSelectionProxyId(node, nodes)] ?? node
  let target = shouldBypassSelectionProxy(node, proxiedTarget) ? node : proxiedTarget
  const managedLeanToTargetOwner = resolveManagedLeanToRoofOwner(target, nodes)
  if (managedLeanToTargetOwner) return managedLeanToTargetOwner

  const parentFrame = nodeRegistry.get(target.type)?.capabilities?.movable?.parentFrame
  if (parentFrame) {
    const parent = parentFrame.resolveParent(target, nodes as Readonly<Record<string, AnyNode>>)
    if (parent && selectedIds.length === 1 && selectedIds[0] === parent.id) {
      target = parent
    }
  }
  return target
}

export function isSelectionModifierActive(keys: SelectionModifierKeys): boolean {
  return keys.meta || keys.ctrl || keys.shift
}

export function selectionModifiersFromEvent(
  event?: {
    metaKey?: boolean
    ctrlKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
    nativeEvent?: {
      metaKey?: boolean
      ctrlKey?: boolean
      shiftKey?: boolean
      altKey?: boolean
    }
  } | null,
  fallback?: Partial<SelectionModifierKeys>,
): SelectionModifierKeys {
  const fromEvent = (
    key: keyof SelectionModifierKeys,
    eventKey: 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey',
  ) => {
    if (typeof event?.[eventKey] === 'boolean') return event[eventKey]
    if (typeof event?.nativeEvent?.[eventKey] === 'boolean') return event.nativeEvent[eventKey]
    return Boolean(fallback?.[key])
  }

  return {
    meta: fromEvent('meta', 'metaKey'),
    ctrl: fromEvent('ctrl', 'ctrlKey'),
    shift: fromEvent('shift', 'shiftKey'),
    alt: fromEvent('alt', 'altKey'),
  }
}

export function resolveSelectedIdsForNodeClick({
  baseSelectedIds,
  currentSelectedIds,
  modifierKeys,
  nodeId,
  expandIdsForNode,
}: {
  baseSelectedIds?: readonly string[]
  currentSelectedIds: readonly string[]
  modifierKeys: SelectionModifierKeys
  nodeId: string
  /** Session-group expand on plain click (not on modifier/Alt). */
  expandIdsForNode?: (nodeId: string) => string[] | null
}): string[] {
  if (isSelectionModifierActive(modifierKeys)) {
    const selectedIds = baseSelectedIds ?? currentSelectedIds
    if (selectedIds.includes(nodeId)) {
      return selectedIds.filter((id) => id !== nodeId)
    }
    return [...selectedIds, nodeId]
  }

  if (modifierKeys.alt) {
    return [nodeId]
  }

  const expanded = expandIdsForNode?.(nodeId)
  if (expanded && expanded.length > 1) return expanded
  return [nodeId]
}

export function shouldPreserveSelectedRoofHostTarget({
  node,
  selectedIds,
  armedRoofId,
}: {
  node: AnyNode
  selectedIds: readonly string[]
  armedRoofId: string | null
}): boolean {
  return (
    node.type === 'roof' &&
    armedRoofId === node.id &&
    selectedIds.length === 1 &&
    selectedIds[0] === node.id
  )
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
