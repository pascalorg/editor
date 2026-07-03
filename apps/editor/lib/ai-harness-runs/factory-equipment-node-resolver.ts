import type {
  AnyNode,
  EquipmentPort,
  EquipmentSpec,
  NodeRegistry,
  Vec3,
} from '@pascal-app/core'
import { nodeRegistry } from '@pascal-app/core'
import { createEquipmentNodePatch, type EquipmentNodeCreatePatch } from '../equipment-node-patches'
import { stationDisplayLabel } from './process-line-localization'
import type {
  FactoryRouteObstacleMetadata,
  ProcessConnectionMedium,
  ProcessEquipmentContract,
  ProcessEquipmentPort,
  ProcessStationPlan,
  StationPlacement,
} from './process-line-types'
import type { GeneratedGeometryPlacementSpec } from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import type { ProcessRoutePortEndpoint } from './process-line-routing'

export type FactoryEquipmentNodeResolution = {
  patch: EquipmentNodeCreatePatch
  routeObstacle: FactoryRouteObstacleMetadata
  portOverrides: ProcessRoutePortEndpoint[]
  nodeKind: string
}

type EquipmentNodeEnvelope = {
  length: number
  width: number
  height: number
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const PROCESS_MEDIA = new Set<ProcessConnectionMedium>([
  'water',
  'hydrogen',
  'oxygen',
  'power',
  'cooling',
  'material',
  'gas',
  'molten_metal',
])

function rounded(value: number) {
  return Math.round(value * 1000) / 1000
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    const items = value.map(jsonValue).filter((item): item is JsonValue => item !== undefined)
    return items
  }
  if (typeof value !== 'object' || value === undefined) return undefined
  const record = value as Record<string, unknown>
  const entries = Object.entries(record)
    .map(([key, entry]) => [key, jsonValue(entry)] as const)
    .filter((entry): entry is readonly [string, JsonValue] => entry[1] !== undefined)
  return Object.fromEntries(entries)
}

function jsonRecord(value: Record<string, unknown>): Record<string, JsonValue> {
  const parsed = jsonValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, JsonValue>)
    : {}
}

function stationText(station: ProcessStationPlan, contract: ProcessEquipmentContract) {
  return [
    station.id,
    station.role,
    station.label,
    station.displayLabel,
    station.equipmentHint,
    contract.profileId,
    contract.equipmentFamily,
    contract.primarySemanticRole,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

function factoryNodeKindFor(input: {
  station: ProcessStationPlan
  contract: ProcessEquipmentContract
  registry: NodeRegistry
}) {
  const text = stationText(input.station, input.contract)
  if (
    input.registry.has('factory:pump') &&
    /pump|centrifugal|metering|positive[_\s-]?displacement|\u6cf5/.test(text)
  ) {
    return 'factory:pump'
  }
  return undefined
}

function pumpTypeFor(station: ProcessStationPlan, contract: ProcessEquipmentContract) {
  const text = stationText(station, contract)
  if (/metering|\u8ba1\u91cf/.test(text)) return 'metering'
  if (/positive[_\s-]?displacement|pd\s+pump|\u5bb9\u79ef/.test(text)) return 'positive_displacement'
  return 'centrifugal'
}

function paramsForNodeKind(input: {
  nodeKind: string
  station: ProcessStationPlan
  contract: ProcessEquipmentContract
}) {
  if (input.nodeKind !== 'factory:pump') return null
  const envelope = input.contract.envelope
  return {
    name: stationDisplayLabel(input.station),
    pumpType: pumpTypeFor(input.station, input.contract),
    length: envelope.length,
    width: envelope.width,
    height: envelope.height,
    inletDiameter: 0.15,
    outletDiameter: 0.1,
    skidMounted: input.station.equipmentHint.toLowerCase().includes('skid'),
  }
}

function nodeVec3(node: AnyNode, key: 'position' | 'rotation', fallback: Vec3): Vec3 {
  const value = (node as unknown as Record<string, unknown>)[key]
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? (value as Vec3)
    : fallback
}

function numberField(node: AnyNode, key: string, fallback: number) {
  const value = (node as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function envelopeFromNode(node: AnyNode, contract: ProcessEquipmentContract): EquipmentNodeEnvelope {
  return {
    length: numberField(node, 'length', contract.envelope.length),
    width: numberField(node, 'width', contract.envelope.width),
    height: numberField(node, 'height', contract.envelope.height),
  }
}

function routeObstacleForNode(input: {
  node: AnyNode
  stationPlacement: StationPlacement
  contract: ProcessEquipmentContract
}): FactoryRouteObstacleMetadata {
  const envelope = envelopeFromNode(input.node, input.contract)
  const position = nodeVec3(input.node, 'position', input.stationPlacement.position)
  const rotation = nodeVec3(input.node, 'rotation', input.stationPlacement.rotation)
  const yaw = rotation[1] ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  const corners = [
    [-envelope.length / 2, -envelope.width / 2],
    [envelope.length / 2, -envelope.width / 2],
    [envelope.length / 2, envelope.width / 2],
    [-envelope.length / 2, envelope.width / 2],
  ] as const
  for (const [localX, localZ] of corners) {
    const x = position[0] + localX * cos - localZ * sin
    const z = position[2] + localX * sin + localZ * cos
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return {
    stationId: input.stationPlacement.stationId,
    source: 'factory-node',
    minHeight: rounded(position[1]),
    maxHeight: rounded(position[1] + envelope.height),
    box: {
      minX: rounded(minX),
      maxX: rounded(maxX),
      minZ: rounded(minZ),
      maxZ: rounded(maxZ),
    },
  }
}

function processMedium(value: string): ProcessConnectionMedium {
  return PROCESS_MEDIA.has(value as ProcessConnectionMedium)
    ? (value as ProcessConnectionMedium)
    : 'material'
}

function equipmentContractMetadata(contract: ProcessEquipmentContract) {
  return {
    profileId: contract.profileId,
    equipmentFamily: contract.equipmentFamily,
    scaleClass: contract.scaleClass,
    envelope: contract.envelope,
    ports: contract.ports.map((port) => ({
      id: port.id,
      medium: port.medium,
      side: port.side,
      height: port.height,
      ...(port.offset != null ? { offset: port.offset } : {}),
      ...(port.direction ? { direction: port.direction } : {}),
    })),
    ...(contract.requiredRoles ? { requiredRoles: contract.requiredRoles } : {}),
    ...(contract.preferredResolver ? { preferredResolver: contract.preferredResolver } : {}),
    ...(contract.preferredTool ? { preferredTool: contract.preferredTool } : {}),
    ...(contract.primarySemanticRole
      ? { primarySemanticRole: contract.primarySemanticRole }
      : {}),
  }
}

function processSide(side: EquipmentPort['side']): ProcessEquipmentPort['side'] | undefined {
  if (side === 'bottom') return undefined
  return side
}

function localPortPoint(port: EquipmentPort, envelope: EquipmentNodeEnvelope) {
  const offset = port.offset ?? 0
  switch (port.side) {
    case 'left':
      return [-envelope.length / 2, offset] as const
    case 'right':
      return [envelope.length / 2, offset] as const
    case 'front':
      return [offset, envelope.width / 2] as const
    case 'back':
      return [offset, -envelope.width / 2] as const
    case 'top':
    case 'bottom':
      return [offset, 0] as const
  }
}

function portOverridesFromNode(input: {
  node: AnyNode
  ports: EquipmentPort[]
  stationPlacement: StationPlacement
  contract: ProcessEquipmentContract
}): ProcessRoutePortEndpoint[] {
  const envelope = envelopeFromNode(input.node, input.contract)
  const position = nodeVec3(input.node, 'position', input.stationPlacement.position)
  const rotation = nodeVec3(input.node, 'rotation', input.stationPlacement.rotation)
  const yaw = rotation[1] ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return input.ports.flatMap((port) => {
    const side = processSide(port.side)
    if (!side) return []
    const [localX, localZ] = localPortPoint(port, envelope)
    return [
      {
        stationId: input.stationPlacement.stationId,
        portId: port.id,
        medium: processMedium(port.medium),
        point: [
          rounded(position[0] + localX * cos - localZ * sin),
          rounded(position[2] + localX * sin + localZ * cos),
        ],
        height: rounded(position[1] + port.height),
        side,
        profileId: input.contract.profileId,
        source: 'node',
      },
    ]
  })
}

export function resolveFactoryEquipmentNode(input: {
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  placement: GeneratedGeometryPlacementSpec
  metadata: Record<string, unknown>
  contract?: ProcessEquipmentContract
  registry?: NodeRegistry
}): FactoryEquipmentNodeResolution | null {
  if (!input.contract) return null
  const registry = input.registry ?? nodeRegistry
  const nodeKind = factoryNodeKindFor({
    station: input.station,
    contract: input.contract,
    registry,
  })
  if (!nodeKind) return null
  const params = paramsForNodeKind({ nodeKind, station: input.station, contract: input.contract })
  if (!params) return null
  const spec: EquipmentSpec = {
    nodeKind,
    profileId: input.contract.profileId,
    params,
    position: input.stationPlacement.position,
    rotation: input.stationPlacement.rotation,
    metadata: {
      ...jsonRecord(input.metadata),
      equipmentRole: input.station.role,
      resolver: 'factory-node',
      resolverReason: 'equipment contract compiled to registered factory node',
      factoryNodeKind: nodeKind,
      factoryEquipmentEnvelope: input.contract.envelope,
    },
  }
  const patch = createEquipmentNodePatch({
    spec,
    parentId: input.placement.parentId,
    registry,
  })
  const def = registry.get(nodeKind)
  const ports =
    def?.ports?.(patch.node as never, {
      resolve: () => undefined,
      children: [],
      siblings: [],
      parent: null,
    }) ?? []
  const routeObstacle = routeObstacleForNode({
    node: patch.node,
    stationPlacement: input.stationPlacement,
    contract: input.contract,
  })
  const portOverrides = portOverridesFromNode({
    node: patch.node,
    ports,
    stationPlacement: input.stationPlacement,
    contract: input.contract,
  })
  return {
    nodeKind,
    routeObstacle,
    portOverrides,
    patch: {
      ...patch,
      node: {
        ...patch.node,
        metadata: {
          ...(patch.node.metadata as Record<string, unknown>),
          factoryRouteObstacle: routeObstacle,
          factoryNodePorts: portOverrides,
          equipmentContract: equipmentContractMetadata(input.contract),
        },
      },
    },
  }
}
