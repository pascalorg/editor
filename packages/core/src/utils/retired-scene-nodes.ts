export type RetiredSceneNodeMigration<TNode> = {
  nodes: Record<string, TNode>
  removedNodeIds: ReadonlySet<string>
}

export function removeRetiredDrawingSheetNodes<TNode>(
  nodes: Record<string, TNode>,
): RetiredSceneNodeMigration<TNode> {
  const removedNodeIds = new Set(
    Object.entries(nodes)
      .filter(([, node]) => {
        return (
          node !== null &&
          typeof node === 'object' &&
          !Array.isArray(node) &&
          (node as { type?: unknown }).type === 'drawing-sheet'
        )
      })
      .map(([id]) => id),
  )
  if (removedNodeIds.size === 0) return { nodes, removedNodeIds }

  const migratedNodes = { ...nodes }
  for (const id of removedNodeIds) delete migratedNodes[id]

  for (const [id, node] of Object.entries(migratedNodes)) {
    if (!(node !== null && typeof node === 'object' && !Array.isArray(node))) continue
    const children = (node as { children?: unknown }).children
    if (!Array.isArray(children)) continue
    if (!children.some((childId) => typeof childId === 'string' && removedNodeIds.has(childId))) {
      continue
    }
    migratedNodes[id] = {
      ...node,
      children: children.filter(
        (childId) => !(typeof childId === 'string' && removedNodeIds.has(childId)),
      ),
    }
  }

  return { nodes: migratedNodes, removedNodeIds }
}
