import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  nodeRegistry,
  resolveSelectionProxyId,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import { emitDeleteSFX } from './sfx-bus'

export function resolveCanvasBuildingId(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
): BuildingNode['id'] | null {
  const visited = new Set<string>()
  let current: AnyNode | undefined = node
  while (current && !visited.has(current.id)) {
    if (current.type === 'building') return current.id
    visited.add(current.id)
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return null
}

export function enterBuildingFromCanvas(node: AnyNode): boolean {
  if (useEditor.getState().phase !== 'site' || useEditor.getState().mode !== 'select') return false
  const buildingId = resolveCanvasBuildingId(node, useScene.getState().nodes)
  if (!buildingId) return false
  useViewer.getState().setSelection({ buildingId, selectedIds: [] })
  useEditor.getState().setPhase('building')
  return true
}

export type SelectionModifierKeys = {
  meta: boolean
  ctrl: boolean
  shift: boolean
  /** Alt alone: select one session-group member without expanding. */
  alt: boolean
}

/** A Delete-mode click on a plan entry: the sledgehammer, not a selection. */
export function deleteNodeFromCanvas(node: AnyNode): void {
  const scene = useScene.getState()
  if (scene.readOnly) return

  emitDeleteSFX(node.type)
  scene.deleteNode(node.id as AnyNodeId)
  if (node.parentId) scene.dirtyNodes.add(node.parentId as AnyNodeId)
  useViewer.getState().setSelection({ selectedIds: [] })
  if (useViewer.getState().hoveredId === node.id) {
    useViewer.setState({ hoveredId: null })
  }
}

function shouldBypassSelectionProxy(node: AnyNode, target: AnyNode): boolean {
  if (node.id === target.id) return false
  // Kind-declared bypass (`def.selectionProxy.bypassDirectPick`): the kind
  // keeps a proxy for grouped affordances but wants a direct body click to
  // select the clicked node itself.
  return nodeRegistry.get(node.type)?.selectionProxy?.bypassDirectPick?.(node, target) ?? false
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
  const proxiedTarget = nodes[resolveSelectionProxyId(node, nodes)] ?? node
  let target = shouldBypassSelectionProxy(node, proxiedTarget) ? node : proxiedTarget
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
