import { AnyNode, type AnyNodeId, generateId, nodeRegistry, useScene } from '@pascal-app/core'

type DuplicateSubtreeOptions = {
  offset?: [number, number, number]
  parentId?: AnyNodeId | null
  markRootNew?: boolean
}

type DuplicateSubtreeCreateResult = {
  createOps: Array<{ node: AnyNode; parentId?: AnyNodeId }>
  idMap: Map<AnyNodeId, AnyNodeId>
  rootId: AnyNodeId
}

type DuplicateSubtreeResult = DuplicateSubtreeCreateResult & {
  root: AnyNode
}

const DEFAULT_OFFSET: [number, number, number] = [1, 0, 1]

function extractIdPrefix(id: string, fallback: string) {
  const underscoreIndex = id.indexOf('_')
  return underscoreIndex === -1 ? fallback : id.slice(0, underscoreIndex)
}

function stripTransientMetadata(metadata: unknown, markNew: boolean) {
  const next =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {}

  delete next.isNew
  delete next.isTransient
  if (markNew) next.isNew = true
  return next
}

function parseNode(node: AnyNode): AnyNode {
  const def = nodeRegistry.get(node.type)
  if (def) {
    return def.schema.parse(node) as AnyNode
  }
  return AnyNode.parse(node)
}

export function buildSubtreeDuplicateCreateOps({
  nodes,
  rootId,
  offset = DEFAULT_OFFSET,
  parentId,
  markRootNew = true,
}: {
  nodes: Record<AnyNodeId, AnyNode>
  rootId: AnyNodeId
} & DuplicateSubtreeOptions): DuplicateSubtreeCreateResult {
  const sourceRoot = nodes[rootId]
  if (!sourceRoot) {
    throw new Error(`Cannot duplicate missing node "${rootId}"`)
  }

  const traversalParentById = new Map<AnyNodeId, AnyNodeId | null>()
  const orderedIds: AnyNodeId[] = []
  const visit = (id: AnyNodeId, traversalParentId: AnyNodeId | null) => {
    if (traversalParentById.has(id)) return
    const node = nodes[id]
    if (!node) return
    traversalParentById.set(id, traversalParentId)
    orderedIds.push(id)

    if ('children' in node && Array.isArray(node.children)) {
      for (const childId of node.children as AnyNodeId[]) {
        visit(childId, id)
      }
    }
  }
  visit(rootId, null)

  const idMap = new Map<AnyNodeId, AnyNodeId>()
  for (const oldId of orderedIds) {
    const node = nodes[oldId]
    idMap.set(oldId, generateId(extractIdPrefix(oldId, node?.type ?? 'node')) as AnyNodeId)
  }

  const rootParentId = parentId === undefined ? (sourceRoot.parentId as AnyNodeId | null) : parentId
  const createOps: Array<{ node: AnyNode; parentId?: AnyNodeId }> = []

  for (const oldId of orderedIds) {
    const sourceNode = nodes[oldId]
    if (!sourceNode) continue

    const clone = structuredClone(sourceNode) as AnyNode
    ;(clone as Record<string, unknown>).id = idMap.get(oldId)

    const isRoot = oldId === rootId
    if (isRoot) {
      clone.parentId = rootParentId ?? null
    } else {
      const traversalParentId = traversalParentById.get(oldId) ?? null
      clone.parentId =
        (traversalParentId ? idMap.get(traversalParentId) : null) ??
        (clone.parentId ? idMap.get(clone.parentId as AnyNodeId) : null) ??
        clone.parentId
    }

    if ('children' in clone && Array.isArray(clone.children)) {
      ;(clone as Record<string, unknown>).children = (clone.children as AnyNodeId[])
        .map((childId) => idMap.get(childId))
        .filter((childId): childId is AnyNodeId => !!childId)
    }

    if ('wallId' in clone && typeof clone.wallId === 'string') {
      const remappedWallId = idMap.get(clone.wallId as AnyNodeId)
      if (remappedWallId) {
        ;(clone as Record<string, unknown>).wallId = remappedWallId
      }
    }

    if (isRoot && 'position' in clone && Array.isArray(clone.position)) {
      const position = clone.position as [number, number, number]
      ;(clone as { position: [number, number, number] }).position = [
        position[0] + offset[0],
        position[1] + offset[1],
        position[2] + offset[2],
      ]
    }

    ;(clone as Record<string, unknown>).metadata = stripTransientMetadata(
      clone.metadata,
      isRoot && markRootNew,
    )

    const parsed = parseNode(clone)
    createOps.push({
      node: parsed,
      parentId: (parsed.parentId as AnyNodeId | null) ?? undefined,
    })
  }

  const rootCloneId = idMap.get(rootId)
  if (!rootCloneId) {
    throw new Error(`Failed to allocate duplicate id for "${rootId}"`)
  }

  return {
    createOps,
    idMap,
    rootId: rootCloneId,
  }
}

export function duplicateNodeSubtree(
  rootId: AnyNodeId,
  options: DuplicateSubtreeOptions = {},
): DuplicateSubtreeResult {
  const scene = useScene.getState()
  const result = buildSubtreeDuplicateCreateOps({
    nodes: scene.nodes,
    rootId,
    ...options,
  })

  scene.createNodes(result.createOps)

  const root = useScene.getState().nodes[result.rootId]
  if (!root) {
    throw new Error(`Duplicated node "${result.rootId}" was not created`)
  }

  return {
    ...result,
    root,
  }
}
