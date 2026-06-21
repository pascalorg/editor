import {
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
import { buildFactoryLayoutCreatePatches } from './factory-layout-patches'
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

function connectionRenderSpec(
  visualKind: ProcessConnectionVisualKind,
  medium?: ProcessConnectionMedium,
): ConnectionRenderSpec {
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
      color: MEDIUM_COLOR[medium ?? 'material'],
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
    color: MEDIUM_COLOR[medium ?? 'material'],
    elevation: 1.15,
    diameter: pipeDiameter(medium),
    insulated: medium === 'cooling',
    temperatureC: 20,
  }
}

function patchParentId(placement: GeneratedGeometryPlacementSpec) {
  return placement.parentId == null ? undefined : (placement.parentId as never)
}

function parentPatch(
  node: GeneratedGeometryCreatePatch['node'],
  placement: GeneratedGeometryPlacementSpec,
) {
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
    safetyTags: input.station.safetyTags,
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
  const suffix =
    input.segmentCount > 1
      ? `${input.connectionIndex + 1}.${input.segmentIndex + 1}`
      : `${input.connectionIndex + 1}`
  const spec = connectionRenderSpec(input.connection.visualKind, input.connection.medium)
  return `${input.connection.medium ?? 'process'} ${spec.label} ${suffix}`
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
  return {
    ...processMetadata(input),
    role: 'process-line-connection',
    ...(input.connection.medium ? { connectionRole: input.connection.medium } : {}),
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
    resolver: connectionRenderSpec(input.connection.visualKind, input.connection.medium).resolver,
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
}) {
  const metadata = connectionMetadata(input)
  const spec = connectionRenderSpec(input.connection.visualKind, input.connection.medium)
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
    diameter: spec.diameter ?? pipeDiameter(input.connection.medium),
    insulated: spec.insulated ?? input.connection.medium === 'cooling',
    pressureKpa: 0,
    temperatureC: spec.temperatureC ?? 20,
    medium: pipeMedium(input.connection.medium),
    color: spec.color,
    metadata,
  })
  return parentPatch(node, input.placement)
}

function createConnectionPatches(input: {
  plan: ProcessLinePlan
  connection: ProcessConnectionPlan
  connectionIndex: number
  route: ProcessConnectionRoute
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}) {
  const segmentCount = input.route.segments.length
  return input.route.segments.map((segment, segmentIndex) =>
    createConnectionPatch({
      ...input,
      segment,
      segmentIndex,
      segmentCount,
    }),
  )
}

function createRouteElbowFittings(input: {
  plan: ProcessLinePlan
  connection: ProcessConnectionPlan
  connectionIndex: number
  route: ProcessConnectionRoute
  sourcePrompt: string
  placement: GeneratedGeometryPlacementSpec
}) {
  const spec = connectionRenderSpec(input.connection.visualKind, input.connection.medium)
  if (spec.nodeKind !== 'pipe' || input.route.points.length < 3) return []

  const patches: GeneratedGeometryCreatePatch[] = []
  for (let pointIndex = 1; pointIndex < input.route.points.length - 1; pointIndex += 1) {
    const point = input.route.points[pointIndex]
    if (!point) continue
    const node = PipeFittingNode.parse({
      name: `${input.connection.medium ?? 'process'} pipe elbow ${input.connectionIndex + 1}.${pointIndex}`,
      fittingKind: 'elbow',
      position: [point[0], input.route.elevation ?? spec.elevation, point[1]],
      diameter: spec.diameter ?? pipeDiameter(input.connection.medium),
      pressureKpa: 0,
      temperatureC: spec.temperatureC ?? 20,
      medium: pipeMedium(input.connection.medium),
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
    if (connectionRenderSpec(connection.visualKind, connection.medium).nodeKind !== 'pipe') continue
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
    const medium = connections.find((connection) => connection.medium)?.medium
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
        connectionRole: medium,
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
}) {
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
  return [parentPatch(node, input.placement)]
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
  const layoutBoundary = {
    length,
    width,
    centerX: input.placement.position?.[0] ?? 0,
    centerZ: input.placement.position?.[2] ?? 0,
  }
  const resolvedLayout = resolveProcessLineLayout({
    plan,
    boundary: layoutBoundary,
  })
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
        params: { ...input.params, length, width },
      })
    : { patches: [], nodeIds: [], created: [], missingAssets: [] }
  const placementByStation = new Map(
    stationPlacements.map((stationPlacement) => [stationPlacement.stationId, stationPlacement]),
  )

  const zonePatches: GeneratedGeometryCreatePatch[] = []
  const equipmentPatches: GeneratedGeometryCreatePatch[] = []
  const primitiveRequests: ProcessPrimitiveRequest[] = []
  const stationRouteObstacles: ProcessRouteObstacle[] = []
  const missingAssets: FactoryMissingAsset[] = []

  if (sections.stations) {
    plan.stations.forEach((station, stationIndex) => {
      const stationPlacement = stationPlacements[stationIndex]
      if (!stationPlacement) return
      if (isCementTertiaryAirStation(plan, station.id)) return
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

  const connectionPatches = sections.connections
    ? [
        ...createCementTertiaryAirDuctPatch({
          plan,
          placements: placementByStation,
          stationPlacements,
          boundary: layoutBoundary,
          routeObstacles: [...stationRouteObstacles, ...(input.routeObstacles ?? [])],
          portOverrides: input.portOverrides,
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
            boundary: layoutBoundary,
            portOverrides: input.portOverrides,
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
    routeObstacles: stationRouteObstacles,
    summary: `${plan.processLabel}: ${plan.stations.length} stations, ${plan.connections.length} connections`,
  }
}
