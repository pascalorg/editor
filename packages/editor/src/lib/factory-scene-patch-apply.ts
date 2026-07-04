import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import type { SceneGraph } from './scene'

type PatchRecord = Record<string, unknown>

export type FactoryScenePatchCreateOperation = {
  node: AnyNode
  parentId?: AnyNodeId
}

export type FactoryScenePatchUpdateOperation = {
  id: AnyNodeId
  data: Partial<AnyNode>
}

export type FactoryScenePatchOperations = {
  createOps: FactoryScenePatchCreateOperation[]
  createdIds: string[]
  deleteIds: AnyNodeId[]
  updateOps: FactoryScenePatchUpdateOperation[]
  updatedIds: string[]
}

function isRecord(value: unknown): value is PatchRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeFactoryUpdateData(data: PatchRecord) {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    normalized[key] =
      value === null &&
      (key === 'material' ||
        key === 'materialPreset' ||
        key.endsWith('Material') ||
        key.endsWith('MaterialPreset'))
        ? undefined
        : value
  }
  return normalized
}

function resolvedParentId(
  patch: PatchRecord,
  node: PatchRecord,
  fallbackParentId?: AnyNodeId | null,
  knownIds?: Set<string>,
  createdIds?: Set<string>,
) {
  const explicit =
    typeof patch.parentId === 'string' && patch.parentId
      ? (patch.parentId as AnyNodeId)
      : typeof node.parentId === 'string' && node.parentId
        ? (node.parentId as AnyNodeId)
        : undefined
  if (!explicit) return fallbackParentId || undefined
  if (!knownIds) return explicit
  if (knownIds.has(explicit) || createdIds?.has(explicit)) return explicit
  return fallbackParentId && knownIds.has(fallbackParentId) ? fallbackParentId : explicit
}

export function buildFactoryScenePatchOperations(
  patches: unknown[],
  input: {
    existingNodeIds?: Iterable<string>
    fallbackParentId?: AnyNodeId | null
  } = {},
): FactoryScenePatchOperations {
  const shouldFilterKnownIds = input.existingNodeIds !== undefined
  const knownIds = new Set(input.existingNodeIds ?? [])
  const createOps: FactoryScenePatchCreateOperation[] = []
  const updateOps: FactoryScenePatchUpdateOperation[] = []
  const deleteIds: AnyNodeId[] = []
  const createdIds: string[] = []
  const updatedIds: string[] = []

  for (const patch of patches) {
    if (!isRecord(patch)) continue
    if (patch.op === 'create' && isRecord(patch.node)) {
      const node = patch.node as unknown as AnyNode
      if (typeof node.id !== 'string' || typeof node.type !== 'string') continue
      const parentId = resolvedParentId(
        patch,
        patch.node,
        input.fallbackParentId,
        shouldFilterKnownIds ? knownIds : undefined,
        new Set(createdIds),
      )
      createOps.push(parentId ? { node, parentId } : { node })
      createdIds.push(node.id)
      knownIds.add(node.id)
    } else if (patch.op === 'update' && typeof patch.id === 'string' && isRecord(patch.data)) {
      if (shouldFilterKnownIds && !knownIds.has(patch.id)) continue
      updateOps.push({
        id: patch.id as AnyNodeId,
        data: normalizeFactoryUpdateData(patch.data) as Partial<AnyNode>,
      })
      updatedIds.push(patch.id)
    } else if (patch.op === 'delete' && typeof patch.id === 'string') {
      if (shouldFilterKnownIds && !knownIds.has(patch.id)) continue
      deleteIds.push(patch.id as AnyNodeId)
    }
  }

  return { createOps, createdIds, deleteIds, updateOps, updatedIds }
}

function removeChild(parent: AnyNode | undefined, childId: AnyNodeId): AnyNode | undefined {
  if (!parent || !('children' in parent)) return parent
  const existing = (parent as { children?: unknown }).children
  if (!Array.isArray(existing)) return parent
  return {
    ...parent,
    children: existing.filter((id) => id !== childId),
  } as AnyNode
}

function addChild(parent: AnyNode | undefined, childId: AnyNodeId): AnyNode | undefined {
  if (!parent || !('children' in parent)) return parent
  const existing = (parent as { children?: unknown }).children
  const children = Array.isArray(existing) ? (existing as AnyNodeId[]) : []
  return {
    ...parent,
    children: Array.from(new Set([...children, childId])),
  } as AnyNode
}

export function applyFactoryScenePatchesToGraph(
  graph: SceneGraph,
  patches: unknown[],
  input: {
    fallbackParentId?: AnyNodeId | null
  } = {},
): SceneGraph {
  const nodes = { ...graph.nodes } as Record<AnyNodeId, AnyNode>
  const rootNodeIds = [...graph.rootNodeIds] as AnyNodeId[]
  const operations = buildFactoryScenePatchOperations(patches, {
    existingNodeIds: Object.keys(nodes),
    fallbackParentId: input.fallbackParentId,
  })

  const addRoot = (id: AnyNodeId) => {
    if (!rootNodeIds.includes(id)) rootNodeIds.push(id)
  }
  const removeRoot = (id: AnyNodeId) => {
    const index = rootNodeIds.indexOf(id)
    if (index >= 0) rootNodeIds.splice(index, 1)
  }

  const idsToDelete = new Set<AnyNodeId>()
  const collectDelete = (id: AnyNodeId) => {
    if (idsToDelete.has(id)) return
    idsToDelete.add(id)
    const current = nodes[id]
    if (current && 'children' in current) {
      const children = (current as { children?: unknown }).children
      if (Array.isArray(children)) {
        for (const childId of children) {
          const child = nodes[childId as AnyNodeId]
          if (child?.parentId === id) collectDelete(childId as AnyNodeId)
        }
      }
    }
  }
  for (const id of operations.deleteIds) collectDelete(id)

  for (const id of idsToDelete) {
    const current = nodes[id]
    if (!current) continue
    const parentId =
      typeof current.parentId === 'string' ? (current.parentId as AnyNodeId) : undefined
    if (parentId && nodes[parentId]) {
      nodes[parentId] = removeChild(nodes[parentId], id) ?? nodes[parentId]
    }
    removeRoot(id)
    delete nodes[id]
  }

  for (const { node, parentId } of operations.createOps) {
    const effectiveParentId = parentId ?? (node.parentId as AnyNodeId | null) ?? null
    const newNode = {
      ...node,
      parentId: effectiveParentId,
    } as AnyNode
    nodes[newNode.id] = newNode
    if (effectiveParentId && nodes[effectiveParentId]) {
      nodes[effectiveParentId] =
        addChild(nodes[effectiveParentId], newNode.id) ?? nodes[effectiveParentId]
      removeRoot(newNode.id)
    } else {
      addRoot(newNode.id)
    }
  }

  for (const { id, data } of operations.updateOps) {
    const current = nodes[id]
    if (!current) continue
    nodes[id] = { ...current, ...data } as AnyNode
  }

  return { nodes, rootNodeIds }
}
