import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { buildFactoryScenePatchOperations } from './factory-scene-patch-apply'

export type FactoryRunChangePreviewNode = {
  id: string
  label: string
  type?: string
}

export type FactoryRunChangePreview = {
  beforeNodeCount: number
  afterNodeCount: number
  created: FactoryRunChangePreviewNode[]
  updated: FactoryRunChangePreviewNode[]
  deleted: FactoryRunChangePreviewNode[]
  lines: string[]
}

function nodeLabel(node: Partial<AnyNode> | undefined, id: string) {
  const name = typeof node?.name === 'string' && node.name.trim() ? node.name.trim() : undefined
  return name ?? id
}

function previewNodeFromExisting(
  nodes: Record<string, AnyNode | undefined>,
  id: string,
): FactoryRunChangePreviewNode {
  const node = nodes[id]
  return {
    id,
    label: nodeLabel(node, id),
    ...(typeof node?.type === 'string' ? { type: node.type } : {}),
  }
}

function previewNodeFromCreated(node: AnyNode): FactoryRunChangePreviewNode {
  return {
    id: node.id,
    label: nodeLabel(node, node.id),
    type: node.type,
  }
}

function collectDeletedIds(nodes: Record<string, AnyNode | undefined>, deleteIds: string[]) {
  const deleted = new Set<string>()
  const visit = (id: string) => {
    if (deleted.has(id)) return
    deleted.add(id)
    const node = nodes[id]
    if (!node || !('children' in node)) return
    const children = (node as { children?: unknown }).children
    if (!Array.isArray(children)) return
    for (const childId of children) {
      if (typeof childId === 'string' && nodes[childId]?.parentId === id) visit(childId)
    }
  }
  for (const id of deleteIds) visit(id)
  return deleted
}

function formatSample(prefix: string, nodes: FactoryRunChangePreviewNode[]) {
  if (nodes.length === 0) return undefined
  const sample = nodes
    .slice(0, 4)
    .map((node) => node.label)
    .join(', ')
  return `${prefix}: ${sample}${nodes.length > 4 ? ` +${nodes.length - 4}` : ''}`
}

export function buildFactoryRunChangePreview(input: {
  nodes: Record<string, AnyNode | undefined>
  patches: unknown[]
  fallbackParentId?: AnyNodeId | null
}): FactoryRunChangePreview {
  const beforeNodeCount = Object.keys(input.nodes).length
  const operations = buildFactoryScenePatchOperations(input.patches, {
    existingNodeIds: Object.keys(input.nodes),
    fallbackParentId: input.fallbackParentId,
  })
  const deletedIds = collectDeletedIds(input.nodes, operations.deleteIds.map(String))
  const created = operations.createOps.map(({ node }) => previewNodeFromCreated(node))
  const updated = operations.updateOps.map(({ id, data }) => {
    const existing = input.nodes[id]
    const label =
      typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : nodeLabel(existing, String(id))
    return {
      id: String(id),
      label,
      ...(typeof existing?.type === 'string' ? { type: existing.type } : {}),
    }
  })
  const deleted = [...deletedIds].map((id) => previewNodeFromExisting(input.nodes, id))
  const afterNodeCount = beforeNodeCount + created.length - deleted.length
  const lines = [
    `Before: ${beforeNodeCount} nodes`,
    `After: ${afterNodeCount} nodes`,
    formatSample('Create', created),
    formatSample('Update', updated),
    formatSample('Delete', deleted),
  ].filter((line): line is string => Boolean(line))

  return {
    beforeNodeCount,
    afterNodeCount,
    created,
    updated,
    deleted,
    lines,
  }
}
