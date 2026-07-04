import { composePartPrimitives, type PartComposeInput } from '@pascal-app/core/lib/part-compose'
import {
  type PrimitiveShapeInput,
  resolvePrimitiveWorldTransforms,
} from '@pascal-app/core/lib/primitive-compose'
import { BoxNode, ItemNode, PipeFittingNode, PipeNode, TankNode } from '@pascal-app/core/schema'
import {
  computeGeneratedAssemblyPosition,
  createGeneratedGeometryId,
  formatGeneratedShapeDetails,
  type GeneratedGeometryArtifact,
  inferGeneratedAssemblyName,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import type {
  GeneratedGeometryCreatePatch,
  GeneratedGeometryPlacementSpec,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import { buildGeneratedGeometryCreatePatches } from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import {
  type ProcessCatalogEquipmentMatch,
  resolveProcessCatalogEquipment,
} from './process-catalog-resolver'
import { resolveProcessEquipmentContract } from './process-equipment-contracts'
import {
  STORAGE_TANK_EDITABLE_PART_ROLES,
  STORAGE_TANK_RECIPE_ID,
} from '@pascal-app/plugin-factory-equipment'
import { compileEquipmentRecipeContract } from './equipment-recipe-compiler'
import { stationDisplayLabel } from './process-line-localization'
import { resolveFactoryEquipmentNode } from './factory-equipment-node-resolver'
import type { ProcessRoutePortEndpoint } from './process-line-routing'
import type {
  FactoryRouteObstacleMetadata,
  ProcessEquipmentContract,
  ProcessConnectionMedium,
  ProcessLinePlan,
  ProcessPrimitiveRequest,
  ProcessStationPlan,
  StationPlacement,
} from './process-line-types'

export type ProcessStationEquipmentResolver =
  | 'catalog-item'
  | 'factory-node'
  | 'native-box'
  | 'native-pipe'
  | 'native-pipe-fitting'
  | 'native-tank'
  | 'profile-parts'
  | 'primitive'

type ArtifactShape = GeneratedGeometryArtifact['shapes'][number]

export type ProcessStationEquipmentResolution = {
  patches: GeneratedGeometryCreatePatch[]
  primitiveRequest: ProcessPrimitiveRequest | null
  portOverrides?: ProcessRoutePortEndpoint[]
  routeObstacle?: FactoryRouteObstacleMetadata
  resolved: boolean
  resolver: ProcessStationEquipmentResolver
  reason: string
}

const MEDIUM_COLOR = {
  water: '#38bdf8',
  hydrogen: '#facc15',
  oxygen: '#60a5fa',
  utility: '#94a3b8',
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

function equipmentContractMetadata(equipmentContract: ProcessEquipmentContract | undefined) {
  return equipmentContract ? { equipmentContract } : {}
}

function semanticAssemblyMetadata(equipmentContract: ProcessEquipmentContract) {
  return {
    equipmentAssembly: {
      kind: 'semantic-assembly',
      profileId: equipmentContract.profileId,
      ...(equipmentContract.recipeId ? { recipeId: equipmentContract.recipeId } : {}),
      ...(equipmentContract.recipeSource ? { recipeSource: equipmentContract.recipeSource } : {}),
      equipmentFamily: equipmentContract.equipmentFamily,
      primarySemanticRole: equipmentContract.primarySemanticRole,
      envelope: equipmentContract.envelope,
      ports: equipmentContract.ports,
      editableParams: equipmentContract.editableParams ?? [],
      editablePartRoles: equipmentContract.requiredRoles ?? [],
      recipeSource: 'profile-parts',
    },
  }
}

function inheritedProcessPartMetadata(metadata: Record<string, unknown>) {
  const { generatedBy: _generatedBy, ...context } = metadata
  return context
}

function inheritProcessPartMetadata(
  patches: GeneratedGeometryCreatePatch[],
  metadata: Record<string, unknown>,
) {
  const context = inheritedProcessPartMetadata(metadata)
  return patches.map((patch) => {
    if (patch.op !== 'create') return patch
    const nodeMetadata =
      typeof patch.node.metadata === 'object' && patch.node.metadata !== null
        ? patch.node.metadata
        : {}
    return {
      ...patch,
      node: {
        ...patch.node,
        metadata: {
          ...context,
          ...nodeMetadata,
        },
      },
    } as GeneratedGeometryCreatePatch
  })
}

function rounded(value: number) {
  return Math.round(value * 1000) / 1000
}

function shapeVerticalHalfExtent(shape: PrimitiveShapeInput) {
  const radius = typeof shape.radius === 'number' ? shape.radius : 0.5
  const height = typeof shape.height === 'number' ? shape.height : 1
  const width = typeof shape.width === 'number' ? shape.width : 1
  const length = typeof shape.length === 'number' ? shape.length : 1
  const thickness =
    typeof shape.thickness === 'number'
      ? shape.thickness
      : typeof shape.height === 'number'
        ? shape.height
        : 0.04

  switch (shape.kind) {
    case 'box':
    case 'wedge':
    case 'trapezoid-prism':
      return height / 2
    case 'cylinder':
    case 'hollow-cylinder':
    case 'cone':
    case 'frustum':
    case 'capsule':
    case 'half-cylinder':
      return shape.axis === 'x' || shape.axis === 'z' ? radius : height / 2
    case 'sphere':
      return radius * (shape.scale?.[1] ?? 1)
    case 'hemisphere':
      return shape.axis === 'x' || shape.axis === 'z'
        ? radius * (shape.scale?.[1] ?? 1)
        : radius / 2
    case 'torus':
      return shape.axis === 'y'
        ? (shape.tubeRadius ?? 0.08)
        : (shape.majorRadius ?? radius) + (shape.tubeRadius ?? 0.08)
    case 'rounded-panel':
      return thickness / 2
    case 'conformal-strip':
      return (shape.surfaceRadiusY ?? 0.25) + (shape.thickness ?? 0.003)
    case 'extrude': {
      const profile = shape.profile ?? [
        [-0.5, -0.25],
        [0.5, -0.25],
        [0.5, 0.25],
        [-0.5, 0.25],
      ]
      const ys = profile.map((point) => point[1])
      return (Math.max(...ys) - Math.min(...ys)) / 2
    }
    case 'lathe': {
      const profile = shape.profile ?? [
        [0, 0],
        [0.5, 1],
      ]
      const ys = profile.map((point) => point[1])
      return (Math.max(...ys) - Math.min(...ys)) / 2
    }
    case 'sweep': {
      const ys = (shape.path ?? []).map((point) => point[1])
      if (!ys.length) return radius
      return (Math.max(...ys) - Math.min(...ys)) / 2 + radius
    }
    default:
      return Math.max(height, width, length) / 2
  }
}

function profilePartGroundLift(input: {
  shapes: PrimitiveShapeInput[]
  transforms: Array<{ position?: [number, number, number] } | undefined>
}) {
  let minY = Number.POSITIVE_INFINITY
  input.shapes.forEach((shape, index) => {
    const position = input.transforms[index]?.position ?? shape.position ?? [0, 0, 0]
    minY = Math.min(minY, position[1] - shapeVerticalHalfExtent(shape))
  })
  return Number.isFinite(minY) && minY < 0 ? -minY : 0
}

function translateVec3Y(value: [number, number, number], offset: number): [number, number, number]
function translateVec3Y(
  value: [number, number, number] | undefined,
  offset: number,
): [number, number, number] | undefined
function translateVec3Y(value: [number, number, number] | undefined, offset: number) {
  return value ? [value[0], value[1] + offset, value[2]] : value
}

function translateShapeY(shape: ArtifactShape, offset: number): ArtifactShape {
  if (offset === 0) return shape
  return {
    ...shape,
    position: translateVec3Y(shape.position, offset),
    path: shape.path?.map((point) => translateVec3Y(point, offset) ?? point),
    ports: shape.ports?.map((port) => ({
      ...port,
      position: translateVec3Y(port.position, offset),
    })),
    cutouts: shape.cutouts?.map((cutout) => ({
      ...cutout,
      position: translateVec3Y(cutout.position, offset),
    })),
  }
}

function translateTransformsY<T extends Array<{ position?: [number, number, number] } | undefined>>(
  transforms: T,
  offset: number,
): T {
  if (offset === 0) return transforms
  return transforms.map((transform) =>
    transform ? { ...transform, position: translateVec3Y(transform.position, offset) } : transform,
  ) as T
}

function routeObstacleForStation(input: {
  stationPlacement: StationPlacement
  equipmentContract?: ProcessEquipmentContract
  source: FactoryRouteObstacleMetadata['source']
  height?: number
}): FactoryRouteObstacleMetadata {
  const length = input.equipmentContract?.envelope.length ?? input.stationPlacement.footprint.length
  const width = input.equipmentContract?.envelope.width ?? input.stationPlacement.footprint.width
  const height = input.height ?? input.equipmentContract?.envelope.height ?? 1.2
  const yaw = input.stationPlacement.rotation[1] ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  const corners = [
    [-length / 2, -width / 2],
    [length / 2, -width / 2],
    [length / 2, width / 2],
    [-length / 2, width / 2],
  ] as const
  for (const [localX, localZ] of corners) {
    const x = input.stationPlacement.position[0] + localX * cos - localZ * sin
    const z = input.stationPlacement.position[2] + localX * sin + localZ * cos
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return {
    stationId: input.stationPlacement.stationId,
    source: input.source,
    minHeight: rounded(input.stationPlacement.position[1]),
    maxHeight: rounded(input.stationPlacement.position[1] + height),
    box: {
      minX: rounded(minX),
      maxX: rounded(maxX),
      minZ: rounded(minZ),
      maxZ: rounded(maxZ),
    },
  }
}

function itemScaleForPlacement(input: {
  match: ProcessCatalogEquipmentMatch
  stationPlacement: StationPlacement
  equipmentContract?: ProcessEquipmentContract
}): [number, number, number] {
  const [assetWidth, assetHeight, assetDepth] = input.match.asset.dimensions ?? [1, 1, 1]
  const targetLength =
    input.equipmentContract?.envelope.length ?? input.stationPlacement.footprint.length
  const targetHeight = input.equipmentContract?.envelope.height
  const targetWidth =
    input.equipmentContract?.envelope.width ?? input.stationPlacement.footprint.width
  return [
    assetWidth > 0 ? targetLength / assetWidth : 1,
    targetHeight && assetHeight > 0 ? targetHeight / assetHeight : 1,
    assetDepth > 0 ? targetWidth / assetDepth : 1,
  ]
}

function stationText(station: ProcessStationPlan) {
  return [
    station.id,
    station.role,
    station.label,
    station.displayLabel,
    station.equipmentHint,
    ...(station.safetyTags ?? []),
  ]
    .join(' ')
    .toLowerCase()
}

function isPipeFittingLikeStation(station: ProcessStationPlan) {
  return /\btee\b|\bt[_-]?pipe\b|three[_\s-]?way|elbow|valve|flange|\u4e09\u901a|\u5f2f\u5934|\u9600|\u6cd5\u5170/i.test(
    stationText(station),
  )
}

function isPipeLikeStation(station: ProcessStationPlan) {
  return /pipe|pipeline|\u7ba1\u9053|\u76f4\u7ba1/i.test(stationText(station))
}

function isTankLikeStation(station: ProcessStationPlan) {
  return /tank|separator|buffer|vessel|storage|water[_\s-]?treatment|barrel|drum|\u50a8\u7f50|\u5206\u79bb\u5668|\u7f13\u51b2|\u5bb9\u5668|\u6c34\u5904\u7406/i.test(
    stationText(station),
  )
}

function isBoxLikeStation(station: ProcessStationPlan) {
  return /dc[_\s-]?power|rectifier|power cabinet|electrical cabinet|control|safety|monitoring|skid|pump|heat[_\s-]?exchanger|cooling|ventilation|\u7535\u6e90|\u7535\u67dc|\u63a7\u5236|\u5b89\u5168|\u76d1\u63a7|\u64ac\u88c5|\u6cf5|\u51b7\u5374|\u901a\u98ce/i.test(
    stationText(station),
  )
}

function processMedium(station: ProcessStationPlan) {
  const text = stationText(station)
  if (/hydrogen|\u6c22/i.test(text)) return 'hydrogen'
  if (/oxygen|\u6c27/i.test(text)) return 'oxygen'
  if (/water|cooling|\u6c34|\u51b7\u5374/i.test(text)) return 'water'
  return 'utility'
}

function tankPortMedium(station: ProcessStationPlan): ProcessConnectionMedium {
  const medium = processMedium(station)
  return medium === 'utility' ? 'material' : medium
}

function storageTankContractForStation(input: {
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  equipmentContract?: ProcessEquipmentContract
}): ProcessEquipmentContract {
  const existing = input.equipmentContract
  if (existing?.recipeId || existing?.profileParts?.length) return existing
  const text = stationText(input.station)
  const horizontal = /buffer|horizontal|\u7f13\u51b2|\u5367/.test(text)
  const tall = input.station.footprintHint === 'tall' || /separator|\u5206\u79bb\u5668/.test(text)
  const length = existing?.envelope.length ?? input.stationPlacement.footprint.length
  const width = existing?.envelope.width ?? input.stationPlacement.footprint.width
  const height = existing?.envelope.height ?? (horizontal ? Math.max(1.4, width) : tall ? 2.8 : 1.9)
  const orientation = horizontal ? 'horizontal' : 'vertical'
  const medium = tankPortMedium(input.station)
  return {
    profileId: existing?.profileId ?? `generic.${orientation}_storage_tank`,
    equipmentFamily: existing?.equipmentFamily ?? 'tank.storage',
    scaleClass: existing?.scaleClass ?? 'station_semantic_assembly',
    envelope: existing?.envelope ?? {
      length,
      width,
      height,
      origin: 'station_profile',
      tolerance: 0.08,
    },
    ports: existing?.ports?.length
      ? existing.ports
      : [
          { id: 'inlet', medium, side: 'left', height: height * 0.58, offset: 0 },
          { id: 'outlet', medium, side: 'right', height: height * 0.38, offset: 0 },
        ],
    requiredRoles: existing?.requiredRoles ?? [...STORAGE_TANK_EDITABLE_PART_ROLES],
    recipeId: STORAGE_TANK_RECIPE_ID,
    recipeSource: 'builtin-contract',
    recipeParams: {
      orientation,
      ...(/hydrogen|\u6c22/.test(text)
        ? { shellColor: '#fde68a' }
        : /oxygen|\u6c27/.test(text)
          ? { shellColor: '#bfdbfe' }
          : {}),
    },
    preferredTool: existing?.preferredTool ?? 'compose_parts',
    preferredResolver: 'profile-parts',
    primarySemanticRole: existing?.primarySemanticRole ?? 'vessel_shell',
  }
}

function createNativeBoxPatch(input: {
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  placement: GeneratedGeometryPlacementSpec
  metadata: Record<string, unknown>
  equipmentContract?: ProcessEquipmentContract
}) {
  const text = stationText(input.station)
  const isCabinet = /cabinet|power|control|monitoring|\u7535\u67dc|\u63a7\u5236|\u76d1\u63a7/i.test(
    text,
  )
  const envelope = input.equipmentContract?.envelope
  const height = envelope?.height ?? (isCabinet ? 1.45 : 0.95)
  const routeObstacle = routeObstacleForStation({
    stationPlacement: input.stationPlacement,
    equipmentContract: input.equipmentContract,
    source: 'native',
    height,
  })
  const node = BoxNode.parse({
    name: stationDisplayLabel(input.station),
    position: [input.stationPlacement.position[0], height / 2, input.stationPlacement.position[2]],
    rotation: input.stationPlacement.rotation,
    length: Math.max(0.8, (envelope?.length ?? input.stationPlacement.footprint.length) * 0.9),
    width: Math.max(0.5, (envelope?.width ?? input.stationPlacement.footprint.width) * 0.82),
    height,
    cornerRadius: 0.06,
    material: {
      preset: 'custom',
      properties: {
        color: isCabinet ? '#64748b' : '#78909c',
        roughness: 0.58,
        metalness: 0.16,
      },
    },
    metadata: {
      ...input.metadata,
      equipmentRole: input.station.role,
      resolver: 'native-box',
      resolverReason: 'box-like industrial station',
      factoryRouteObstacle: routeObstacle,
      ...equipmentContractMetadata(input.equipmentContract),
    },
  })
  return parentPatch(node, input.placement)
}

function createCatalogItemPatch(input: {
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  placement: GeneratedGeometryPlacementSpec
  metadata: Record<string, unknown>
  match: ProcessCatalogEquipmentMatch
  equipmentContract?: ProcessEquipmentContract
}) {
  const routeObstacle = routeObstacleForStation({
    stationPlacement: input.stationPlacement,
    equipmentContract: input.equipmentContract,
    source: 'catalog',
  })
  const node = ItemNode.parse({
    name: stationDisplayLabel(input.station),
    position: input.stationPlacement.position,
    rotation: input.stationPlacement.rotation,
    scale: itemScaleForPlacement({
      match: input.match,
      stationPlacement: input.stationPlacement,
      equipmentContract: input.equipmentContract,
    }),
    asset: input.match.asset,
    metadata: {
      ...input.metadata,
      equipmentRole: input.station.role,
      resolver: 'catalog-item',
      resolverReason: input.match.reason,
      catalogItemId: input.match.assetId,
      catalogItemName: input.match.asset.name,
      processCatalogQualified: true,
      processCatalogConfidence: input.match.confidence,
      factoryRouteObstacle: routeObstacle,
      ...equipmentContractMetadata(input.equipmentContract),
    },
  })
  return parentPatch(node, input.placement)
}

function createNativeTankPatch(input: {
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  placement: GeneratedGeometryPlacementSpec
  metadata: Record<string, unknown>
  equipmentContract?: ProcessEquipmentContract
}) {
  const text = stationText(input.station)
  const tall = input.station.footprintHint === 'tall' || /separator|\u5206\u79bb\u5668/.test(text)
  const buffer = /buffer|horizontal|\u7f13\u51b2|\u5367/.test(text)
  const envelope = input.equipmentContract?.envelope
  const routeObstacle = routeObstacleForStation({
    stationPlacement: input.stationPlacement,
    equipmentContract: input.equipmentContract,
    source: 'native',
    height: envelope?.height ?? (tall ? 2.8 : 1.8),
  })
  const verticalDiameter = Math.min(envelope?.length ?? 1.2, envelope?.width ?? 1.2)
  const horizontalDiameter = Math.min(envelope?.width ?? 1.2, envelope?.height ?? 1.6)
  const node = TankNode.parse({
    name: stationDisplayLabel(input.station),
    position: input.stationPlacement.position,
    rotation: input.stationPlacement.rotation,
    kind: buffer ? 'horizontal' : 'vertical',
    diameter: buffer ? horizontalDiameter : tall ? verticalDiameter : verticalDiameter,
    height: envelope?.height ?? (tall ? 2.8 : 1.8),
    length: buffer ? (envelope?.length ?? 2.4) : (envelope?.length ?? 1.6),
    liquidLevel: /oxygen|hydrogen|\u6c27|\u6c22/.test(text) ? 0 : 0.55,
    shellColor: /hydrogen|\u6c22/.test(text)
      ? '#fde68a'
      : /oxygen|\u6c27/.test(text)
        ? '#bfdbfe'
        : '#94a3b8',
    metadata: {
      ...input.metadata,
      equipmentRole: input.station.role,
      resolver: 'native-tank',
      resolverReason: 'tank-like station',
      factoryRouteObstacle: routeObstacle,
      ...equipmentContractMetadata(input.equipmentContract),
    },
  })
  return parentPatch(node, input.placement)
}

function createNativePipePatch(input: {
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  placement: GeneratedGeometryPlacementSpec
  metadata: Record<string, unknown>
}) {
  const medium = processMedium(input.station)
  const center = input.stationPlacement.position
  const length = Math.max(0.8, input.stationPlacement.footprint.length)
  const routeObstacle = routeObstacleForStation({
    stationPlacement: input.stationPlacement,
    source: 'native',
    height: 1.35,
  })
  const node = PipeNode.parse({
    name: stationDisplayLabel(input.station),
    start: [center[0] - length / 2, center[2]],
    end: [center[0] + length / 2, center[2]],
    elevation: 1.15,
    diameter: 0.16,
    insulated: medium === 'water',
    pressureKpa: 0,
    temperatureC: 20,
    medium: medium === 'water' ? 'water' : 'steam',
    color: MEDIUM_COLOR[medium],
    metadata: {
      ...input.metadata,
      equipmentRole: input.station.role,
      resolver: 'native-pipe',
      resolverReason: 'pipe-like station',
      factoryRouteObstacle: routeObstacle,
    },
  })
  return parentPatch(node, input.placement)
}

function createNativePipeFittingPatch(input: {
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  placement: GeneratedGeometryPlacementSpec
  metadata: Record<string, unknown>
}) {
  const medium = processMedium(input.station)
  const text = stationText(input.station)
  const routeObstacle = routeObstacleForStation({
    stationPlacement: input.stationPlacement,
    source: 'native',
    height: 1.35,
  })
  const node = PipeFittingNode.parse({
    name: stationDisplayLabel(input.station),
    fittingKind: /valve|\u9600/i.test(text)
      ? 'valve'
      : /flange|\u6cd5\u5170/i.test(text)
        ? 'flange'
        : /elbow|\u5f2f\u5934/i.test(text)
          ? 'elbow'
          : 'tee',
    position: [input.stationPlacement.position[0], 1.15, input.stationPlacement.position[2]],
    rotation: input.stationPlacement.rotation,
    diameter: 0.16,
    pressureKpa: 0,
    temperatureC: 20,
    medium: medium === 'water' ? 'water' : 'steam',
    color: MEDIUM_COLOR[medium],
    metadata: {
      ...input.metadata,
      equipmentRole: input.station.role,
      resolver: 'native-pipe-fitting',
      resolverReason: 'pipe-fitting-like station',
      factoryRouteObstacle: routeObstacle,
    },
  })
  return parentPatch(node, input.placement)
}

function createPrimitiveRequest(input: {
  plan: ProcessLinePlan
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  metadata: Record<string, unknown>
  equipmentContract?: ProcessEquipmentContract
}): ProcessPrimitiveRequest {
  const metadata = {
    ...input.metadata,
    equipmentRole: input.station.role,
    resolver: 'primitive',
    resolverReason: 'no native industrial node matched',
    ...equipmentContractMetadata(input.equipmentContract),
  }
  return {
    station: input.station,
    placement: input.stationPlacement,
    prompt: [
      input.station.equipmentHint,
      `Process: ${input.plan.processLabel}.`,
      `Station role: ${input.station.role}.`,
      ...(input.equipmentContract
        ? [
            `Equipment family: ${input.equipmentContract.equipmentFamily}.`,
            `Scale class: ${input.equipmentContract.scaleClass}.`,
            `Fit inside envelope ${input.equipmentContract.envelope.length}m x ${input.equipmentContract.envelope.width}m x ${input.equipmentContract.envelope.height}m.`,
            `Expose connection ports: ${input.equipmentContract.ports.map((port) => `${port.id}:${port.medium}:${port.side}`).join(', ')}.`,
          ]
        : []),
      'Create a conceptual editable industrial equipment module only; do not include real operating parameters.',
    ].join(' '),
    metadata,
    equipmentContract: input.equipmentContract,
  }
}

function createProfilePartsPatch(input: {
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  placement: GeneratedGeometryPlacementSpec
  metadata: Record<string, unknown>
  equipmentContract: ProcessEquipmentContract
}) {
  const compiled = compileEquipmentRecipeContract(input.equipmentContract)
  const equipmentContract = compiled?.contract ?? input.equipmentContract
  const envelope = equipmentContract.envelope
  const profileParts = compiled?.result.parts ?? equipmentContract.profileParts
  if (!profileParts?.length) return null
  const routeObstacle = routeObstacleForStation({
    stationPlacement: input.stationPlacement,
    equipmentContract,
    source: 'profile-parts',
  })
  const sourceArgs: PartComposeInput = {
    name: stationDisplayLabel(input.station),
    family: equipmentContract.equipmentFamily,
    detail: 'high',
    length: envelope.length,
    width: envelope.width,
    depth: envelope.width,
    height: envelope.height,
    parts: profileParts,
    autoComplete: false,
    enhanceVisualDetails: false,
    registryPartPlan: true,
    primaryColor: '#cbd5e1',
    secondaryColor: '#64748b',
    metalColor: '#94a3b8',
    darkColor: '#1f2937',
    accentColor: '#f59e0b',
  } as PartComposeInput
  const shapes = composePartPrimitives(sourceArgs) as PrimitiveShapeInput[]
  const rawArtifactShapes: GeneratedGeometryArtifact['shapes'] = shapes.map((shape) => ({
    ...shape,
    position: shape.position ?? [0, 0, 0],
    rotation: shape.rotation ?? [0, 0, 0],
  }))
  if (!rawArtifactShapes.length) return null

  const rawTransforms = resolvePrimitiveWorldTransforms(rawArtifactShapes, {
    positionMode: 'world-center',
  })
  const groundLift = profilePartGroundLift({
    shapes: rawArtifactShapes,
    transforms: rawTransforms,
  })
  const artifactShapes = rawArtifactShapes.map((shape) => translateShapeY(shape, groundLift))
  const transforms = translateTransformsY(rawTransforms, groundLift)
  const assemblyPosition = computeGeneratedAssemblyPosition(transforms)
  const artifact: GeneratedGeometryArtifact = {
    id: createGeneratedGeometryId(),
    title: stationDisplayLabel(input.station),
    sourceTool: 'profile_parts',
    sourceArgs: {
      profileId: equipmentContract.profileId,
      ...(equipmentContract.recipeId ? { recipeId: equipmentContract.recipeId } : {}),
      family: equipmentContract.equipmentFamily,
      length: envelope.length,
      width: envelope.width,
      height: envelope.height,
      primarySemanticRole: equipmentContract.primarySemanticRole,
    },
    userPrompt: input.station.equipmentHint,
    version: 1,
    createdAt: new Date().toISOString(),
    shapes: artifactShapes,
    transforms,
    assemblyName: inferGeneratedAssemblyName(
      'profile_parts',
      sourceArgs as Record<string, unknown>,
      artifactShapes,
    ),
    assemblyPosition,
    createdNames: artifactShapes.map((shape) => shape.name ?? shape.kind),
    shapeDetails: formatGeneratedShapeDetails(artifactShapes, transforms),
    geometryBrief: {
      category: equipmentContract.equipmentFamily,
      units: 'meters',
      expectedDimensions: {
        length: envelope.length,
        width: envelope.width,
        height: envelope.height,
      },
      requiredRoles: equipmentContract.requiredRoles,
      semanticRoles: equipmentContract.requiredRoles,
    },
  }
  const patchPlan = buildGeneratedGeometryCreatePatches(artifact, {
    ...input.placement,
    position: input.stationPlacement.position,
    rotation: input.stationPlacement.rotation,
    metadata: {
      ...input.metadata,
      equipmentRole: input.station.role,
      resolver: 'semantic-assembly',
      resolverReason: 'industry equipment contract compiled to editable semantic assembly',
      factoryRouteObstacle: routeObstacle,
      ...semanticAssemblyMetadata(equipmentContract),
      ...equipmentContractMetadata(equipmentContract),
    },
  })
  return { patches: inheritProcessPartMetadata(patchPlan.patches, input.metadata), routeObstacle }
}

export function resolveProcessStationEquipment(input: {
  plan: ProcessLinePlan
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  placement: GeneratedGeometryPlacementSpec
  metadata: Record<string, unknown>
}): ProcessStationEquipmentResolution {
  const equipmentContract = resolveProcessEquipmentContract({
    plan: input.plan,
    station: input.station,
  })
  const withContract = { ...input, equipmentContract }
  if (equipmentContract?.preferredResolver === 'native-tank') {
    const tankContract = storageTankContractForStation({
      station: input.station,
      stationPlacement: input.stationPlacement,
      equipmentContract,
    })
    const routeObstacle = routeObstacleForStation({
      stationPlacement: input.stationPlacement,
      equipmentContract: tankContract,
      source: 'native',
    })
    return {
      patches: [createNativeTankPatch({ ...input, equipmentContract: tankContract })],
      primitiveRequest: null,
      routeObstacle,
      resolved: true,
      resolver: 'native-tank',
      reason: 'station equipment contract selected native tank',
    }
  }
  if (equipmentContract?.preferredResolver === 'profile-parts') {
    const profileParts = createProfilePartsPatch({
      ...input,
      equipmentContract,
    })
    if (profileParts?.patches.length) {
      return {
        patches: profileParts.patches,
        primitiveRequest: null,
        routeObstacle: profileParts.routeObstacle,
        resolved: true,
        resolver: 'profile-parts',
        reason: 'station equipment contract selected profile parts',
      }
    }
  }
  const factoryNode = resolveFactoryEquipmentNode({
    ...input,
    contract: equipmentContract,
  })
  if (factoryNode) {
    return {
      patches: [factoryNode.patch],
      primitiveRequest: null,
      portOverrides: factoryNode.portOverrides,
      routeObstacle: factoryNode.routeObstacle,
      resolved: true,
      resolver: 'factory-node',
      reason: `station equipment contract compiled to ${factoryNode.nodeKind}`,
    }
  }
  const catalogMatch = resolveProcessCatalogEquipment({
    plan: input.plan,
    station: input.station,
    stationPlacement: input.stationPlacement,
    equipmentContract,
  })
  if (catalogMatch) {
    const routeObstacle = routeObstacleForStation({
      stationPlacement: input.stationPlacement,
      equipmentContract,
      source: 'catalog',
    })
    return {
      patches: [createCatalogItemPatch({ ...withContract, match: catalogMatch })],
      primitiveRequest: null,
      routeObstacle,
      resolved: true,
      resolver: 'catalog-item',
      reason: catalogMatch.reason,
    }
  }
  if (equipmentContract?.preferredResolver === 'primitive') {
    return {
      patches: [],
      primitiveRequest: createPrimitiveRequest(withContract),
      resolved: false,
      resolver: 'primitive',
      reason: 'station equipment contract requires primitive generation',
    }
  }
  if (equipmentContract?.preferredResolver === 'native-box') {
    const routeObstacle = routeObstacleForStation({
      stationPlacement: input.stationPlacement,
      equipmentContract,
      source: 'native',
    })
    return {
      patches: [createNativeBoxPatch(withContract)],
      primitiveRequest: null,
      routeObstacle,
      resolved: true,
      resolver: 'native-box',
      reason: 'station equipment contract selected native box',
    }
  }
  if (isPipeFittingLikeStation(input.station)) {
    const routeObstacle = routeObstacleForStation({
      stationPlacement: input.stationPlacement,
      source: 'native',
      height: 1.35,
    })
    return {
      patches: [createNativePipeFittingPatch(input)],
      primitiveRequest: null,
      routeObstacle,
      resolved: true,
      resolver: 'native-pipe-fitting',
      reason: 'pipe-fitting-like station',
    }
  }

  if (isPipeLikeStation(input.station)) {
    const routeObstacle = routeObstacleForStation({
      stationPlacement: input.stationPlacement,
      source: 'native',
      height: 1.35,
    })
    return {
      patches: [createNativePipePatch(input)],
      primitiveRequest: null,
      routeObstacle,
      resolved: true,
      resolver: 'native-pipe',
      reason: 'pipe-like station',
    }
  }

  if (isTankLikeStation(input.station)) {
    const tankContract = storageTankContractForStation({
      station: input.station,
      stationPlacement: input.stationPlacement,
      equipmentContract,
    })
    const profileParts = createProfilePartsPatch({
      ...input,
      equipmentContract: tankContract,
    })
    if (profileParts?.patches.length) {
      return {
        patches: profileParts.patches,
        primitiveRequest: null,
        routeObstacle: profileParts.routeObstacle,
        resolved: true,
        resolver: 'profile-parts',
        reason: 'tank-like station compiled to semantic assembly',
      }
    }
    const routeObstacle = routeObstacleForStation({
      stationPlacement: input.stationPlacement,
      equipmentContract,
      source: 'native',
    })
    return {
      patches: [createNativeTankPatch(withContract)],
      primitiveRequest: null,
      routeObstacle,
      resolved: true,
      resolver: 'native-tank',
      reason: 'tank-like station',
    }
  }

  if (isBoxLikeStation(input.station)) {
    const routeObstacle = routeObstacleForStation({
      stationPlacement: input.stationPlacement,
      equipmentContract,
      source: 'native',
    })
    return {
      patches: [createNativeBoxPatch(withContract)],
      primitiveRequest: null,
      routeObstacle,
      resolved: true,
      resolver: 'native-box',
      reason: 'box-like industrial station',
    }
  }

  return {
    patches: [],
    primitiveRequest: createPrimitiveRequest(withContract),
    resolved: false,
    resolver: 'primitive',
    reason: 'no native industrial node matched',
  }
}
