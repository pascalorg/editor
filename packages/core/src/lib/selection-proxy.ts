import type { AnyNode, AnyNodeId } from '../schema/types'

export function selectionProxyIdFromMetadata(metadata: unknown): AnyNodeId | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).nodeSelectionProxyId
  return typeof value === 'string' ? (value as AnyNodeId) : null
}

export function resolveSelectionProxyId(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): AnyNodeId {
  const proxyId = selectionProxyIdFromMetadata((node as { metadata?: unknown }).metadata)
  if (!proxyId || !nodes[proxyId]) return node.id as AnyNodeId
  return proxyId
}
