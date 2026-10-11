import {
  AnyNode,
  type AnyNodeId,
  collectionIdsOf,
  generateId,
  generateSceneMaterialId,
  getArtifactStore,
  isDerivedNode,
  type LevelNode,
  nodeRegistry,
  type ParsedBuildJson,
  remapMeasurementReferences,
  SceneMaterial,
  type SceneMaterialId,
  type StairNode,
  scriptedSize,
  useScene,
} from '@pascal-app/core'
import { clampDoorToWall, clampWindowToWall } from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import { referencedSceneMaterialIds, remapSceneMaterialRefs } from './scene-material-refs'

type ClipboardPayload = {
  copiedAt: number
  materials: SceneMaterial[]
  nodes: AnyNode[]
  /** The project copied from, where the scripted nodes' artifacts live. */
  projectId: string | null
  rootIds: AnyNodeId[]
}

export type PasteResult = {
  createdMaterialIds: SceneMaterialId[]
  pastedIds: AnyNodeId[]
  /** Scripted nodes left out (with what they host): their artifacts could not come from the project they were copied from. */
  refusedIds: AnyNodeId[]
  /** Why they were left out, when any were. */
  refusal: PasteRefusal | null
  skippedIds: AnyNodeId[]
}

/**
 * `no-access`: the source project cannot be read any more (removed from it,
 * deleted, made private, another account). `no-copies`: its geometry is
 * readable but this script version cannot be copied. `failed`: the copy itself failed.
 */
export type PasteRefusal = 'no-access' | 'no-copies' | 'failed'

type Refused = { ids: ReadonlySet<AnyNodeId>; reason: PasteRefusal | null }
const NONE_REFUSED: Refused = { ids: new Set(), reason: null }

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
let pendingSystemClipboardWrite: Promise<boolean> | null = null
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
  if (!node || isDerivedNode(node)) return
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
  if (isDerivedNode(node)) return false
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
  const clone = remapSceneMaterialRefs(JSON.parse(JSON.stringify(node)) as AnyNode, materialIdMap)
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

  if (clone.type === 'zone' && node.parentId !== clone.parentId && clone.floor?.footprint) {
    const { footprint: _footprint, ...floor } = clone.floor
    clone.floor = floor
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
  const materialIds = referencedSceneMaterialIds(copiedNodes)

  return {
    copiedAt: Date.now(),
    materials: [...materialIds]
      .map((id) => scene.materials[id])
      .filter((material): material is SceneMaterial => !!material)
      .map((material) => JSON.parse(JSON.stringify(material)) as SceneMaterial),
    nodes: copiedNodes,
    projectId: useViewer.getState().projectId,
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
      projectId?: unknown
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
    const nodeIds = new Set<AnyNodeId>(parsedNodes.map((node) => node.id))
    const rootIds = candidate.rootIds as AnyNodeId[]
    if (rootIds.length === 0 || rootIds.some((id) => !nodeIds.has(id))) return null

    return {
      copiedAt: candidate.copiedAt,
      materials: materials.filter((result) => result.success).map((result) => result.data),
      nodes: parsedNodes,
      projectId: typeof candidate.projectId === 'string' ? candidate.projectId : null,
      rootIds,
    }
  } catch {
    return null
  }
}

function writeSystemClipboard(payload: ClipboardPayload) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    pendingSystemClipboardWrite = null
    return
  }
  pendingSystemClipboardWrite = navigator.clipboard
    .writeText(serializeClipboardPayload(payload))
    .then(
      () => true,
      () => false,
    )
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
  const pendingWrite = pendingSystemClipboardWrite
  pendingSystemClipboardWrite = null
  if (pendingWrite && !(await pendingWrite)) {
    return hasEditorClipboard()
  }

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
  const projectId = useViewer.getState().projectId
  const store = getArtifactStore()
  if (!(await readEditorClipboardFromSystem()) || !clipboardPayload) return null
  if (projectId !== useViewer.getState().projectId || store !== getArtifactStore()) return null
  const payload = clipboardPayload
  const targetLevel = getPasteTargetLevel(targetLevelId)
  if (!targetLevel) return null
  const refused =
    payload.projectId && payload.projectId === projectId
      ? NONE_REFUSED
      : await copyArtifactsHere(payload)
  // Navigation can replace the scene while the server copies its artifacts.
  if (projectId !== useViewer.getState().projectId || store !== getArtifactStore()) return null
  return applyClipboardPayloadToLevel(payload, targetLevel.id, refused)
}

function artifactHashes(node: AnyNode): string[] {
  const source = 'source' in node ? node.source : undefined
  return typeof source === 'object' && source.kind === 'script'
    ? [source.script, source.artifact]
    : []
}

/**
 * A paste from another project first brings the artifacts its scripted nodes
 * reference into this one. Returns the nodes whose artifacts could not come,
 * which the paste leaves out with everything they host, and why.
 */
async function copyArtifactsHere(
  payload: Pick<ClipboardPayload, 'nodes' | 'projectId'>,
): Promise<Refused> {
  const store = getArtifactStore()
  const hashes = [...new Set(payload.nodes.flatMap(artifactHashes))]
  if (hashes.length === 0) return NONE_REFUSED

  let failed = false
  const missing = new Set(
    store.copyFrom
      ? payload.projectId
        ? await store.copyFrom(payload.projectId, hashes).catch(() => {
            failed = true
            return hashes
          })
        : hashes
      : hashes.filter((sha) => !store.url(sha)),
  )
  const ids = new Set<AnyNodeId>()
  let geometryMissing = false
  for (const node of payload.nodes) {
    const [script, artifact] = artifactHashes(node)
    if (!script || !artifact || !(missing.has(script) || missing.has(artifact))) continue
    ids.add(node.id as AnyNodeId)
    geometryMissing ||= missing.has(artifact)
  }
  if (ids.size === 0) return NONE_REFUSED
  return { ids, reason: failed ? 'failed' : geometryMissing ? 'no-access' : 'no-copies' }
}

/**
 * A build file loaded into another project first brings the artifacts its
 * scripted nodes reference from the project it was saved in, as a paste does.
 * Answers the build without the nodes whose artifacts could not come, nor
 * anything they host.
 */
export async function bringBuildArtifacts(build: ParsedBuildJson): Promise<{
  build: ParsedBuildJson
  refusedIds: AnyNodeId[]
  refusal: PasteRefusal | null
}> {
  const nodes = Object.values(build.nodes) as AnyNode[]
  // A file's origin is untrusted, even when it names this project. Older files can
  // still use artifacts already registered here, but cannot introduce missing ones.
  const refused = await copyArtifactsHere({
    nodes,
    projectId: build.projectId ?? useViewer.getState().projectId,
  })
  if (refused.ids.size === 0) return { build, refusedIds: [], refusal: null }

  const excluded = new Set<string>(refused.ids)
  for (let grew = true; grew; ) {
    grew = false
    for (const node of nodes) {
      if (node.parentId && excluded.has(node.parentId) && !excluded.has(node.id)) {
        excluded.add(node.id)
        grew = true
      }
    }
  }
  const kept: Record<string, unknown> = {}
  for (const node of nodes) {
    if (excluded.has(node.id)) continue
    const children = (node as { children?: unknown }).children
    kept[node.id] = Array.isArray(children)
      ? { ...node, children: children.filter((id) => !excluded.has(id as string)) }
      : node
  }
  const collections =
    build.collections &&
    Object.fromEntries(
      Object.entries(build.collections).map(([id, collection]) => [
        id,
        { ...collection, nodeIds: collection.nodeIds.filter((nodeId) => !excluded.has(nodeId)) },
      ]),
    )
  return {
    build: {
      ...build,
      nodes: kept,
      rootNodeIds: build.rootNodeIds.filter((id) => !excluded.has(id)),
      ...(collections ? { collections } : {}),
    },
    refusedIds: [...refused.ids],
    refusal: refused.reason,
  }
}

function applyClipboardPayloadToLevel(
  copied: ClipboardPayload,
  targetLevelId?: AnyNodeId,
  { ids: refused, reason: refusal }: Refused = NONE_REFUSED,
): PasteResult | null {
  const targetLevel = getPasteTargetLevel(targetLevelId)
  if (!targetLevel) return null
  const payload = refused.size > 0 ? withoutRefusedSubtrees(copied, refused) : copied

  const scene = useScene.getState()
  const idMap = new Map<AnyNodeId, AnyNodeId>()
  const materialIdMap = new Map<SceneMaterialId, SceneMaterialId>()
  const materialsToCreate: SceneMaterial[] = []

  for (const node of payload.nodes) {
    if (isDerivedNode(node)) continue
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
    if (isDerivedNode(node)) {
      skippedIds.push(node.id as AnyNodeId)
      continue
    }
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

  fitOpeningsToPastedWalls(pastedNodes, scene.nodes)

  if (pastedNodes.length === 0) {
    return {
      createdMaterialIds: [],
      pastedIds: [],
      refusedIds: [...refused],
      refusal,
      skippedIds,
    }
  }

  for (const material of materialsToCreate) {
    scene.addSceneMaterial(material)
  }
  const sourceIds = new Map([...idMap].map(([source, copy]) => [copy, source]))
  scene.createNodes(
    pastedNodes.map((node) => ({
      node,
      parentId: (node.parentId as AnyNodeId | null) ?? undefined,
      // A copy is in its source's collections; an item brings them in its own `collectionIds`.
      ...(node.type !== 'item' && {
        collectionIds: collectionIdsOf(scene.collections, sourceIds.get(node.id as AnyNodeId)!),
      }),
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
    refusedIds: [...refused],
    refusal,
    skippedIds,
  }
}

/**
 * A door or window pasted with its wall is held inside it the way the door and window tools place
 * one: a wall pasted under a lower storey would otherwise leave a tall window poking above it.
 */
function fitOpeningsToPastedWalls(pasted: AnyNode[], sceneNodes: Record<AnyNodeId, AnyNode>) {
  const byId = Object.fromEntries(pasted.map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >
  let nodes: Record<AnyNodeId, AnyNode> | undefined
  pasted.forEach((node, index) => {
    if (node.type !== 'door' && node.type !== 'window') return
    const wall = node.parentId ? byId[node.parentId as AnyNodeId] : undefined
    if (wall?.type !== 'wall') return
    // A scripted opening is as tall as what its script built, as the wall cuts it.
    const [width, height] = node.source
      ? scriptedSize(node.source.manifest)
      : [node.width, node.height]
    nodes ??= { ...sceneNodes, ...byId }
    const [x, y, z] = node.position
    const { clampedY } =
      node.type === 'door'
        ? clampDoorToWall(wall, x, width, height)
        : clampWindowToWall(wall, x, y, width, height, nodes)
    if (clampedY !== y) pasted[index] = { ...node, position: [x, clampedY, z] }
  })
}

function withoutRefusedSubtrees(
  payload: ClipboardPayload,
  refused: ReadonlySet<AnyNodeId>,
): ClipboardPayload {
  const children = new Map<string, AnyNodeId[]>()
  for (const node of payload.nodes) {
    if (!node.parentId) continue
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node.id as AnyNodeId)
    children.set(node.parentId, siblings)
  }
  const excluded = new Set(refused)
  for (const id of excluded) {
    for (const childId of children.get(id) ?? []) excluded.add(childId)
  }
  const nodes = payload.nodes.filter((node) => !excluded.has(node.id as AnyNodeId))
  const kept = new Set(nodes.map((node) => node.id))
  const materialIds = referencedSceneMaterialIds(nodes)
  return {
    ...payload,
    materials: payload.materials.filter((material) =>
      materialIds.has(material.id as SceneMaterialId),
    ),
    nodes,
    rootIds: payload.rootIds.filter((id) => kept.has(id)),
  }
}
