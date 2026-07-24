import {
  AnyNode,
  type AnyNodeId,
  generateId,
  generateSceneMaterialId,
  type LevelNode,
  nodeRegistry,
  remapMeasurementReferences,
  SceneMaterial,
  type SceneMaterialId,
  type StairNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

type ClipboardPayload = {
  copiedAt: number
  materials: SceneMaterial[]
  nodes: AnyNode[]
  rootIds: AnyNodeId[]
}

export type PasteResult = {
  createdMaterialIds: SceneMaterialId[]
  pastedIds: AnyNodeId[]
  skippedIds: AnyNodeId[]
}

const SYSTEM_CLIPBOARD_KIND = 'pascal.scene-nodes'
const SYSTEM_CLIPBOARD_VERSION = 1

const COPYABLE_ROOT_TYPES = new Set<AnyNode['type']>([
  'wall',
  'fence',
  'door',
  'window',
  'column',
  'item',
  'slab',
  'ceiling',
  'roof',
  'stair',
  'spawn',
  'zone',
  'cabinet',
  'cabinet-module',
  'measurement',
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

function isClipboardRoot(
  nodes: Record<AnyNodeId, AnyNode>,
  node: AnyNode,
  allowHostedOpening: boolean,
) {
  const parentId = node.parentId as AnyNodeId | null
  if (!parentId) return true
  const parent = nodes[parentId]
  if (parent?.type === 'level') return true
  if (
    allowHostedOpening &&
    (node.type === 'door' || node.type === 'window') &&
    (parent?.type === 'wall' || parent?.type === 'roof-segment')
  ) {
    return true
  }
  return parent?.type === 'building' && nodeRegistry.get(node.type)?.floorplanScope === 'building'
}

function isCopyableRootType(node: AnyNode) {
  if (COPYABLE_ROOT_TYPES.has(node.type)) return true
  const definition = nodeRegistry.get(node.type)
  return !!definition && definition.capabilities?.duplicable !== false
}

function getPromotedCabinetRunId(
  nodes: Record<AnyNodeId, AnyNode>,
  node: AnyNode,
  selectedIds: Set<AnyNodeId>,
) {
  if (node.type !== 'cabinet-module') return null

  const parentId = node.parentId as AnyNodeId | null
  const parent = parentId ? nodes[parentId] : null
  if (parent?.type !== 'cabinet') return null
  if (!parentId) return null
  if (selectedIds.has(parentId)) return parentId

  const siblingIds = Array.isArray(parent.children) ? (parent.children as AnyNodeId[]) : []
  const hasOnlySelectedModules =
    siblingIds.length > 0 &&
    siblingIds.every((childId) => {
      const child = nodes[childId]
      return child?.type === 'cabinet-module' && selectedIds.has(childId)
    })

  return hasOnlySelectedModules ? parentId : null
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
  materialIdMap: Map<SceneMaterialId, SceneMaterialId>,
  rootIds: Set<AnyNodeId>,
  nodes: Record<AnyNodeId, AnyNode>,
) {
  const clone = remapSceneMaterialReferences(
    JSON.parse(JSON.stringify(node)),
    materialIdMap,
  ) as AnyNode
  ;(clone as Record<string, unknown>).id = idMap.get(oldId)

  if (rootIds.has(oldId)) {
    const buildingId = targetLevel.parentId as AnyNodeId | null
    clone.parentId =
      nodeRegistry.get(node.type)?.floorplanScope === 'building' &&
      buildingId &&
      nodes[buildingId]?.type === 'building'
        ? buildingId
        : targetLevel.id
    if (clone.type === 'door' || clone.type === 'window') {
      delete clone.roofSegmentId
      delete clone.roofFace
    }
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

  if (clone.type === 'measurement') {
    clone.measurement = remapMeasurementReferences(clone.measurement, idMap)
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

function remapSceneMaterialReferences(
  value: unknown,
  materialIdMap: Map<SceneMaterialId, SceneMaterialId>,
): unknown {
  if (typeof value === 'string' && value.startsWith('scene:')) {
    const oldId = value.slice('scene:'.length) as SceneMaterialId
    const nextId = materialIdMap.get(oldId)
    return nextId ? `scene:${nextId}` : value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => remapSceneMaterialReferences(entry, materialIdMap))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        remapSceneMaterialReferences(entry, materialIdMap),
      ]),
    )
  }
  return value
}

function collectReferencedSceneMaterialIds(value: unknown, ids: Set<SceneMaterialId>) {
  if (typeof value === 'string' && value.startsWith('scene:')) {
    ids.add(value.slice('scene:'.length) as SceneMaterialId)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectReferencedSceneMaterialIds(entry, ids)
    return
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectReferencedSceneMaterialIds(entry, ids)
  }
}

function buildClipboardPayload(ids: AnyNodeId[]): ClipboardPayload | null {
  const scene = useScene.getState()
  const selectedIdSet = new Set(ids)
  const allowHostedOpening = ids.length === 1
  const promotedIds = ids.map((id) => {
    const node = scene.nodes[id]
    return node ? (getPromotedCabinetRunId(scene.nodes, node, selectedIdSet) ?? id) : id
  })
  const rootIds = Array.from(new Set(promotedIds)).filter((id) => {
    const node = scene.nodes[id]
    return (
      node &&
      isCopyableRootType(node) &&
      isClipboardRoot(scene.nodes, node, allowHostedOpening) &&
      !hasSelectedAncestor(scene.nodes, id, selectedIdSet)
    )
  })

  if (rootIds.length === 0) {
    return null
  }

  const subtreeIds = new Set<AnyNodeId>()
  for (const rootId of rootIds) {
    collectSubtreeIds(scene.nodes, rootId, subtreeIds)
  }

  const copiedNodes = [...subtreeIds]
    .map((id) => scene.nodes[id])
    .filter((node): node is AnyNode => !!node)
    .map((node) => JSON.parse(JSON.stringify(node)) as AnyNode)
  const materialIds = new Set<SceneMaterialId>()
  collectReferencedSceneMaterialIds(copiedNodes, materialIds)

  return {
    copiedAt: Date.now(),
    materials: [...materialIds]
      .map((id) => scene.materials[id])
      .filter((material): material is SceneMaterial => !!material)
      .map((material) => JSON.parse(JSON.stringify(material)) as SceneMaterial),
    nodes: copiedNodes,
    rootIds,
  }
}

function serializeClipboardPayload(payload: ClipboardPayload) {
  return JSON.stringify({
    kind: SYSTEM_CLIPBOARD_KIND,
    version: SYSTEM_CLIPBOARD_VERSION,
    payload,
  })
}

function parseClipboardPayload(text: string): ClipboardPayload | null {
  try {
    const envelope = JSON.parse(text) as {
      kind?: unknown
      payload?: unknown
      version?: unknown
    }
    if (
      envelope.kind !== SYSTEM_CLIPBOARD_KIND ||
      envelope.version !== SYSTEM_CLIPBOARD_VERSION ||
      !envelope.payload ||
      typeof envelope.payload !== 'object'
    ) {
      return null
    }

    const candidate = envelope.payload as {
      copiedAt?: unknown
      materials?: unknown
      nodes?: unknown
      rootIds?: unknown
    }
    if (
      typeof candidate.copiedAt !== 'number' ||
      !Array.isArray(candidate.nodes) ||
      !Array.isArray(candidate.rootIds) ||
      !candidate.rootIds.every((id) => typeof id === 'string')
    ) {
      return null
    }

    const nodes = candidate.nodes.map((node) => AnyNode.safeParse(node))
    if (nodes.some((result) => !result.success)) return null
    const materials = Array.isArray(candidate.materials)
      ? candidate.materials.map((material) => SceneMaterial.safeParse(material))
      : []
    if (materials.some((result) => !result.success)) return null

    const parsedNodes = nodes.filter((result) => result.success).map((result) => result.data)
    const nodeIds = new Set(parsedNodes.map((node) => node.id))
    const rootIds = candidate.rootIds as AnyNodeId[]
    if (rootIds.length === 0 || rootIds.some((id) => !nodeIds.has(id))) return null

    return {
      copiedAt: candidate.copiedAt,
      materials: materials.filter((result) => result.success).map((result) => result.data),
      nodes: parsedNodes,
      rootIds,
    }
  } catch {
    return null
  }
}

function writeSystemClipboard(payload: ClipboardPayload) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
  void navigator.clipboard.writeText(serializeClipboardPayload(payload)).catch(() => {
    // The in-memory clipboard remains available when browser permissions deny
    // system clipboard access.
  })
}

export function copySelectedNodesToEditorClipboard(selectedIds?: AnyNodeId[]) {
  const ids = selectedIds ?? (useViewer.getState().selection.selectedIds as AnyNodeId[])
  const payload = buildClipboardPayload(ids)
  if (!payload) return false

  clipboardPayload = payload
  notifySubscribers()
  writeSystemClipboard(payload)

  return true
}

export async function readEditorClipboardFromSystem() {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    return hasEditorClipboard()
  }

  let text: string
  try {
    text = await navigator.clipboard.readText()
  } catch {
    return hasEditorClipboard()
  }

  const payload = parseClipboardPayload(text)
  if (!payload) return false
  clipboardPayload = payload
  notifySubscribers()
  return true
}

/**
 * Clone the given nodes (subtrees included, ids remapped) onto the target /
 * active level in place — the same copy + paste pipeline in one step, WITHOUT
 * touching the user's editor clipboard. Selects the clones. Used by the group
 * action menu's Duplicate.
 */
export function duplicateNodesToLevel(
  ids: AnyNodeId[],
  targetLevelId?: AnyNodeId,
): PasteResult | null {
  const payload = buildClipboardPayload(ids)
  if (!payload) return null
  return applyClipboardPayloadToLevel(payload, targetLevelId)
}

export function pasteEditorClipboardToLevel(targetLevelId?: AnyNodeId): PasteResult | null {
  if (!clipboardPayload) return null
  return applyClipboardPayloadToLevel(clipboardPayload, targetLevelId)
}

export async function pasteSystemEditorClipboardToLevel(
  targetLevelId?: AnyNodeId,
): Promise<PasteResult | null> {
  if (!(await readEditorClipboardFromSystem())) return null
  return pasteEditorClipboardToLevel(targetLevelId)
}

function applyClipboardPayloadToLevel(
  payload: ClipboardPayload,
  targetLevelId?: AnyNodeId,
): PasteResult | null {
  const targetLevel = getPasteTargetLevel(targetLevelId)
  if (!targetLevel) return null

  const scene = useScene.getState()
  const idMap = new Map<AnyNodeId, AnyNodeId>()
  const materialIdMap = new Map<SceneMaterialId, SceneMaterialId>()
  const materialsToCreate: SceneMaterial[] = []

  for (const node of payload.nodes) {
    idMap.set(node.id as AnyNodeId, generateId(extractIdPrefix(node.id)) as AnyNodeId)
  }
  for (const material of payload.materials) {
    const oldId = material.id as SceneMaterialId
    const existing = scene.materials[oldId]
    if (existing && JSON.stringify(existing) === JSON.stringify(material)) {
      materialIdMap.set(oldId, oldId)
      continue
    }
    const nextId = existing ? generateSceneMaterialId() : oldId
    materialIdMap.set(oldId, nextId)
    materialsToCreate.push({ ...material, id: nextId })
  }

  const rootIdSet = new Set(payload.rootIds)
  const pastedNodes: AnyNode[] = []
  const skippedIds: AnyNodeId[] = []

  for (const node of payload.nodes) {
    try {
      pastedNodes.push(
        remapNodeReferences(
          node,
          node.id as AnyNodeId,
          targetLevel,
          idMap,
          materialIdMap,
          rootIdSet,
          scene.nodes,
        ),
      )
    } catch (error) {
      console.error('Failed to paste copied node', node.id, error)
      skippedIds.push(node.id as AnyNodeId)
    }
  }

  if (pastedNodes.length === 0) {
    return { createdMaterialIds: [], pastedIds: [], skippedIds }
  }

  for (const material of materialsToCreate) {
    scene.addSceneMaterial(material)
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
    createdMaterialIds: materialsToCreate.map((material) => material.id as SceneMaterialId),
    pastedIds: pastedRootIds,
    skippedIds,
  }
}
