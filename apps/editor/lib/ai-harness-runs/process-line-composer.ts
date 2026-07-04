import {
  BoxNode,
  CableTrayNode,
  PipeFittingNode,
  PipeNode,
  SweepNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import type {
  GeneratedGeometryCreatePatch,
  GeneratedGeometryPlacementSpec,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import {
  buildFactoryLayoutCreatePatches,
  resolveFactoryLayoutCenter,
} from './factory-layout-patches'
import type { FactoryMissingAsset } from './factory-runner'
import { resolveProcessStationEquipment } from './process-equipment-resolver'
import { resolveProcessLineLayout } from './process-line-layout'
import {
  localizeProcessLinePlan,
  processDisplayLabel,
  stationDisplayLabel,
} from './process-line-localization'
import type {
  ProcessConnectionRoute,
  ProcessRouteObstacle,
  ProcessRoutePortOverrides,
  ProcessRouteSegment,
} from './process-line-routing'
import { routeProcessConnection } from './process-line-routing'
import type {
  ProcessConnectionMedium,
  ProcessConnectionPlan,
  ProcessConnectionVisualKind,
  ProcessLayoutDiagnostics,
  ProcessLayoutStrategy,
  ProcessLineFocusBounds,
  ProcessLinePlan,
  ProcessPrimitiveRequest,
  ProcessStationPlan,
  StationPlacement,
} from './process-line-types'

type Vec2 = [number, number]

export type ProcessLineComposerResult = {
  patches: GeneratedGeometryCreatePatch[]
  nodeIds: string[]
  created: string[]
  missingAssets: FactoryMissingAsset[]
  focusBounds?: ProcessLineFocusBounds
  stationPlacements: StationPlacement[]
  layoutDiagnostics: ProcessLayoutDiagnostics
  layoutStrategy: ProcessLayoutStrategy
  primitiveRequests: ProcessPrimitiveRequest[]
  portOverrides: ProcessRoutePortOverrides
  routeObstacles: ProcessRouteObstacle[]
  summary: string
}

export type ProcessLineComposerSections = {
  shell?: boolean
  stations?: boolean
  connections?: boolean
}

const MEDIUM_COLOR: Record<ProcessConnectionMedium, string> = {
  water: '#38bdf8',
  hydrogen: '#facc15',
  oxygen: '#60a5fa',
  power: '#f97316',
  cooling: '#22d3ee',
  material: '#a3a3a3',
  gas: '#64748b',
  molten_metal: '#dc2626',
}

const PROCESS_CONNECTION_MEDIA = new Set<ProcessConnectionMedium>([
  'water',
  'hydrogen',
  'oxygen',
  'power',
  'cooling',
  'material',
  'gas',
  'molten_metal',
])

function normalizeConnectionMedium(value: unknown): ProcessConnectionMedium | undefined {
  return typeof value === 'string' && PROCESS_CONNECTION_MEDIA.has(value as ProcessConnectionMedium)
    ? (value as ProcessConnectionMedium)
    : undefined
}

function isCementProcessLine(plan: ProcessLinePlan) {
  return plan.sourcePack?.industry === 'cement' || plan.processId?.startsWith('cement_') === true
}

function processLineOmitPerimeterWalls(plan: ProcessLinePlan) {
  return plan.architecture?.omitPerimeterWalls ?? (isCementProcessLine(plan) ? true : undefined)
}

type ConnectionRenderSpec = {
  nodeKind: 'pipe' | 'cable_tray'
  label: string
  resolver: string
  color: string
  elevation: number
  diameter?: number
  insulated?: boolean
  temperatureC?: number
  tray?: {
    width: number
    sideHeight: number
    thickness: number
    rungSpacing: number
    showRungs: boolean
  }
}

const ROUTE_SUPPORT_MIN_ELEVATION = 1.2
const ROUTE_SUPPORT_MAX_SPACING = 5
const ROUTE_SUPPORT_SECTION = 0.08

function connectionRenderSpec(
  visualKind: ProcessConnectionVisualKind,
  medium?: ProcessConnectionMedium,
): ConnectionRenderSpec {
  const normalizedMedium = normalizeConnectionMedium(medium)
  if (visualKind === 'cable_tray') {
    return {
      nodeKind: 'cable_tray',
      label: 'cable tray',
      resolver: 'native-cable-tray',
      color: MEDIUM_COLOR.power,
      elevation: 2.4,
    }
  }
  if (visualKind === 'flow_arrow') {
    return {
      nodeKind: 'cable_tray',
      label: 'transfer route',
      resolver: 'native-flow-transfer',
      color: MEDIUM_COLOR[normalizedMedium ?? 'material'],
      elevation: 2.1,
      tray: { width: 0.42, sideHeight: 0.08, thickness: 0.035, rungSpacing: 0.5, showRungs: false },
    }
  }
  if (visualKind === 'material_conveyor') {
    return {
      nodeKind: 'cable_tray',
      label: 'material conveyor',
      resolver: 'native-material-conveyor',
      color: '#5b6472',
      elevation: 1.05,
      tray: { width: 0.72, sideHeight: 0.12, thickness: 0.04, rungSpacing: 0.55, showRungs: true },
    }
  }
  if (visualKind === 'hot_material_chute') {
    return {
      nodeKind: 'pipe',
      label: 'hot material chute',
      resolver: 'native-hot-material-chute',
      color: '#b45309',
      elevation: 1.6,
      diameter: 0.18,
      insulated: true,
      temperatureC: 650,
    }
  }
  if (visualKind === 'air_duct') {
    return {
      nodeKind: 'pipe',
      label: 'air duct',
      resolver: 'native-air-duct',
      color: '#64748b',
      elevation: 2.8,
      diameter: 0.14,
      insulated: false,
      temperatureC: 80,
    }
  }
  if (visualKind === 'hot_gas_duct') {
    return {
      nodeKind: 'pipe',
      label: 'hot gas duct',
      resolver: 'native-hot-gas-duct',
      color: '#8b5e34',
      elevation: 3.2,
      diameter: 0.16,
      insulated: true,
      temperatureC: 360,
    }
  }
  return {
    nodeKind: 'pipe',
    label: 'pipe',
    resolver: 'native-pipe',
    color: MEDIUM_COLOR[normalizedMedium ?? 'material'],
    elevation: 1.15,
    diameter: pipeDiameter(normalizedMedium),
    insulated: normalizedMedium === 'cooling',
    temperatureC: 20,
  }
}

function patchParentId(placement: GeneratedGeometryPlacementSpec) {
  return placement.parentId == null ? undefined : (placement.parentId as never)
}

function parentPatch(
  node: GeneratedGeometryCreatePatch['node'],
  placement: GeneratedGeometryPlacementSpec,
): GeneratedGeometryCreatePatch {
  const parentId = patchParentId(placement)
  return { op: 'create' as const, node, ...(parentId ? { parentId } : {}) }
}

function rectanglePolygon(centerX: number, centerZ: number, length: number, width: number): Vec2[] {
  const halfL = length / 2
  const halfW = width / 2
  return [
    [centerX - halfL, centerZ - halfW],
    [centerX + halfL, centerZ - halfW],
    [centerX + halfL, centerZ + halfW],
    [centerX - halfL, centerZ + halfW],
  ]
}

function processMetadata(input: {
  plan: ProcessLinePlan
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
  focusBounds?: ProcessLineFocusBounds
}) {
  return {
    generatedBy: input.placement.generatedBy ?? 'factory-agent',
    processId: input.plan.processId,
    processLabel: input.plan.processLabel,
    processDisplayLabel: processDisplayLabel(input.plan),
    processDomain: input.plan.domain,
    sourcePrompt: input.sourcePrompt,
    conceptualVisualizationOnly: true,
    ...(input.focusBounds
      ? {
          factoryCameraFocus: {
            reason: input.focusBounds.reason,
            stationIds: input.focusBounds.stationIds,
            bounds: {
              min: input.focusBounds.min,
              max: input.focusBounds.max,
              center: input.focusBounds.center,
              size: input.focusBounds.size,
            },
          },
        }
      : {}),
    ...input.placement.metadata,
  }
}

function stationMetadata(input: {
  plan: ProcessLinePlan
  station: ProcessStationPlan
  stationIndex: number
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}) {
  return {
    ...processMetadata(input),
    stationId: input.station.id,
    stationRole: input.station.role,
    stationLabel: input.station.label,
    stationDisplayLabel: stationDisplayLabel(input.station),
    stationIndex: input.stationIndex,
    ...(input.station.safetyTags?.length ? { safetyTags: input.station.safetyTags } : {}),
  }
}

function createStationZone(input: {
  plan: ProcessLinePlan
  station: ProcessStationPlan
  stationIndex: number
  stationPlacement: StationPlacement
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
  resolved: boolean
}) {
  const zoneDisplay = input.plan.architecture?.zoneDisplay ?? 'debug'
  const zoneColor =
    zoneDisplay === 'subtle'
      ? input.resolved
        ? '#94a3b8'
        : '#f59e0b'
      : input.resolved
        ? '#22c55e'
        : '#f97316'
  const node = ZoneNode.parse({
    name: stationDisplayLabel(input.station),
    polygon: rectanglePolygon(
      input.stationPlacement.position[0],
      input.stationPlacement.position[2],
      input.stationPlacement.footprint.length,
      input.stationPlacement.footprint.width,
    ),
    color: zoneColor,
    metadata: {
      ...stationMetadata(input),
      role: 'process-line-station',
      factoryZoneDisplay: zoneDisplay,
      equipmentResolution: input.resolved ? 'resolved' : 'primitive_pending',
    },
  })
  return parentPatch(node, input.placement)
}

function pipeMedium(medium?: ProcessConnectionMedium) {
  return medium === 'water' || medium === 'cooling' ? 'water' : 'steam'
}

function pipeDiameter(medium?: ProcessConnectionMedium) {
  if (medium === 'gas') return 0.14
  if (medium === 'molten_metal') return 0.3
  return medium === 'hydrogen' || medium === 'oxygen' ? 0.12 : 0.16
}

function connectionSegmentName(input: {
  connection: ProcessConnectionPlan
  connectionIndex: number
  segmentIndex: number
  segmentCount: number
}) {
  const medium = normalizeConnectionMedium(input.connection.medium)
  const suffix =
    input.segmentCount > 1
      ? `${input.connectionIndex + 1}.${input.segmentIndex + 1}`
      : `${input.connectionIndex + 1}`
  const spec = connectionRenderSpec(input.connection.visualKind, medium)
  return `${medium ?? 'process'} ${spec.label} ${suffix}`
}

function connectionMetadata(input: {
  plan: ProcessLinePlan
  connection: ProcessConnectionPlan
  connectionIndex: number
  route: ProcessConnectionRoute
  segmentIndex?: number
  segmentCount?: number
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}) {
  const medium = normalizeConnectionMedium(input.connection.medium)
  return {
    ...processMetadata(input),
    role: 'process-line-connection',
    ...(medium ? { connectionRole: medium } : {}),
    connectionIndex: input.connectionIndex,
    fromStationId: input.connection.fromStationId,
    toStationId: input.connection.toStationId,
    ...(input.connection.fromPortId ? { fromPortIdHint: input.connection.fromPortId } : {}),
    ...(input.connection.toPortId ? { toPortIdHint: input.connection.toPortId } : {}),
    visualKind: input.connection.visualKind,
    routeId: input.route.routeId,
    routeStyle: input.route.style,
    routeFallback: input.route.fallback,
    routePointCount: input.route.points.length,
    routeAvoidedStationIds: input.route.avoidedStationIds,
    ...(input.route.fromPort
      ? {
          fromPortId: input.route.fromPort.portId,
          fromPortMedium: input.route.fromPort.medium,
          fromPortSide: input.route.fromPort.side,
          fromPortProfileId: input.route.fromPort.profileId,
          fromPortSource: input.route.fromPort.source ?? 'profile',
        }
      : {}),
    ...(input.route.toPort
      ? {
          toPortId: input.route.toPort.portId,
          toPortMedium: input.route.toPort.medium,
          toPortSide: input.route.toPort.side,
          toPortProfileId: input.route.toPort.profileId,
          toPortSource: input.route.toPort.source ?? 'profile',
        }
      : {}),
    ...(input.segmentIndex != null ? { routeSegmentIndex: input.segmentIndex } : {}),
    ...(input.segmentCount != null ? { routeSegmentCount: input.segmentCount } : {}),
    resolver: connectionRenderSpec(input.connection.visualKind, medium).resolver,
  }
}

function createConnectionPatch(input: {
  plan: ProcessLinePlan
  connection: ProcessConnectionPlan
  connectionIndex: number
  route: ProcessConnectionRoute
  segment: ProcessRouteSegment
  segmentIndex: number
  segmentCount: number
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}): GeneratedGeometryCreatePatch {
  const metadata = connectionMetadata(input)
  const medium = normalizeConnectionMedium(input.connection.medium)
  const spec = connectionRenderSpec(input.connection.visualKind, medium)
  if (spec.nodeKind === 'cable_tray') {
    const node = CableTrayNode.parse({
      name: connectionSegmentName(input),
      start: input.segment.start,
      end: input.segment.end,
      elevation: input.route.elevation ?? spec.elevation,
      ...(spec.tray ?? {}),
      color: spec.color,
      metadata,
    })
    return parentPatch(node, input.placement)
  }

  const node = PipeNode.parse({
    name: connectionSegmentName(input),
    start: input.segment.start,
    end: input.segment.end,
    elevation: input.route.elevation ?? spec.elevation,
    diameter: spec.diameter ?? pipeDiameter(medium),
    insulated: spec.insulated ?? medium === 'cooling',
    pressureKpa: 0,
    temperatureC: spec.temperatureC ?? 20,
    medium: pipeMedium(medium),
    color: spec.color,
    metadata,
  })
  return parentPatch(node, input.placement)
}

function segmentLength(segment: ProcessRouteSegment) {
  return Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1])
}

function interpolatedSegmentPoint(segment: ProcessRouteSegment, t: number): [number, number] {
  return [
    segment.start[0] + (segment.end[0] - segment.start[0]) * t,
    segment.start[1] + (segment.end[1] - segment.start[1]) * t,
  ]
}

function createRouteSupportPatch(input: {
  name: string
  position: [number, number, number]
  height: number
  metadata: Record<string, unknown>
  placement: GeneratedGeometryPlacementSpec
}): GeneratedGeometryCreatePatch {
  const node = BoxNode.parse({
    name: input.name,
    position: input.position,
    rotation: [0, 0, 0],
    length: ROUTE_SUPPORT_SECTION,
    width: ROUTE_SUPPORT_SECTION,
    height: input.height,
    material: {
      preset: 'metal',
      properties: {
        color: '#475569',
        roughness: 0.46,
        metalness: 0.55,
      },
    },
    metadata: input.metadata,
  })
  return parentPatch(node, input.placement)
}

function createConnectionSupportPatches(input: {
  plan: ProcessLinePlan
  connection: ProcessConnectionPlan
  connectionIndex: number
  route: ProcessConnectionRoute
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}) {
  const medium = normalizeConnectionMedium(input.connection.medium)
  const spec = connectionRenderSpec(input.connection.visualKind, medium)
  const elevation = input.route.elevation ?? spec.elevation
  if (elevation < ROUTE_SUPPORT_MIN_ELEVATION) return []

  const patches: GeneratedGeometryCreatePatch[] = []
  input.route.segments.forEach((segment, segmentIndex) => {
    const length = segmentLength(segment)
    if (length < 0.35) return
    const supportCount = Math.max(1, Math.floor(length / ROUTE_SUPPORT_MAX_SPACING))
    for (let supportIndex = 1; supportIndex <= supportCount; supportIndex += 1) {
      const [x, z] = interpolatedSegmentPoint(segment, supportIndex / (supportCount + 1))
      const supportHeight = Math.max(0.05, elevation - ROUTE_SUPPORT_SECTION / 2)
      patches.push(
        createRouteSupportPatch({
          name: `${connectionSegmentName({
            connection: input.connection,
            connectionIndex: input.connectionIndex,
            segmentIndex,
            segmentCount: input.route.segments.length,
          })} support ${supportIndex}`,
          position: [x, supportHeight / 2, z],
          height: supportHeight,
          metadata: {
            ...connectionMetadata({
              ...input,
              segmentIndex,
              segmentCount: input.route.segments.length,
            }),
            role: 'process-line-connection-support',
            supportIndex,
            supportElevation: elevation,
            resolver: 'native-route-support',
          },
          placement: input.placement,
        }),
      )
    }
  })
  return patches
}

function createConnectionPatches(input: {
  plan: ProcessLinePlan
  connection: ProcessConnectionPlan
  connectionIndex: number
  route: ProcessConnectionRoute
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}): GeneratedGeometryCreatePatch[] {
  const segmentCount = input.route.segments.length
  const segments = input.route.segments.map((segment, segmentIndex) =>
    createConnectionPatch({
      ...input,
      segment,
      segmentIndex,
      segmentCount,
    }),
  )
  return [...segments, ...createConnectionSupportPatches(input)]
}

function createRouteElbowFittings(input: {
  plan: ProcessLinePlan
  connection: ProcessConnectionPlan
  connectionIndex: number
  route: ProcessConnectionRoute
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}) {
  const medium = normalizeConnectionMedium(input.connection.medium)
  const spec = connectionRenderSpec(input.connection.visualKind, medium)
  if (spec.nodeKind !== 'pipe' || input.route.points.length < 3) return []

  const patches: GeneratedGeometryCreatePatch[] = []
  for (let pointIndex = 1; pointIndex < input.route.points.length - 1; pointIndex += 1) {
    const point = input.route.points[pointIndex]
    if (!point) continue
    const node = PipeFittingNode.parse({
      name: `${medium ?? 'process'} pipe elbow ${input.connectionIndex + 1}.${pointIndex}`,
      fittingKind: 'elbow',
      position: [point[0], input.route.elevation ?? spec.elevation, point[1]],
      diameter: spec.diameter ?? pipeDiameter(medium),
      pressureKpa: 0,
      temperatureC: spec.temperatureC ?? 20,
      medium: pipeMedium(medium),
      color: spec.color,
      metadata: {
        ...connectionMetadata(input),
        role: 'process-line-route-elbow',
        routePointIndex: pointIndex,
        resolver: 'native-pipe-fitting',
      },
    })
    patches.push(parentPatch(node, input.placement))
  }
  return patches
}

function createConnectionFittings(input: {
  plan: ProcessLinePlan
  placements: Map<string, StationPlacement>
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}) {
  const outgoing = new Map<string, ProcessConnectionPlan[]>()
  for (const connection of input.plan.connections) {
    const medium = normalizeConnectionMedium(connection.medium)
    if (connectionRenderSpec(connection.visualKind, medium).nodeKind !== 'pipe') continue
    outgoing.set(connection.fromStationId, [
      ...(outgoing.get(connection.fromStationId) ?? []),
      connection,
    ])
  }

  const patches: GeneratedGeometryCreatePatch[] = []
  for (const [stationId, connections] of outgoing.entries()) {
    if (connections.length < 2) continue
    const station = input.placements.get(stationId)
    if (!station) continue
    const medium = normalizeConnectionMedium(
      connections.find((connection) => connection.medium)?.medium,
    )
    const node = PipeFittingNode.parse({
      name: `${station.displayLabel ?? station.label} branch tee`,
      fittingKind: 'tee',
      position: [station.position[0], 1.15, station.position[2]],
      diameter: 0.14,
      pressureKpa: 0,
      temperatureC: 20,
      medium: pipeMedium(medium),
      color: MEDIUM_COLOR[medium ?? 'material'],
      metadata: {
        ...processMetadata(input),
        role: 'process-line-fitting',
        ...(medium ? { connectionRole: medium } : {}),
        stationId,
        stationRole: station.role,
        resolver: 'native-pipe-fitting',
      },
    })
    patches.push(parentPatch(node, input.placement))
  }
  return patches
}

function isCementTertiaryAirStation(plan: ProcessLinePlan, stationId: string) {
  return plan.processId === 'cement_plant_full' && stationId === 'tertiary_air_duct'
}

function isCementTertiaryAirConnection(plan: ProcessLinePlan, connection: ProcessConnectionPlan) {
  if (plan.processId !== 'cement_plant_full') return false
  return (
    (connection.fromStationId === 'grate_cooler' &&
      connection.toStationId === 'tertiary_air_duct') ||
    (connection.fromStationId === 'tertiary_air_duct' &&
      connection.toStationId === 'preheater_tower')
  )
}

const OCCUPIED_BUILDING_DIMENSIONS = {
  length: 5,
  width: 4,
  storyHeight: 2.5,
}

function roundedMetric(value: number) {
  return Math.round(value * 1000) / 1000
}

function isOccupiedBuildingStation(station: ProcessStationPlan) {
  return (
    station.id === 'control_room' ||
    station.role === 'control_room' ||
    station.safetyTags?.includes('occupied_building') === true
  )
}

function occupiedBuildingDisplayLabel(station: ProcessStationPlan) {
  const label = stationDisplayLabel(station)
  const isControlRoom = station.id === 'control_room' || station.role === 'control_room'
  const hasCjk = /[\u4e00-\u9fff]/.test(label)
  if (isControlRoom) {
    if (hasCjk) return label.endsWith('\u5ba4') ? `${label.slice(0, -1)}\u697c` : `${label}\u697c`
    return `${label} building`
  }
  return hasCjk ? `${label}\u5efa\u7b51` : `${label} building`
}

function createOccupiedBuildingPatches(input: {
  plan: ProcessLinePlan
  station: ProcessStationPlan
  stationIndex: number
  stationPlacement: StationPlacement
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}): {
  patches: GeneratedGeometryCreatePatch[]
  routeObstacle: ProcessRouteObstacle
} {
  const centerX = input.stationPlacement.position[0]
  const centerZ = input.stationPlacement.position[2]
  const { length, width, storyHeight } = OCCUPIED_BUILDING_DIMENSIONS
  const metadata = stationMetadata({
    plan: input.plan,
    station: input.station,
    stationIndex: input.stationIndex,
    sourcePrompt: input.sourcePrompt,
    placement: input.placement,
  })
  const buildingDisplayLabel = occupiedBuildingDisplayLabel(input.station)
  const patchPlan = buildFactoryLayoutCreatePatches({
    prompt: `${stationDisplayLabel(input.station)} 5m x 4m x 2.5m flat roof control room`,
    plan: {
      kind: 'layout',
      reason: 'Occupied process station should be represented by native architectural nodes.',
      layoutType: 'room',
      suggestedOperations: ['create_room', 'add_door', 'add_window', 'create_roof'],
      stories: 1,
      storyHeight,
      hasRoof: true,
      roofType: 'flat',
    },
    placement: {
      ...input.placement,
      position: [centerX, 0, centerZ],
      rotation: input.stationPlacement.rotation,
      metadata: {
        ...metadata,
        parentProcessDisplayLabel: metadata.processDisplayLabel,
        processDisplayLabel: buildingDisplayLabel,
        equipmentRole: input.station.role,
        resolver: 'native-occupied-building',
        resolverReason: 'occupied building station uses native wall/slab/roof nodes',
        nativeBuildingDimensions: { length, width, height: storyHeight },
      },
    },
    params: {
      length,
      width,
      storyHeight,
      hasRoof: true,
      roofType: 'flat',
    },
  })
  return {
    patches: patchPlan.patches,
    routeObstacle: {
      stationId: input.stationPlacement.stationId,
      source: 'layout',
      minHeight: 0,
      maxHeight: roundedMetric(storyHeight + 0.2),
      box: {
        minX: roundedMetric(centerX - length / 2),
        maxX: roundedMetric(centerX + length / 2),
        minZ: roundedMetric(centerZ - width / 2),
        maxZ: roundedMetric(centerZ + width / 2),
      },
    },
  }
}

function pathCenter(points: Array<[number, number, number]>): [number, number, number] {
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const zs = points.map((point) => point[2])
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
    (Math.min(...zs) + Math.max(...zs)) / 2,
  ]
}

function createCementTertiaryAirDuctPatch(input: {
  plan: ProcessLinePlan
  placements: Map<string, StationPlacement>
  stationPlacements: StationPlacement[]
  boundary: { length: number; width: number; centerX?: number; centerZ?: number }
  routeObstacles: ProcessRouteObstacle[]
  portOverrides?: ProcessRoutePortOverrides
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}): GeneratedGeometryCreatePatch[] {
  if (input.plan.processId !== 'cement_plant_full') return []
  const coolerConnection = input.plan.connections.find(
    (connection) =>
      connection.fromStationId === 'grate_cooler' && connection.toStationId === 'tertiary_air_duct',
  )
  const preheaterConnection = input.plan.connections.find(
    (connection) =>
      connection.fromStationId === 'tertiary_air_duct' &&
      connection.toStationId === 'preheater_tower',
  )
  if (!coolerConnection || !preheaterConnection) return []

  const virtualConnection: ProcessConnectionPlan = {
    fromStationId: 'grate_cooler',
    toStationId: 'preheater_tower',
    medium: 'gas',
    visualKind: 'hot_gas_duct',
    fromPortId: coolerConnection.fromPortId,
    toPortId: preheaterConnection.toPortId,
  }
  const route = routeProcessConnection({
    plan: input.plan,
    connection: virtualConnection,
    connectionIndex: input.plan.connections.indexOf(coolerConnection),
    placements: input.placements,
    stationPlacements: input.stationPlacements,
    boundary: input.boundary,
    portOverrides: input.portOverrides,
    routeObstacles: input.routeObstacles,
  })
  const fromPoint = route?.fromPort?.point ?? input.placements.get('grate_cooler')?.position
  const toPoint = route?.toPort?.point ?? input.placements.get('preheater_tower')?.position
  if (!fromPoint || !toPoint) return []

  const fromHeight = route?.fromPort?.height ?? 1.4
  const toHeight = route?.toPort?.height ?? 5.9
  const highPointHeight = Math.max(fromHeight, toHeight, 5.2)
  const start: [number, number, number] = [
    fromPoint[0],
    Math.max(fromHeight + 0.25, 1.8),
    fromPoint[1],
  ]
  const mid: [number, number, number] = [
    (fromPoint[0] + toPoint[0]) / 2,
    highPointHeight,
    (fromPoint[1] + toPoint[1]) / 2,
  ]
  const end: [number, number, number] = [toPoint[0], toHeight, toPoint[1]]
  const path = [start, mid, end]
  const node = SweepNode.parse({
    name: '\u4e09\u6b21\u98ce\u7ba1\u8de8\u7ebf\u98ce\u7ba1',
    position: pathCenter(path),
    path,
    radius: 0.18,
    tubularSegments: 16,
    radialSegments: 4,
    material: {
      preset: 'metal',
      properties: {
        color: '#8b5e34',
        roughness: 0.58,
        metalness: 0.22,
      },
    },
    metadata: {
      ...processMetadata({
        plan: input.plan,
        sourcePrompt: input.sourcePrompt,
        placement: input.placement,
      }),
      role: 'process-line-route-equipment',
      stationId: 'tertiary_air_duct',
      stationRole: 'tertiary_air_duct',
      stationLabel: 'Tertiary air duct',
      stationDisplayLabel: '\u4e09\u6b21\u98ce\u7ba1',
      connectionRole: 'gas',
      visualKind: 'hot_gas_duct',
      fromStationId: 'grate_cooler',
      toStationId: 'preheater_tower',
      viaStationId: 'tertiary_air_duct',
      routeConnectionLegs: [
        {
          fromStationId: coolerConnection.fromStationId,
          toStationId: coolerConnection.toStationId,
          visualKind: coolerConnection.visualKind,
          ...(coolerConnection.fromPortId ? { fromPortId: coolerConnection.fromPortId } : {}),
          ...(coolerConnection.toPortId ? { toPortId: coolerConnection.toPortId } : {}),
        },
        {
          fromStationId: preheaterConnection.fromStationId,
          toStationId: preheaterConnection.toStationId,
          visualKind: preheaterConnection.visualKind,
          ...(preheaterConnection.fromPortId ? { fromPortId: preheaterConnection.fromPortId } : {}),
          ...(preheaterConnection.toPortId ? { toPortId: preheaterConnection.toPortId } : {}),
        },
      ],
      fromPortId: route?.fromPort?.portId ?? coolerConnection.fromPortId,
      toPortId: route?.toPort?.portId ?? preheaterConnection.toPortId,
      fromPortMedium: route?.fromPort?.medium ?? 'gas',
      toPortMedium: route?.toPort?.medium ?? 'gas',
      resolver: 'native-rectangular-duct-sweep',
      primitiveContract: {
        duct: {
          crossSection: 'rectangular',
          width: 0.46,
          height: 0.28,
        },
      },
    },
  })
  const supports: GeneratedGeometryCreatePatch[] = []
  path.forEach((point, supportIndex) => {
    const supportHeight = Math.max(0.05, point[1] - ROUTE_SUPPORT_SECTION / 2)
    if (supportHeight < ROUTE_SUPPORT_MIN_ELEVATION) return
    supports.push(
      createRouteSupportPatch({
        name: `\u4e09\u6b21\u98ce\u7ba1\u652f\u6491 ${supportIndex + 1}`,
        position: [point[0], supportHeight / 2, point[2]],
        height: supportHeight,
        metadata: {
          ...processMetadata({
            plan: input.plan,
            sourcePrompt: input.sourcePrompt,
            placement: input.placement,
          }),
          role: 'process-line-connection-support',
          stationId: 'tertiary_air_duct',
          stationRole: 'tertiary_air_duct',
          stationLabel: 'Tertiary air duct',
          stationDisplayLabel: '\u4e09\u6b21\u98ce\u7ba1',
          connectionRole: 'gas',
          visualKind: 'hot_gas_duct',
          fromStationId: 'grate_cooler',
          toStationId: 'preheater_tower',
          viaStationId: 'tertiary_air_duct',
          supportIndex: supportIndex + 1,
          supportElevation: point[1],
          resolver: 'native-route-support',
        },
        placement: input.placement,
      }),
    )
  })
  return [parentPatch(node, input.placement), ...supports]
}

const CEMENT_KEY_PROCESS_STATIONS = [
  'preheater_tower',
  'rotary_kiln',
  'kiln_burner',
  'kiln_hood',
  'grate_cooler',
  'tertiary_air_duct',
  'clinker_crusher',
  'clinker_conveying',
  'clinker_silo',
  'kiln_tail_esp',
  'process_stack',
]

function processLineCenter(input: {
  prompt: string
  plan: ProcessLinePlan
  placement: GeneratedGeometryPlacementSpec
  dimensions: { length: number; width: number }
  focusBounds?: ProcessLineFocusBounds
}) {
  return resolveFactoryLayoutCenter({
    prompt: input.prompt,
    dimensions: input.dimensions,
    metadata: processMetadata({
      plan: input.plan,
      sourcePrompt: input.prompt,
      placement: input.placement,
      focusBounds: input.focusBounds,
    }),
    placement: input.placement,
  })
}

function focusBoundsFromPlacements(input: {
  plan: ProcessLinePlan
  stationPlacements: StationPlacement[]
}): ProcessLineFocusBounds | undefined {
  const cementFocusIds =
    input.plan.processId === 'cement_plant_full' ||
    input.plan.processId === 'cement_clinker_production_line'
      ? CEMENT_KEY_PROCESS_STATIONS
      : []
  const architectureFocusIds = input.plan.architecture?.keyFocusStationIds ?? []
  const preferredIds = cementFocusIds.length
    ? cementFocusIds
    : [...new Set([...architectureFocusIds])]
  const preferred = preferredIds.length
    ? input.stationPlacements.filter((placement) => preferredIds.includes(placement.stationId))
    : []
  const placements = preferred.length >= 2 ? preferred : input.stationPlacements
  if (!placements.length) return undefined

  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const placement of placements) {
    minX = Math.min(minX, placement.clearanceBox.minX)
    minZ = Math.min(minZ, placement.clearanceBox.minZ)
    maxX = Math.max(maxX, placement.clearanceBox.maxX)
    maxZ = Math.max(maxZ, placement.clearanceBox.maxZ)
  }

  const padding = preferred.length >= 2 ? 1.5 : 0.8
  minX -= padding
  minZ -= padding
  maxX += padding
  maxZ += padding

  return {
    min: [minX, minZ],
    max: [maxX, maxZ],
    center: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxZ - minZ],
    stationIds: placements.map((placement) => placement.stationId),
    reason: preferred.length >= 2 ? 'factory-key-process' : 'process-line',
  }
}

export function composeProcessLine(input: {
  prompt: string
  plan: ProcessLinePlan
  placement: GeneratedGeometryPlacementSpec
  params?: Record<string, unknown>
  sections?: ProcessLineComposerSections
  portOverrides?: ProcessRoutePortOverrides
  routeObstacles?: ProcessRouteObstacle[]
}): ProcessLineComposerResult {
  const plan = localizeProcessLinePlan(input.plan, input.prompt)
  const sections = {
    shell: input.sections?.shell ?? true,
    stations: input.sections?.stations ?? true,
    connections: input.sections?.connections ?? true,
  }
  const length = plan.dimensions?.length ?? 24
  const width = plan.dimensions?.width ?? 9
  const initialCenter = processLineCenter({
    prompt: input.prompt,
    plan,
    placement: input.placement,
    dimensions: { length, width },
  })
  const layoutBoundary = {
    length,
    width,
    centerX: initialCenter.centerX,
    centerZ: initialCenter.centerZ,
  }
  const initialLayout = resolveProcessLineLayout({
    plan,
    boundary: layoutBoundary,
  })
  const finalCenter = processLineCenter({
    prompt: input.prompt,
    plan,
    placement: input.placement,
    dimensions: {
      length: initialLayout.boundary.length,
      width: initialLayout.boundary.width,
    },
  })
  const resolvedLayout =
    finalCenter.centerX !== initialLayout.boundary.centerX ||
    finalCenter.centerZ !== initialLayout.boundary.centerZ
      ? resolveProcessLineLayout({
          plan,
          boundary: {
            ...initialLayout.boundary,
            centerX: finalCenter.centerX,
            centerZ: finalCenter.centerZ,
          },
        })
      : initialLayout
  const resolvedBoundary = resolvedLayout.boundary
  const omitPerimeterWalls = processLineOmitPerimeterWalls(plan)
  const { layoutDiagnostics, layoutStrategy, stationPlacements } = resolvedLayout
  const focusBounds = focusBoundsFromPlacements({ plan, stationPlacements })
  const shellPlacement = {
    ...input.placement,
    metadata: processMetadata({
      plan,
      sourcePrompt: input.prompt,
      placement: input.placement,
      focusBounds,
    }),
  }
  const shell = sections.shell
    ? buildFactoryLayoutCreatePatches({
        prompt: input.prompt,
        plan: {
          kind: 'layout',
          reason: `${plan.processLabel} needs a workshop shell.`,
          layoutType: 'factory',
          suggestedOperations: ['create_room', 'place_item', 'apply_patch'],
        },
        placement: shellPlacement,
        params: {
          ...input.params,
          length: resolvedBoundary.length,
          width: resolvedBoundary.width,
          ...(omitPerimeterWalls != null ? { omitPerimeterWalls } : {}),
        },
      })
    : { patches: [], nodeIds: [], created: [], missingAssets: [] }
  const placementByStation = new Map(
    stationPlacements.map((stationPlacement) => [stationPlacement.stationId, stationPlacement]),
  )

  const zonePatches: GeneratedGeometryCreatePatch[] = []
  const equipmentPatches: GeneratedGeometryCreatePatch[] = []
  const primitiveRequests: ProcessPrimitiveRequest[] = []
  const stationRouteObstacles: ProcessRouteObstacle[] = []
  const stationPortOverrides: ProcessRoutePortOverrides = {}
  const missingAssets: FactoryMissingAsset[] = []

  if (sections.stations) {
    plan.stations.forEach((station, stationIndex) => {
      const stationPlacement = stationPlacements[stationIndex]
      if (!stationPlacement) return
      if (isCementTertiaryAirStation(plan, station.id)) return
      const occupiedBuilding = isOccupiedBuildingStation(station)
        ? createOccupiedBuildingPatches({
            plan,
            station,
            stationIndex,
            stationPlacement,
            sourcePrompt: input.prompt,
            placement: input.placement,
          })
        : null
      if (occupiedBuilding) {
        zonePatches.push(
          createStationZone({
            plan,
            station,
            stationIndex,
            stationPlacement,
            sourcePrompt: input.prompt,
            placement: input.placement,
            resolved: true,
          }),
        )
        equipmentPatches.push(...occupiedBuilding.patches)
        stationRouteObstacles.push(occupiedBuilding.routeObstacle)
        return
      }
      const resolved = resolveProcessStationEquipment({
        plan,
        station,
        stationPlacement,
        placement: input.placement,
        metadata: stationMetadata({
          plan,
          station,
          stationIndex,
          sourcePrompt: input.prompt,
          placement: input.placement,
        }),
      })

      zonePatches.push(
        createStationZone({
          plan,
          station,
          stationIndex,
          stationPlacement,
          sourcePrompt: input.prompt,
          placement: input.placement,
          resolved: resolved.resolved,
        }),
      )
      equipmentPatches.push(...resolved.patches)
      if (resolved.portOverrides?.length) {
        stationPortOverrides[station.id] = [
          ...(stationPortOverrides[station.id] ?? []),
          ...resolved.portOverrides,
        ]
      }
      if (resolved.routeObstacle) stationRouteObstacles.push(resolved.routeObstacle)
      if (resolved.primitiveRequest) {
        primitiveRequests.push(resolved.primitiveRequest)
        missingAssets.push({
          name: stationDisplayLabel(station),
          reason:
            'No catalog or native parametric equipment matched this station; primitive generation will attempt to fill it.',
          required: false,
        })
      }
    })
  }

  const mergedPortOverrides: ProcessRoutePortOverrides = { ...input.portOverrides }
  for (const [stationId, ports] of Object.entries(stationPortOverrides)) {
    mergedPortOverrides[stationId] = [...(mergedPortOverrides[stationId] ?? []), ...ports]
  }

  const connectionPatches = sections.connections
    ? [
        ...createCementTertiaryAirDuctPatch({
          plan,
          placements: placementByStation,
          stationPlacements,
          boundary: resolvedBoundary,
          routeObstacles: [...stationRouteObstacles, ...(input.routeObstacles ?? [])],
          portOverrides: mergedPortOverrides,
          sourcePrompt: input.prompt,
          placement: input.placement,
        }),
        ...plan.connections.flatMap((connection, connectionIndex) => {
          if (isCementTertiaryAirConnection(plan, connection)) return []
          const routeObstacles = [...stationRouteObstacles, ...(input.routeObstacles ?? [])]
          const route = routeProcessConnection({
            plan,
            connection,
            connectionIndex,
            placements: placementByStation,
            stationPlacements,
            boundary: resolvedBoundary,
            portOverrides: mergedPortOverrides,
            routeObstacles,
          })
          if (!route) return []
          return [
            ...createConnectionPatches({
              plan,
              connection,
              connectionIndex,
              route,
              sourcePrompt: input.prompt,
              placement: input.placement,
            }),
            ...createRouteElbowFittings({
              plan,
              connection,
              connectionIndex,
              route,
              sourcePrompt: input.prompt,
              placement: input.placement,
            }),
          ]
        }),
      ]
    : []
  const fittingPatches = sections.connections
    ? createConnectionFittings({
        plan,
        placements: placementByStation,
        sourcePrompt: input.prompt,
        placement: input.placement,
      })
    : []

  const patches = [
    ...shell.patches,
    ...zonePatches,
    ...equipmentPatches,
    ...connectionPatches,
    ...fittingPatches,
  ]

  return {
    patches,
    nodeIds: patches.map((patch) => patch.node.id),
    created: patches.map((patch) => patch.node.name ?? patch.node.type),
    missingAssets,
    focusBounds,
    stationPlacements,
    layoutDiagnostics,
    layoutStrategy,
    primitiveRequests,
    portOverrides: mergedPortOverrides,
    routeObstacles: stationRouteObstacles,
    summary: `${plan.processLabel}: ${plan.stations.length} stations, ${plan.connections.length} connections`,
  }
}
