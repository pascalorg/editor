import {
  AnyNode,
  type AnyNodeId,
  generateId,
  type LevelNode,
  type StairNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

type ClipboardPayload = {
  copiedAt: number
  nodes: AnyNode[]
  rootIds: AnyNodeId[]
}

type PasteResult = {
  pastedIds: AnyNodeId[]
  skippedIds: AnyNodeId[]
}

const COPYABLE_ROOT_TYPES = new Set<AnyNode['type']>([
  'wall',
  'fence',
  'column',
  'item',
  'slab',
  'ceiling',
  'roof',
  'stair',
  'spawn',
  'zone',
])

let clipboardPayload: ClipboardPayload | null = null
const subscribers = new Set<() => void>()

function notifySubscribers() {
  for (const subscriber of subscribers) {
    subscriber()
  }
}

export function subscribeEditorClipboard(subscriber: () => void) {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}

export function getEditorClipboardSnapshot() {
  return clipboardPayload
}

export function hasEditorClipboard() {
  return !!clipboardPayload && clipboardPayload.rootIds.length > 0
}

function extractIdPrefix(id: string) {
  const underscoreIndex = id.indexOf('_')
  return underscoreIndex === -1 ? 'node' : id.slice(0, underscoreIndex)
}

function collectSubtreeIds(
  nodes: Record<AnyNodeId, AnyNode>,
  rootId: AnyNodeId,
  ids: Set<AnyNodeId>,
) {
  if (ids.has(rootId)) return
  const node = nodes[rootId]
  if (!node) return
  ids.add(rootId)

  if ('children' in node && Array.isArray(node.children)) {
    for (const childId of node.children as AnyNodeId[]) {
      collectSubtreeIds(nodes, childId, ids)
    }
  }
}

function hasSelectedAncestor(
  nodes: Record<AnyNodeId, AnyNode>,
  id: AnyNodeId,
  selectedIds: Set<AnyNodeId>,
) {
  let parentId = nodes[id]?.parentId as AnyNodeId | null

  while (parentId) {
    if (selectedIds.has(parentId)) return true
    parentId = nodes[parentId]?.parentId as AnyNodeId | null
  }

  return false
}

function isLevelChildRoot(nodes: Record<AnyNodeId, AnyNode>, node: AnyNode) {
  const parentId = node.parentId as AnyNodeId | null
  if (!parentId) return true
  return nodes[parentId]?.type === 'level'
}

function getPasteTargetLevel(targetLevelId?: AnyNodeId) {
  const scene = useScene.getState()
  const resolvedLevelId =
    targetLevelId ?? (useViewer.getState().selection.levelId as AnyNodeId | null)
  if (!resolvedLevelId) return null

  const level = scene.nodes[resolvedLevelId]
  return level?.type === 'level' ? level : null
}

function getNextLevelId(level: LevelNode, nodes: Record<AnyNodeId, AnyNode>) {
  const parentId = level.parentId as AnyNodeId | null
  if (!parentId) return null

  const building = nodes[parentId]
  if (building?.type !== 'building') return null

  const siblingLevels = building.children
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((node): node is LevelNode => node?.type === 'level')

  return (
    siblingLevels
      .filter((candidate) => candidate.level > level.level)
      .sort((a, b) => a.level - b.level)[0]?.id ?? null
  )
}

function remapNodeReferences(
  node: AnyNode,
  oldId: AnyNodeId,
  targetLevel: LevelNode,
  idMap: Map<AnyNodeId, AnyNodeId>,
  rootIds: Set<AnyNodeId>,
  nodes: Record<AnyNodeId, AnyNode>,
) {
  const clone = JSON.parse(JSON.stringify(node)) as AnyNode
  ;(clone as Record<string, unknown>).id = idMap.get(oldId)

  if (rootIds.has(oldId)) {
    clone.parentId = targetLevel.id
  } else if (clone.parentId && typeof clone.parentId === 'string') {
    clone.parentId = idMap.get(clone.parentId as AnyNodeId) ?? clone.parentId
  }

  if ('children' in clone && Array.isArray(clone.children)) {
    ;(clone as Record<string, unknown>).children = (clone.children as AnyNodeId[])
      .map((childId) => idMap.get(childId))
      .filter((childId): childId is AnyNodeId => !!childId)
  }

  if ('wallId' in clone && typeof clone.wallId === 'string') {
    const nextWallId = idMap.get(clone.wallId as AnyNodeId)
    if (nextWallId) {
      ;(clone as Record<string, unknown>).wallId = nextWallId
    } else {
      delete (clone as Record<string, unknown>).wallId
    }
  }

  if (clone.type === 'stair') {
    const nextLevelId = getNextLevelId(targetLevel, nodes)
    ;(clone as StairNode).fromLevelId = targetLevel.id
    ;(clone as StairNode).toLevelId = nextLevelId
  }

  const metadata =
    clone.metadata && typeof clone.metadata === 'object' && !Array.isArray(clone.metadata)
      ? { ...(clone.metadata as Record<string, unknown>) }
      : {}
  delete metadata.isNew
  delete metadata.isTransient
  ;(clone as Record<string, unknown>).metadata = metadata

  return AnyNode.parse(clone)
}

export function copySelectedNodesToEditorClipboard(selectedIds?: AnyNodeId[]) {
  const scene = useScene.getState()
  const ids = selectedIds ?? (useViewer.getState().selection.selectedIds as AnyNodeId[])
  const selectedIdSet = new Set(ids)
  const rootIds = ids.filter((id) => {
    const node = scene.nodes[id]
    return (
      node &&
      COPYABLE_ROOT_TYPES.has(node.type) &&
      isLevelChildRoot(scene.nodes, node) &&
      !hasSelectedAncestor(scene.nodes, id, selectedIdSet)
    )
  })

  if (rootIds.length === 0) {
    return false
  }

  const subtreeIds = new Set<AnyNodeId>()
  for (const rootId of rootIds) {
    collectSubtreeIds(scene.nodes, rootId, subtreeIds)
  }

  clipboardPayload = {
    copiedAt: Date.now(),
    nodes: [...subtreeIds]
      .map((id) => scene.nodes[id])
      .filter((node): node is AnyNode => !!node)
      .map((node) => JSON.parse(JSON.stringify(node)) as AnyNode),
    rootIds,
  }
  notifySubscribers()

  return true
}

export function pasteEditorClipboardToLevel(targetLevelId?: AnyNodeId): PasteResult | null {
  const payload = clipboardPayload
  const targetLevel = getPasteTargetLevel(targetLevelId)
  if (!payload || !targetLevel) return null

  const scene = useScene.getState()
  const idMap = new Map<AnyNodeId, AnyNodeId>()

  for (const node of payload.nodes) {
    idMap.set(node.id as AnyNodeId, generateId(extractIdPrefix(node.id)) as AnyNodeId)
  }

  const rootIdSet = new Set(payload.rootIds)
  const pastedNodes: AnyNode[] = []
  const skippedIds: AnyNodeId[] = []

  for (const node of payload.nodes) {
    try {
      pastedNodes.push(
        remapNodeReferences(node, node.id as AnyNodeId, targetLevel, idMap, rootIdSet, scene.nodes),
      )
    } catch (error) {
      console.error('Failed to paste copied node', node.id, error)
      skippedIds.push(node.id as AnyNodeId)
    }
  }

  if (pastedNodes.length === 0) {
    return { pastedIds: [], skippedIds }
  }

  scene.createNodes(
    pastedNodes.map((node) => ({
      node,
      parentId: (node.parentId as AnyNodeId | null) ?? undefined,
    })),
  )

  const pastedNodeIds = new Set(pastedNodes.map((node) => node.id as AnyNodeId))
  const pastedRootIds = payload.rootIds
    .map((rootId) => idMap.get(rootId))
    .filter((id): id is AnyNodeId => !!id && pastedNodeIds.has(id))

  useViewer.getState().setSelection({
    levelId: targetLevel.id,
    selectedIds: pastedRootIds,
  })

  return {
    pastedIds: pastedRootIds,
    skippedIds,
  }
}
