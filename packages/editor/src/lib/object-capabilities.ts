import type { AnyNode } from '@pascal-app/core'

export type ObjectSourceKind =
  | 'builtin-node'
  | 'semantic-assembly'
  | 'ai-geometry'
  | 'industry-pack'
  | 'catalog-item'
  | 'factory-equipment'
  | 'articraft'
  | 'live-data'
  | 'manual'

export type ObjectCapabilityId =
  | 'transform'
  | 'material.color'
  | 'material.opacity'
  | 'tank.kind'
  | 'tank.liquidLevel'
  | 'semantic.parts'
  | 'semantic.params'
  | 'ports'
  | 'data-binding'
  | 'catalog.asset'
  | 'articraft.joints'

export type ObjectCapabilitySummary = {
  id: ObjectCapabilityId
  label: string
  target: 'node' | 'assembly' | 'part' | 'external'
  editable: boolean
}

export type ObjectPartSummary = {
  nodeId?: string
  semanticRole?: string
  sourcePartKind?: string
  editable: boolean
}

export type ObjectPortSummary = {
  id: string
  medium?: string
  side?: string
}

export type ObjectCapabilityProfile = {
  nodeId: string
  nodeType: string
  label?: string
  sources: ObjectSourceKind[]
  capabilities: ObjectCapabilitySummary[]
  editableParts: ObjectPartSummary[]
  ports: ObjectPortSummary[]
  profileId?: string
  recipeId?: string
  equipmentFamily?: string
}

type NodeMap = Record<string, AnyNode | undefined>
type AnyRecord = Record<string, unknown>

const MATERIAL_NODE_TYPES = new Set([
  'box',
  'cable-tray',
  'capsule',
  'ceiling',
  'column',
  'cone',
  'conformal-strip',
  'cylinder',
  'door',
  'elevator',
  'extrude',
  'fence',
  'frustum',
  'half-cylinder',
  'hemisphere',
  'item',
  'lathe',
  'pipe',
  'pipe-fitting',
  'road',
  'roof-segment',
  'rounded-panel',
  'shelf',
  'slab',
  'sphere',
  'stair-segment',
  'steel-beam',
  'sweep',
  'tank',
  'torus',
  'trapezoid-prism',
  'wedge',
  'window',
  'zone',
])

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function metadataOf(node: AnyNode | undefined): AnyRecord {
  const metadata = (node as { metadata?: unknown } | undefined)?.metadata
  return isRecord(metadata) ? metadata : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function recordValue(value: unknown): AnyRecord | undefined {
  return isRecord(value) ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function pushUnique<T>(items: T[], item: T) {
  if (!items.includes(item)) items.push(item)
}

function addCapability(
  capabilities: ObjectCapabilitySummary[],
  capability: ObjectCapabilitySummary,
) {
  if (
    !capabilities.some((item) => item.id === capability.id && item.target === capability.target)
  ) {
    capabilities.push(capability)
  }
}

function equipmentAssembly(metadata: AnyRecord) {
  return recordValue(metadata.equipmentAssembly)
}

function equipmentContract(metadata: AnyRecord) {
  return recordValue(metadata.equipmentContract)
}

function semanticEditablePartRoles(metadata: AnyRecord): string[] {
  const assembly = equipmentAssembly(metadata)
  const contract = equipmentContract(metadata)
  return [
    ...arrayValue(assembly?.editablePartRoles),
    ...arrayValue(contract?.requiredRoles),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
}

function semanticParams(metadata: AnyRecord): unknown[] {
  const assembly = equipmentAssembly(metadata)
  const contract = equipmentContract(metadata)
  return [...arrayValue(assembly?.editableParams), ...arrayValue(contract?.editableParams)]
}

function portsFrom(metadata: AnyRecord): ObjectPortSummary[] {
  const assembly = equipmentAssembly(metadata)
  const contract = equipmentContract(metadata)
  const rawPorts = [...arrayValue(assembly?.ports), ...arrayValue(contract?.ports)]
  const ports: ObjectPortSummary[] = []
  for (const raw of rawPorts) {
    if (!isRecord(raw)) continue
    const id = stringValue(raw.id)
    if (!id || ports.some((port) => port.id === id)) continue
    ports.push({
      id,
      medium: stringValue(raw.medium),
      side: stringValue(raw.side),
    })
  }
  return ports
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

function childNodes(node: AnyNode, nodes: NodeMap): AnyNode[] {
  const children = (node as { children?: unknown }).children
  if (!Array.isArray(children)) return []
  return children
    .map((id) => (typeof id === 'string' ? nodes[id] : undefined))
    .filter((child): child is AnyNode => Boolean(child))
}

function partSummary(node: AnyNode): ObjectPartSummary | undefined {
  const metadata = metadataOf(node)
  const semanticRole = stringValue(metadata.semanticRole)
  const sourcePartKind = stringValue(metadata.sourcePartKind)
  if (!semanticRole && !sourcePartKind) return undefined
  return {
    nodeId: String(node.id),
    semanticRole,
    sourcePartKind,
    editable: true,
  }
}

export function resolveObjectCapabilities(
  node: AnyNode | undefined,
  nodes: NodeMap = {},
): ObjectCapabilityProfile | null {
  if (!node) return null
  const metadata = metadataOf(node)
  const sources: ObjectSourceKind[] = []
  const capabilities: ObjectCapabilitySummary[] = []
  const editableParts: ObjectPartSummary[] = []
  const ports = portsFrom(metadata)
  const nodeType = String(node.type)

  pushUnique(sources, 'manual')
  pushUnique(sources, 'builtin-node')
  if (nodeType === 'item' && (metadata.catalogItemId || (node as { asset?: unknown }).asset)) {
    pushUnique(sources, 'catalog-item')
  }
  if (metadata.generatedBy === 'ai-geometry' || metadata.artifactId || metadata.generatedShape) {
    pushUnique(sources, 'ai-geometry')
  }
  if (metadata.processId || metadata.stationId || metadata.processDomain) {
    pushUnique(sources, 'industry-pack')
  }
  if (equipmentAssembly(metadata)) pushUnique(sources, 'semantic-assembly')
  if (nodeType.startsWith('factory:')) pushUnique(sources, 'factory-equipment')
  if (metadata.articraft) pushUnique(sources, 'articraft')
  if (hasLiveData(metadata)) pushUnique(sources, 'live-data')

  addCapability(capabilities, {
    id: 'transform',
    label: 'Move / rotate / scale',
    target: nodeType === 'assembly' ? 'assembly' : 'node',
    editable: true,
  })

  if (MATERIAL_NODE_TYPES.has(nodeType)) {
    addCapability(capabilities, {
      id: 'material.color',
      label: 'Color',
      target: 'node',
      editable: true,
    })
    addCapability(capabilities, {
      id: 'material.opacity',
      label: 'Opacity',
      target: 'node',
      editable: true,
    })
  }

  if (nodeType === 'tank' || nodeType === 'factory:tank') {
    addCapability(capabilities, {
      id: 'tank.kind',
      label: 'Tank orientation',
      target: 'node',
      editable: true,
    })
    addCapability(capabilities, {
      id: 'tank.liquidLevel',
      label: 'Liquid level',
      target: 'node',
      editable: true,
    })
  }

  const editableRoleSet = new Set(semanticEditablePartRoles(metadata))
  for (const child of childNodes(node, nodes)) {
    const part = partSummary(child)
    if (!part) continue
    editableParts.push({
      ...part,
      editable:
        editableRoleSet.size === 0 ||
        (part.semanticRole ? editableRoleSet.has(part.semanticRole) : false),
    })
  }
  const directPart = partSummary(node)
  if (directPart) editableParts.push(directPart)

  if (equipmentAssembly(metadata) || editableParts.length) {
    addCapability(capabilities, {
      id: 'semantic.parts',
      label: 'Semantic parts',
      target: nodeType === 'assembly' ? 'assembly' : 'part',
      editable: editableParts.some((part) => part.editable),
    })
  }

  if (semanticParams(metadata).length) {
    addCapability(capabilities, {
      id: 'semantic.params',
      label: 'Equipment parameters',
      target: 'assembly',
      editable: true,
    })
  }

  if (ports.length) {
    addCapability(capabilities, {
      id: 'ports',
      label: 'Ports',
      target: nodeType === 'assembly' ? 'assembly' : 'node',
      editable: false,
    })
  }

  if (hasLiveData(metadata)) {
    addCapability(capabilities, {
      id: 'data-binding',
      label: 'Live data binding',
      target: 'external',
      editable: true,
    })
  }

  if (nodeType === 'item') {
    addCapability(capabilities, {
      id: 'catalog.asset',
      label: 'Catalog asset',
      target: 'external',
      editable: false,
    })
  }

  if (metadata.articraft) {
    addCapability(capabilities, {
      id: 'articraft.joints',
      label: 'Joints',
      target: 'node',
      editable: true,
    })
  }

  const assembly = equipmentAssembly(metadata)
  const contract = equipmentContract(metadata)

  return {
    nodeId: String(node.id),
    nodeType,
    label: typeof node.name === 'string' ? node.name : undefined,
    sources: sources.filter((source, index) => sources.indexOf(source) === index),
    capabilities,
    editableParts,
    ports,
    profileId: stringValue(assembly?.profileId) ?? stringValue(contract?.profileId),
    recipeId: stringValue(assembly?.recipeId) ?? stringValue(contract?.recipeId),
    equipmentFamily:
      stringValue(assembly?.equipmentFamily) ?? stringValue(contract?.equipmentFamily),
  }
}

export function resolveSelectionCapabilities(input: {
  nodes: NodeMap
  selectedIds: readonly string[]
}): ObjectCapabilityProfile[] {
  return input.selectedIds
    .map((id) => resolveObjectCapabilities(input.nodes[id], input.nodes))
    .filter((profile): profile is ObjectCapabilityProfile => Boolean(profile))
}
