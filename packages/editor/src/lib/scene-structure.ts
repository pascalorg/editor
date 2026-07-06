import type { AnyNode } from '@pascal-app/core'
import { assetSourceLabel, readAssetSourceContract } from './asset-source-contract'
import { resolveObjectCapabilities } from './object-capabilities'

export type SceneStructureMode = 'spatial' | 'system' | 'data' | 'asset-source' | 'elevation'

export type SceneStructureItem = {
  id: string
  nodeId: string
  nodeType: string
  label: string
  detail?: string
  badge?: string
}

export type SceneStructureGroup = {
  id: string
  label: string
  detail?: string
  items: SceneStructureItem[]
}

export type SceneStructureTree = {
  mode: SceneStructureMode
  groups: SceneStructureGroup[]
  summary: {
    groupCount: number
    itemCount: number
    suggestedMode: SceneStructureMode
  }
}

type NodeMap = Record<string, AnyNode | undefined>
type AnyRecord = Record<string, unknown>

const STRUCTURAL_TYPES = new Set(['site', 'building', 'level'])
const PIPE_TYPES = new Set(['pipe', 'pipe-fitting'])
const POWER_TYPES = new Set(['cable-tray', 'data-widget', 'data-chart', 'data-table'])
const CIVIL_TYPES = new Set([
  'wall',
  'slab',
  'ceiling',
  'column',
  'roof',
  'roof-segment',
  'door',
  'window',
  'stair',
  'stair-segment',
  'elevator',
  'fence',
  'road',
  'zone',
])

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function metadataOf(node: AnyNode | undefined): AnyRecord {
  const metadata = (node as { metadata?: unknown } | undefined)?.metadata
  return isRecord(metadata) ? metadata : {}
}

function recordValue(value: unknown): AnyRecord | undefined {
  return isRecord(value) ? value : undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function equipmentAssembly(metadata: AnyRecord) {
  return recordValue(metadata.equipmentAssembly)
}

function equipmentContract(metadata: AnyRecord) {
  return recordValue(metadata.equipmentContract)
}

function nodeType(node: AnyNode | undefined) {
  return node ? String(node.type) : ''
}

function nodeName(node: AnyNode | undefined) {
  if (!node) return 'Unknown'
  const metadata = metadataOf(node)
  const assembly = equipmentAssembly(metadata)
  return (
    stringValue(node.name) ??
    stringValue(metadata.stationLabel) ??
    stringValue(metadata.displayLabel) ??
    stringValue(assembly?.profileId) ??
    nodeType(node)
  )
}

function nodeChildren(node: AnyNode | undefined): string[] {
  const children = (node as { children?: unknown } | undefined)?.children
  return Array.isArray(children)
    ? children.filter((id): id is string => typeof id === 'string')
    : []
}

function parentChain(node: AnyNode, nodes: NodeMap): AnyNode[] {
  const chain: AnyNode[] = []
  let parentId = (node as { parentId?: unknown }).parentId
  const seen = new Set<string>()
  while (typeof parentId === 'string' && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = nodes[parentId]
    if (!parent) break
    chain.push(parent)
    parentId = (parent as { parentId?: unknown }).parentId
  }
  return chain
}

function canonicalStructureNode(node: AnyNode, nodes: NodeMap): AnyNode {
  const metadata = metadataOf(node)
  const stationId = stringValue(metadata.stationId)
  const chain = parentChain(node, nodes)
  const semanticParent = chain.find((parent) => {
    const parentMetadata = metadataOf(parent)
    return (
      nodeType(parent) === 'assembly' &&
      (equipmentAssembly(parentMetadata) ||
        (stationId && stringValue(parentMetadata.stationId) === stationId))
    )
  })
  return semanticParent ?? node
}

function structureCandidates(nodes: NodeMap): AnyNode[] {
  const seen = new Set<string>()
  const candidates: AnyNode[] = []
  for (const node of Object.values(nodes)) {
    if (!node || STRUCTURAL_TYPES.has(nodeType(node))) continue
    const canonical = canonicalStructureNode(node, nodes)
    if (seen.has(String(canonical.id))) continue
    seen.add(String(canonical.id))
    candidates.push(canonical)
  }
  return candidates
}

function createItem(node: AnyNode, detail?: string, badge?: string): SceneStructureItem {
  return {
    id: String(node.id),
    nodeId: String(node.id),
    nodeType: nodeType(node),
    label: nodeName(node),
    detail,
    badge,
  }
}

function addItem(
  groups: Map<string, SceneStructureGroup>,
  group: Omit<SceneStructureGroup, 'items'>,
  item: SceneStructureItem,
) {
  const existing = groups.get(group.id)
  if (existing) {
    if (!existing.items.some((candidate) => candidate.nodeId === item.nodeId)) {
      existing.items.push(item)
    }
    return
  }
  groups.set(group.id, { ...group, items: [item] })
}

function sortedGroups(groups: Map<string, SceneStructureGroup>): SceneStructureGroup[] {
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function sourcePackLabel(metadata: AnyRecord) {
  const sourcePack = recordValue(metadata.sourcePack)
  const equipmentSourcePack = recordValue(equipmentContract(metadata)?.sourcePack)
  const id = stringValue(sourcePack?.id) ?? stringValue(equipmentSourcePack?.id)
  const version = stringValue(sourcePack?.version) ?? stringValue(equipmentSourcePack?.version)
  return id ? `${id}${version ? `@${version}` : ''}` : undefined
}

function nearestLevel(node: AnyNode, nodes: NodeMap): AnyNode | undefined {
  return parentChain(node, nodes).find((parent) => nodeType(parent) === 'level')
}

function buildElevationGroups(
  nodes: NodeMap,
  rootNodeIds: readonly string[],
): SceneStructureGroup[] {
  const groups = new Map<string, SceneStructureGroup>()
  const levels = Object.values(nodes).filter(
    (node): node is AnyNode => Boolean(node) && nodeType(node) === 'level',
  )
  for (const level of levels) {
    const levelNumber = numberValue((level as { level?: unknown }).level) ?? 0
    const childIds = nodeChildren(level)
    for (const childId of childIds) {
      const child = nodes[childId]
      if (!child || STRUCTURAL_TYPES.has(nodeType(child))) continue
      addItem(
        groups,
        {
          id: String(level.id),
          label: stringValue(level.name) ?? `Level ${levelNumber}`,
          detail: `elevation ${levelNumber}`,
        },
        createItem(canonicalStructureNode(child, nodes)),
      )
    }
  }
  for (const rootId of rootNodeIds) {
    const root = nodes[rootId]
    if (root && !STRUCTURAL_TYPES.has(nodeType(root)) && !nearestLevel(root, nodes)) {
      addItem(groups, { id: 'unplaced', label: 'Unplaced' }, createItem(root))
    }
  }
  return sortedGroups(groups)
}

function buildSpatialGroups(nodes: NodeMap, rootNodeIds: readonly string[]): SceneStructureGroup[] {
  const groups = new Map<string, SceneStructureGroup>()
  for (const node of structureCandidates(nodes)) {
    const level = nearestLevel(node, nodes)
    if (level) {
      addItem(
        groups,
        {
          id: String(level.id),
          label:
            stringValue(level.name) ??
            `Level ${numberValue((level as { level?: unknown }).level) ?? 0}`,
          detail: 'level space',
        },
        createItem(node, undefined, nodeType(node)),
      )
      continue
    }
    const isRoot = rootNodeIds.includes(String(node.id))
    addItem(
      groups,
      { id: isRoot ? 'site-root' : 'unplaced', label: isRoot ? 'Site roots' : 'Unplaced' },
      createItem(node, undefined, nodeType(node)),
    )
  }
  return sortedGroups(groups)
}

function systemGroupFor(node: AnyNode) {
  const type = nodeType(node)
  const metadata = metadataOf(node)
  const assembly = equipmentAssembly(metadata)
  const contract = equipmentContract(metadata)
  const family =
    stringValue(assembly?.equipmentFamily) ??
    stringValue(contract?.equipmentFamily) ??
    stringValue(metadata.equipmentFamily)
  if (PIPE_TYPES.has(type)) return { id: 'piping', label: 'Piping' }
  if (POWER_TYPES.has(type)) return { id: 'power-data', label: 'Power and data' }
  if (CIVIL_TYPES.has(type)) return { id: 'civil', label: 'Civil and access' }
  if (family) return { id: `equipment:${family}`, label: `${family} equipment` }
  if (type === 'assembly' || type === 'tank' || type.startsWith('factory:')) {
    return { id: 'equipment:generic', label: 'Process equipment' }
  }
  return { id: `type:${type}`, label: type.replaceAll('-', ' ') }
}

function buildSystemGroups(nodes: NodeMap): SceneStructureGroup[] {
  const groups = new Map<string, SceneStructureGroup>()
  for (const node of structureCandidates(nodes)) {
    const group = systemGroupFor(node)
    addItem(groups, group, createItem(node, undefined, nodeType(node)))
  }
  return sortedGroups(groups)
}

function hasLiveData(metadata: AnyRecord) {
  return Boolean(
    metadata.liveDataBinding ||
      metadata.liveDataBindings ||
      metadata.dataBinding ||
      metadata.dataBindings ||
      metadata.telemetry,
  )
}

function buildDataGroups(nodes: NodeMap): SceneStructureGroup[] {
  const groups = new Map<string, SceneStructureGroup>()
  for (const node of structureCandidates(nodes)) {
    const metadata = metadataOf(node)
    const profile = resolveObjectCapabilities(node, nodes)
    const canBind =
      Boolean(profile?.capabilities.some((capability) => capability.id === 'data-binding')) ||
      nodeType(node) === 'tank' ||
      nodeType(node) === 'pipe' ||
      Boolean(equipmentAssembly(metadata))
    if (!hasLiveData(metadata) && !canBind) continue
    const bound = hasLiveData(metadata)
    addItem(
      groups,
      {
        id: bound ? 'bound' : 'available',
        label: bound ? 'Bound live data' : 'Available targets',
      },
      createItem(node, bound ? 'live data configured' : 'ready for binding'),
    )
  }
  return sortedGroups(groups)
}

function primarySource(node: AnyNode, nodes: NodeMap) {
  const assetSource = readAssetSourceContract(metadataOf(node))
  if (assetSource?.kind === 'image-to-3d') {
    return { id: 'image-to-3d', label: 'Image-generated assets' }
  }
  if (assetSource?.kind === 'articraft') return { id: 'articraft', label: 'Joint assets' }
  if (assetSource?.kind === 'industry-pack') return { id: 'industry-pack', label: 'Industry packs' }
  if (assetSource?.kind === 'ai-geometry') return { id: 'ai-geometry', label: 'AI geometry' }
  if (assetSource?.kind === 'catalog-item') return { id: 'catalog-item', label: 'Catalog assets' }
  if (assetSource?.kind === 'factory-equipment') {
    return { id: 'factory-equipment', label: 'Factory plugins' }
  }
  const sources = resolveObjectCapabilities(node, nodes)?.sources ?? []
  if (sources.includes('industry-pack')) return { id: 'industry-pack', label: 'Industry packs' }
  if (sources.includes('image-to-3d')) return { id: 'image-to-3d', label: 'Image-generated assets' }
  if (sources.includes('ai-geometry')) return { id: 'ai-geometry', label: 'AI geometry' }
  if (sources.includes('catalog-item')) return { id: 'catalog-item', label: 'Catalog assets' }
  if (sources.includes('articraft')) return { id: 'articraft', label: 'Joint assets' }
  if (sources.includes('factory-equipment'))
    return { id: 'factory-equipment', label: 'Factory plugins' }
  if (sources.includes('builtin-node')) return { id: 'builtin-node', label: 'Built-in nodes' }
  return { id: 'manual', label: 'Manual objects' }
}

function buildAssetSourceGroups(nodes: NodeMap): SceneStructureGroup[] {
  const groups = new Map<string, SceneStructureGroup>()
  for (const node of structureCandidates(nodes)) {
    const source = primarySource(node, nodes)
    const detail = assetSourceLabel(readAssetSourceContract(metadataOf(node)))
    addItem(groups, source, createItem(node, detail, nodeType(node)))
  }
  return sortedGroups(groups)
}

export function suggestSceneStructureMode(nodes: NodeMap): SceneStructureMode {
  let hasFactorySource = false
  let hasLevels = false
  for (const node of Object.values(nodes)) {
    if (!node) continue
    const metadata = metadataOf(node)
    if (metadata.processDomain || sourcePackLabel(metadata) || equipmentAssembly(metadata)) {
      hasFactorySource = true
    }
    if (nodeType(node) === 'level') hasLevels = true
  }
  if (hasFactorySource) return 'system'
  if (hasLevels) return 'elevation'
  return 'spatial'
}

export function buildSceneStructure(input: {
  nodes: NodeMap
  rootNodeIds?: readonly string[]
  mode?: SceneStructureMode
}): SceneStructureTree {
  const suggestedMode = suggestSceneStructureMode(input.nodes)
  const mode = input.mode ?? suggestedMode
  const rootNodeIds = input.rootNodeIds ?? []
  const groups =
    mode === 'spatial'
      ? buildSpatialGroups(input.nodes, rootNodeIds)
      : mode === 'system'
        ? buildSystemGroups(input.nodes)
        : mode === 'data'
          ? buildDataGroups(input.nodes)
          : mode === 'asset-source'
            ? buildAssetSourceGroups(input.nodes)
            : buildElevationGroups(input.nodes, rootNodeIds)
  return {
    mode,
    groups,
    summary: {
      groupCount: groups.length,
      itemCount: groups.reduce((sum, group) => sum + group.items.length, 0),
      suggestedMode,
    },
  }
}
