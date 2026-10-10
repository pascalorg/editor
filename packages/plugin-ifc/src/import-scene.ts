import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import type { PascalSceneGraph } from '@pascal-app/ifc-converter'

export type SceneImportOperation = {
  node: AnyNode
  parentId?: AnyNodeId
}

function remapReferences<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') return (ids.get(value) ?? value) as T
  if (Array.isArray(value)) return value.map((entry) => remapReferences(entry, ids)) as T
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, remapReferences(entry, ids)]),
  ) as T
}

/** Convert an IFC graph into fresh, history-friendly create operations. */
export function createIfcImportOperations(
  graph: PascalSceneGraph,
  importToken: string,
  collectionIds: ReadonlyMap<string, string> = new Map(),
): SceneImportOperation[] {
  const sourceNodes = graph.nodes
  const sourceIds = Object.keys(sourceNodes)
  const ids = new Map([
    ...sourceIds.map((id): [string, string] => [id, `${id}_imp_${importToken}`]),
    ...collectionIds,
  ])
  const parentById = new Map<string, string>()

  for (const node of Object.values(sourceNodes)) {
    if (node.parentId && sourceNodes[node.parentId]) parentById.set(node.id, node.parentId)
    if (!('children' in node) || !Array.isArray(node.children)) continue
    for (const childId of node.children) {
      if (sourceNodes[childId] && !parentById.has(childId)) parentById.set(childId, node.id)
    }
  }

  const childrenByParent = new Map<string, string[]>()
  for (const id of sourceIds) {
    const parentId = parentById.get(id)
    if (!parentId) continue
    const children = childrenByParent.get(parentId) ?? []
    children.push(id)
    childrenByParent.set(parentId, children)
  }
  for (const [parentId, children] of childrenByParent) {
    const parent = sourceNodes[parentId]
    const originalOrder =
      parent && 'children' in parent && Array.isArray(parent.children)
        ? parent.children.filter((childId) => parentById.get(childId) === parentId)
        : []
    const seen = new Set(originalOrder)
    childrenByParent.set(parentId, [
      ...originalOrder,
      ...children.filter((childId) => !seen.has(childId)),
    ])
  }

  const orderedIds: string[] = []
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (!sourceNodes[id] || visited.has(id)) return
    visited.add(id)
    orderedIds.push(id)
    const node = sourceNodes[id]
    for (const childId of childrenByParent.get(id) ?? []) visit(childId)
  }
  for (const id of graph.rootNodeIds) visit(id)
  for (const id of sourceIds) visit(id)

  return orderedIds.map((id) => {
    const sourceNode = sourceNodes[id]!
    const node = remapReferences(sourceNode, ids) as AnyNode
    const sourceParentId = parentById.get(id)
    const parentId = sourceParentId ? (ids.get(sourceParentId) as AnyNodeId) : undefined
    return {
      node: {
        ...node,
        parentId: parentId ?? null,
        ...('children' in sourceNode
          ? { children: (childrenByParent.get(id) ?? []).map((childId) => ids.get(childId)!) }
          : {}),
      },
      ...(parentId ? { parentId } : {}),
    }
  })
}
