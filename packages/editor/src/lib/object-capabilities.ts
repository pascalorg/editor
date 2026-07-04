import { type AnyNode, type DynamicType, isDynamicBinding } from '@pascal-app/core'

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
  dataKey?: string
  connections: ObjectPortConnectionSummary[]
}

export type ObjectPortConnectionSummary = {
  nodeId: string
  nodeType: string
  direction: 'incoming' | 'outgoing'
  connectedStationId?: string
  connectedNodeId?: string
  connectedNodeLabel?: string
  connectedPortId?: string
  medium?: string
}

export type ObjectDataBindingSummary = {
  id: string
  type: DynamicType | string
  path: string
  target?: string
}

export type ObjectCapabilityProfile = {
  nodeId: string
  nodeType: string
  label?: string
  sources: ObjectSourceKind[]
  capabilities: ObjectCapabilitySummary[]
  editableParts: ObjectPartSummary[]
  ports: ObjectPortSummary[]
  dataBindings: ObjectDataBindingSummary[]
  profileId?: string
  recipeId?: string
  equipmentFamily?: string
}

export type ObjectSelectionCapabilityContext = {
  selectedIds: string[]
  profiles: ObjectCapabilityProfile[]
  summary: string
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
      dataKey: stringValue(raw.dataKey),
      connections: [],
    })
  }
  return ports
}

function stationIdOf(node: AnyNode | undefined) {
  return stringValue(metadataOf(node).stationId)
}

function nodeLabel(node: AnyNode | undefined) {
  return typeof node?.name === 'string' && node.name.trim().length > 0
    ? node.name.trim()
    : undefined
}

function stationNodeIdMap(nodes: NodeMap) {
  const byStation = new Map<string, string>()
  for (const node of Object.values(nodes)) {
    if (!node) continue
    const stationId = stationIdOf(node)
    if (stationId && !byStation.has(stationId)) byStation.set(stationId, String(node.id))
  }
  return byStation
}

function portConnectionsFor(input: {
  node: AnyNode
  nodes: NodeMap
  portId: string
}): ObjectPortConnectionSummary[] {
  const selectedNodeId = String(input.node.id)
  const selectedStationId = stationIdOf(input.node)
  const byStation = stationNodeIdMap(input.nodes)
  const connections: ObjectPortConnectionSummary[] = []
  const seen = new Set<string>()

  for (const routeNode of Object.values(input.nodes)) {
    if (!routeNode || routeNode.id === input.node.id) continue
    const route = metadataOf(routeNode)
    const fromNodeId = stringValue(route.fromNodeId)
    const toNodeId = stringValue(route.toNodeId)
    const fromStationId = stringValue(route.fromStationId)
    const toStationId = stringValue(route.toStationId)
    const fromPortId = stringValue(route.fromPortId)
    const toPortId = stringValue(route.toPortId)
    const routeMedium = stringValue(route.medium)

    const matchesOutgoing =
      fromPortId === input.portId &&
      ((selectedStationId && fromStationId === selectedStationId) || fromNodeId === selectedNodeId)
    const matchesIncoming =
      toPortId === input.portId &&
      ((selectedStationId && toStationId === selectedStationId) || toNodeId === selectedNodeId)

    if (!matchesOutgoing && !matchesIncoming) continue

    const connectedStationId = matchesOutgoing ? toStationId : fromStationId
    const connectedNodeId =
      (matchesOutgoing ? toNodeId : fromNodeId) ??
      (connectedStationId ? byStation.get(connectedStationId) : undefined)
    const connectedNode = connectedNodeId ? input.nodes[connectedNodeId] : undefined
    const connectedPortId = matchesOutgoing ? toPortId : fromPortId
    const key = `${routeNode.id}:${matchesOutgoing ? 'out' : 'in'}:${input.portId}:${connectedPortId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    connections.push({
      nodeId: String(routeNode.id),
      nodeType: String(routeNode.type),
      direction: matchesOutgoing ? 'outgoing' : 'incoming',
      connectedStationId,
      connectedNodeId,
      connectedNodeLabel: nodeLabel(connectedNode),
      connectedPortId,
      medium: routeMedium,
    })
  }

  return connections
}

function hasLiveData(metadata: AnyRecord) {
  return Boolean(
    metadata.liveDataBinding ||
      metadata.dynamicBindings ||
      metadata.liveDataBindings ||
      metadata.dataBinding ||
      metadata.dataBindings ||
      metadata.telemetry,
  )
}

function dataBindingsFrom(metadata: AnyRecord): ObjectDataBindingSummary[] {
  const bindings: ObjectDataBindingSummary[] = []
  if (Array.isArray(metadata.dynamicBindings)) {
    for (const binding of metadata.dynamicBindings.filter(isDynamicBinding)) {
      bindings.push({
        id: binding.id,
        type: binding.type,
        path: binding.path,
        target: `${binding.type}:${binding.path}`,
      })
    }
  }
  const legacyBinding = recordValue(metadata.liveDataBinding)
  const dataKey = stringValue(legacyBinding?.dataKey)
  const effect = stringValue(legacyBinding?.effect)
  if (dataKey && effect && legacyBinding?.enabled !== false) {
    bindings.push({
      id: 'legacy-live-data-binding',
      type: effect,
      path: dataKey,
      target: `${effect}:${dataKey}`,
    })
  }
  return bindings
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
  const ports = portsFrom(metadata).map((port) => ({
    ...port,
    connections: portConnectionsFor({ node, nodes, portId: port.id }),
  }))
  const dataBindings = dataBindingsFrom(metadata)
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
    dataBindings,
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

function compactList(values: readonly string[], limit = 8) {
  const unique = values.filter((value, index) => values.indexOf(value) === index)
  if (unique.length <= limit) return unique.join(', ')
  return `${unique.slice(0, limit).join(', ')} +${unique.length - limit} more`
}

function formatCapability(capability: ObjectCapabilitySummary) {
  return `${capability.id}${capability.editable ? ':editable' : ':read-only'}@${capability.target}`
}

function formatPart(part: ObjectPartSummary) {
  const role = part.semanticRole ?? part.sourcePartKind ?? 'part'
  const id = part.nodeId ? `#${part.nodeId}` : ''
  return `${role}${id}${part.editable ? '' : ':locked'}`
}

function formatPort(port: ObjectPortSummary) {
  const details = [port.medium, port.side].filter(Boolean).join('/')
  const identity = details ? `${port.id}(${details})` : port.id
  const portConnections = port.connections ?? []
  if (!portConnections.length) return identity
  const connections = portConnections
    .map((connection) => {
      const target =
        connection.connectedNodeLabel ??
        connection.connectedStationId ??
        connection.connectedNodeId ??
        'unknown'
      return `${connection.direction}->${target}${connection.connectedPortId ? `:${connection.connectedPortId}` : ''}`
    })
    .join('|')
  return `${identity}{${connections}}`
}

export function formatObjectCapabilityProfile(profile: ObjectCapabilityProfile) {
  const title = `${profile.label ?? profile.nodeId} [${profile.nodeType}] id=${profile.nodeId}`
  const identity = [
    profile.equipmentFamily ? `family=${profile.equipmentFamily}` : undefined,
    profile.recipeId ? `recipe=${profile.recipeId}` : undefined,
    profile.profileId ? `profile=${profile.profileId}` : undefined,
    profile.sources.length ? `sources=${compactList(profile.sources)}` : undefined,
  ]
    .filter(Boolean)
    .join('; ')
  const capabilities = profile.capabilities.map(formatCapability)
  const parts = profile.editableParts.map(formatPart)
  const ports = profile.ports.map(formatPort)
  const dataBindings = profile.dataBindings.map(
    (binding) => `${binding.type}<-${binding.path}${binding.target ? `(${binding.target})` : ''}`,
  )
  return [
    `- ${title}`,
    identity ? `  identity: ${identity}` : undefined,
    capabilities.length ? `  capabilities: ${compactList(capabilities, 12)}` : undefined,
    parts.length ? `  semanticParts: ${compactList(parts, 12)}` : undefined,
    ports.length ? `  ports: ${compactList(ports, 12)}` : undefined,
    dataBindings.length ? `  dataBindings: ${compactList(dataBindings, 12)}` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
}

export function formatSelectionCapabilities(profiles: readonly ObjectCapabilityProfile[]) {
  if (!profiles.length) return 'No selected object capability profile.'
  return [
    'Selected object capability profiles:',
    ...profiles.map((profile) => formatObjectCapabilityProfile(profile)),
    '',
    'Use these profiles to choose safe edit targets. Prefer editable semantic parts/params over regenerating an entire object. Treat read-only ports as connection anchors unless an explicit connection edit is requested.',
  ].join('\n')
}

export function buildSelectionCapabilityContext(input: {
  nodes: NodeMap
  selectedIds: readonly string[]
}): ObjectSelectionCapabilityContext | null {
  const selectedIds = input.selectedIds.map(String).filter(Boolean)
  if (!selectedIds.length) return null
  const profiles = resolveSelectionCapabilities({ nodes: input.nodes, selectedIds })
  if (!profiles.length) return null
  return {
    selectedIds,
    profiles,
    summary: formatSelectionCapabilities(profiles),
  }
}
