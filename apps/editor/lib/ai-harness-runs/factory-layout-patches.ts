import type { AnyNodeId } from '@pascal-app/core/schema'
import {
  BuildingNode,
  CeilingNode,
  DoorNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import type {
  GeneratedGeometryCreatePatch,
  GeneratedGeometryPlacementSpec,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import type { FactoryPlan } from './factory-planner'
import { containsCjkText } from './process-line-localization'

type Vec2 = [number, number]
type FactoryRoofType = 'hip' | 'gable' | 'shed' | 'gambrel' | 'dutch' | 'mansard' | 'flat'
type SceneBoundsLike = {
  min: Vec2
  max: Vec2
  center?: Vec2
  size?: Vec2
}

const AUTO_PLACE_GAP = 6

export type FactoryBuildingSpec = {
  length: number
  width: number
  stories: number
  storyHeight: number
  hasRoof: boolean
  roofType: FactoryRoofType
}

export type FactoryLayoutPatchPlan = {
  patches: GeneratedGeometryCreatePatch[]
  nodeIds: string[]
  created: string[]
  summary: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = finiteNumber(value)
    if (parsed != null) return parsed
  }
  return undefined
}

function booleanParam(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function numbersFromText(text: string) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:m|\u7c73|meter|meters)?/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
}

function numberBeforeKeyword(text: string, keyword: RegExp) {
  const match = text.match(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:m|\\u7c73|meter|meters)?\\s*(?:${keyword.source})`, 'i'),
  )
  const value = match?.[1] ? Number(match[1]) : Number.NaN
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function chineseFloorCount(value: string) {
  if (/\u4e24\u5c42|\u4e8c\u5c42|\u4e24\u5c42\u697c|\u4e8c\u5c42\u697c/.test(value)) return 2
  if (/\u4e09\u5c42|\u4e09\u5c42\u697c/.test(value)) return 3
  const numeric = value.match(/(\d+)\s*\u5c42/)
  return numeric?.[1] ? Number(numeric[1]) : undefined
}

function storyCountFromText(value: string) {
  return (
    chineseFloorCount(value) ??
    (/\u4e0a\u9762\u8fd8\u6709\u4e00\u5c42|\u518d\u52a0\u4e00\u5c42|\u7b2c\u4e8c\u5c42|second\s+floor|two[-\s]?stor(?:y|ey)|2\s*stor(?:y|ey)/i.test(
      value,
    )
      ? 2
      : undefined)
  )
}

function heightFromText(value: string) {
  const chineseHalf = value.match(
    /(?:\u9ad8|\u5c42\u9ad8)\s*(\d+(?:\.\d+)?)\s*(?:m|\u7c73)\s*(\d)/i,
  )
  if (chineseHalf?.[1] && chineseHalf[2])
    return Number(chineseHalf[1]) + Number(chineseHalf[2]) / 10
  const explicit = value.match(
    /(?:\u9ad8|\u5c42\u9ad8|height|story\s*height)\s*(\d+(?:\.\d+)?)\s*(?:m|\u7c73|meter|meters)?/i,
  )
  return explicit?.[1] ? Number(explicit[1]) : undefined
}

function roofTypeValue(value: unknown): FactoryRoofType | undefined {
  return value === 'hip' ||
    value === 'gable' ||
    value === 'shed' ||
    value === 'gambrel' ||
    value === 'dutch' ||
    value === 'mansard' ||
    value === 'flat'
    ? value
    : undefined
}

function clampPositive(value: unknown, fallback: number, min: number, max: number) {
  return Math.max(
    min,
    Math.min(
      max,
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback,
    ),
  )
}

export function inferFactoryLayoutDimensions(input: {
  prompt: string
  plan: Extract<FactoryPlan, { kind: 'layout' }>
  params?: Record<string, unknown>
}): { length: number; width: number } {
  const params = input.params ?? {}
  const dimensionParams = isRecord(params.dimensions) ? params.dimensions : {}
  const explicitLength = firstNumber(params.length, dimensionParams.length)
  const explicitWidth = firstNumber(
    params.width,
    params.depth,
    dimensionParams.width,
    dimensionParams.depth,
  )
  if (explicitLength && explicitWidth) return { length: explicitLength, width: explicitWidth }

  const normalized = input.prompt.replace(/[\u00d7\uff0a]/g, '*')
  const pair = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:m|\u7c73)?\s*[*xX]\s*(\d+(?:\.\d+)?)\s*(?:m|\u7c73)?/i,
  )
  if (pair) return { length: Number(pair[1]), width: Number(pair[2]) }

  const nums = numbersFromText(normalized)
  if (input.plan.layoutType === 'production_line') {
    return {
      length: numberBeforeKeyword(normalized, /\u957f|long|length/) ?? nums[0] ?? 18,
      width: numberBeforeKeyword(normalized, /\u5bbd|wide|width/) ?? 6,
    }
  }
  if (nums.length >= 2) return { length: nums[0]!, width: nums[1]! }
  if (nums.length === 1) return { length: nums[0]!, width: nums[0]! }

  if (input.plan.layoutType === 'factory') return { length: 12, width: 8 }
  if (input.plan.layoutType === 'house') return { length: 6, width: 6 }
  return { length: 3, width: 3 }
}

export function inferFactoryBuildingSpec(input: {
  prompt: string
  plan: Extract<FactoryPlan, { kind: 'layout' }>
  params?: Record<string, unknown>
}): FactoryBuildingSpec {
  const dimensions = inferFactoryLayoutDimensions(input)
  const params = input.params ?? {}
  const paramDimensions = isRecord(params.dimensions) ? params.dimensions : {}
  const prompt = input.prompt.trim()
  const stories = Math.round(
    clampPositive(params.stories ?? input.plan.stories, storyCountFromText(prompt) ?? 1, 1, 20),
  )
  const storyHeight = clampPositive(
    params.storyHeight ?? paramDimensions.height ?? input.plan.storyHeight,
    heightFromText(prompt) ?? (input.plan.layoutType === 'factory' ? 4.5 : 2.8),
    1.8,
    12,
  )
  const hasRoof =
    booleanParam(params.hasRoof) ??
    booleanParam(input.plan.hasRoof) ??
    /\u5c4b\u9876|\u9876\u68da|roof/i.test(prompt)
  const roofType =
    roofTypeValue(params.roofType) ??
    roofTypeValue(input.plan.roofType) ??
    (/\u5e73\u5c4b\u9876|flat\s+roof/i.test(prompt) ? 'flat' : 'gable')

  return { ...dimensions, stories, storyHeight, hasRoof, roofType }
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

function wallLength(start: Vec2, end: Vec2) {
  return Math.hypot(end[0] - start[0], end[1] - start[1])
}

function wallLocalX(start: Vec2, end: Vec2, t: number, openingWidth: number) {
  const length = wallLength(start, end)
  const raw = length * t
  const min = openingWidth / 2
  const max = Math.max(min, length - openingWidth / 2)
  return Math.max(min, Math.min(max, raw))
}

function parentPatch(node: GeneratedGeometryCreatePatch['node'], parentId?: string) {
  return {
    op: 'create' as const,
    node,
    ...(parentId ? { parentId: parentId as AnyNodeId } : {}),
  }
}

function finiteVec2(value: unknown): Vec2 | undefined {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]]
  }
  return undefined
}

function sceneBoundsFromMetadata(metadata: Record<string, unknown>): SceneBoundsLike | undefined {
  const candidates = [
    metadata.sceneBounds,
    isRecord(metadata.scene) ? metadata.scene.bounds : undefined,
  ]
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const min = finiteVec2(candidate.min)
    const max = finiteVec2(candidate.max)
    if (!min || !max) continue
    return {
      min,
      max,
      ...(finiteVec2(candidate.center) ? { center: finiteVec2(candidate.center)! } : {}),
      ...(finiteVec2(candidate.size) ? { size: finiteVec2(candidate.size)! } : {}),
    }
  }
  return undefined
}

function layoutPlacementIntent(prompt: string) {
  const normalized = prompt.toLowerCase()
  const horizontal = /\u5de6|left|west/.test(normalized)
    ? 'left'
    : /\u53f3|right|east/.test(normalized)
      ? 'right'
      : undefined
  const vertical = /\u4e0a\u65b9|\u4e0a\u89d2|\u9876\u90e8|\u5317\u4fa7|top|upper|north/.test(
    normalized,
  )
    ? 'top'
    : /\u4e0b\u65b9|\u4e0b\u89d2|\u5e95\u90e8|\u5357\u4fa7|bottom|lower|south/.test(normalized)
      ? 'bottom'
      : undefined
  return { horizontal, vertical }
}

function resolveLayoutCenter(input: {
  prompt: string
  dimensions: { length: number; width: number }
  metadata: Record<string, unknown>
  placement: GeneratedGeometryPlacementSpec
}) {
  const explicitX = input.placement.position?.[0]
  const explicitZ = input.placement.position?.[2]
  if (explicitX != null || explicitZ != null) {
    return {
      centerX: explicitX ?? 0,
      centerZ: explicitZ ?? 0,
      placementIntent: 'explicit-position',
    }
  }

  const bounds = sceneBoundsFromMetadata(input.metadata)
  const intent = layoutPlacementIntent(input.prompt)
  if (!bounds) {
    return { centerX: 0, centerZ: 0, placementIntent: 'default-origin' }
  }

  const defaultCenterX = bounds.center?.[0] ?? (bounds.min[0] + bounds.max[0]) / 2
  const defaultCenterZ = bounds.center?.[1] ?? (bounds.min[1] + bounds.max[1]) / 2
  if (!intent.horizontal && !intent.vertical) {
    return {
      centerX: bounds.max[0] + AUTO_PLACE_GAP + input.dimensions.length / 2,
      centerZ: defaultCenterZ,
      placementIntent: 'avoid-existing-right',
    }
  }

  const margin = 1
  const centerX =
    intent.horizontal === 'left'
      ? bounds.min[0] + margin + input.dimensions.length / 2
      : intent.horizontal === 'right'
        ? bounds.max[0] - margin - input.dimensions.length / 2
        : defaultCenterX
  const centerZ =
    intent.vertical === 'top'
      ? bounds.min[1] + margin + input.dimensions.width / 2
      : intent.vertical === 'bottom'
        ? bounds.max[1] - margin - input.dimensions.width / 2
        : defaultCenterZ

  return {
    centerX,
    centerZ,
    placementIntent: `${intent.vertical ?? 'center'}-${intent.horizontal ?? 'center'}`,
  }
}

function stringMetadata(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function defaultRoomName(input: {
  layoutType: Extract<FactoryPlan, { kind: 'layout' }>['layoutType']
  useChinese: boolean
}) {
  if (input.useChinese) {
    if (input.layoutType === 'factory') return '\u5de5\u5382\u8f66\u95f4'
    if (input.layoutType === 'production_line') return '\u751f\u4ea7\u7ebf\u533a\u57df'
    if (input.layoutType === 'house') return '\u751f\u6210\u623f\u5c4b'
    return '\u751f\u6210\u623f\u95f4'
  }
  if (input.layoutType === 'factory') return 'Factory shell'
  if (input.layoutType === 'production_line') return 'Production line area'
  if (input.layoutType === 'house') return 'Generated house'
  return 'Generated room'
}

function roomLabels(input: {
  layoutType: Extract<FactoryPlan, { kind: 'layout' }>['layoutType']
  prompt: string
  metadata: Record<string, unknown>
}) {
  const metadataName = stringMetadata(input.metadata.processDisplayLabel)
  const useChinese = containsCjkText(input.prompt) || containsCjkText(metadataName)
  const roomName = metadataName ?? defaultRoomName({ layoutType: input.layoutType, useChinese })
  if (!useChinese) {
    return {
      roomName,
      floorName: `${roomName} floor`,
      ceilingName: `${roomName} ceiling`,
      wallName: (index: number) => `${roomName} wall ${index + 1}`,
      doorName: input.layoutType === 'factory' ? 'Factory door' : 'Door',
      windowName: 'Window',
    }
  }
  return {
    roomName,
    floorName: `${roomName}\u5730\u9762`,
    ceilingName: `${roomName}\u540a\u9876`,
    wallName: (index: number) => `${roomName}\u5899${index + 1}`,
    doorName: input.layoutType === 'factory' ? '\u8f66\u95f4\u5377\u5e18\u95e8' : '\u95e8',
    windowName: '\u7a97\u6237',
  }
}

function storyRoomName(roomName: string, storyIndex: number, storyCount: number) {
  return storyCount <= 1 ? roomName : `${roomName} ${storyIndex + 1}F`
}

function createStoryShellPatches(input: {
  plan: Extract<FactoryPlan, { kind: 'layout' }>
  parentId?: string
  polygon: Vec2[]
  dimensions: { length: number; width: number }
  labels: ReturnType<typeof roomLabels>
  baseMetadata: Record<string, unknown>
  storyIndex: number
  storyCount: number
  storyHeight: number
  includeDoor: boolean
  omitPerimeterWalls: boolean
}) {
  const roomName = storyRoomName(input.labels.roomName, input.storyIndex, input.storyCount)
  const storyMetadata = {
    ...input.baseMetadata,
    storyIndex: input.storyIndex,
    storyCount: input.storyCount,
    storyHeight: input.storyHeight,
  }
  const zone = ZoneNode.parse({
    name: roomName,
    polygon: input.polygon,
    color: input.plan.layoutType === 'factory' ? '#94a3b8' : '#60a5fa',
    metadata: { ...storyMetadata, mcpTool: 'create_room', role: 'layout-zone' },
  })
  const includeIndependentSurfaces = input.plan.layoutType !== 'house'
  const slab = includeIndependentSurfaces
    ? SlabNode.parse({
        name: input.storyCount <= 1 ? input.labels.floorName : `${roomName}\u5730\u9762`,
        polygon: input.polygon,
        metadata: { ...storyMetadata, mcpTool: 'create_room', role: 'layout-floor' },
      })
    : null
  const ceiling = includeIndependentSurfaces
    ? CeilingNode.parse({
        name: input.storyCount <= 1 ? input.labels.ceilingName : `${roomName}\u540a\u9876`,
        polygon: input.polygon,
        height: input.storyHeight,
        metadata: { ...storyMetadata, mcpTool: 'create_room', role: 'layout-ceiling' },
      })
    : null
  const walls = input.polygon.map((start, index) =>
    WallNode.parse({
      name: input.storyCount <= 1 ? input.labels.wallName(index) : `${roomName}\u5899${index + 1}`,
      start,
      end: input.polygon[(index + 1) % input.polygon.length]!,
      height: input.storyHeight,
      thickness: input.plan.layoutType === 'factory' ? 0.24 : 0.16,
      metadata: { ...storyMetadata, mcpTool: 'create_room', roomName, edgeIndex: index },
    }),
  )

  const firstWall = walls[0]!
  const firstStart = input.polygon[0]!
  const firstEnd = input.polygon[1]!
  const doorWidth = input.plan.layoutType === 'factory' ? 2.4 : 0.9
  const doorHeight = Math.min(
    input.plan.layoutType === 'factory' ? 3.2 : 2.1,
    input.storyHeight - 0.15,
  )
  const door = input.includeDoor
    ? DoorNode.parse({
        name: input.labels.doorName,
        wallId: firstWall.id,
        parentId: firstWall.id,
        position: [wallLocalX(firstStart, firstEnd, 0.5, doorWidth), doorHeight / 2, 0],
        width: doorWidth,
        height: doorHeight,
        ...(input.plan.layoutType === 'factory'
          ? { doorCategory: 'garage' as const, doorType: 'garage-rollup' as const }
          : {}),
        metadata: { ...storyMetadata, mcpTool: 'add_door', role: 'layout-door' },
      })
    : null

  const windowWidth = Math.min(
    1.5,
    Math.max(0.8, Math.min(input.dimensions.length, input.dimensions.width) / 3),
  )
  const windows = walls.slice(1, 3).map((wall, offsetIndex) => {
    const start = input.polygon[offsetIndex + 1]!
    const end = input.polygon[(offsetIndex + 2) % input.polygon.length]!
    return WindowNode.parse({
      name: input.labels.windowName,
      wallId: wall.id,
      parentId: wall.id,
      position: [
        wallLocalX(start, end, 0.5, windowWidth),
        Math.min(1.55, input.storyHeight * 0.6),
        0,
      ],
      width: windowWidth,
      height: Math.min(1.1, Math.max(0.6, input.storyHeight * 0.4)),
      metadata: { ...storyMetadata, mcpTool: 'add_window', role: 'layout-window' },
    })
  })

  return [
    parentPatch(zone, input.parentId),
    ...(slab ? [parentPatch(slab, input.parentId)] : []),
    ...(ceiling ? [parentPatch(ceiling, input.parentId)] : []),
    ...(input.omitPerimeterWalls
      ? []
      : [
          ...walls.map((wall) => parentPatch(wall, input.parentId)),
          ...(door ? [parentPatch(door, firstWall.id)] : []),
          ...windows.map((windowNode) => parentPatch(windowNode, windowNode.wallId)),
        ]),
  ]
}

function createRoofPatches(input: {
  parentId?: string
  centerX: number
  centerZ: number
  dimensions: { length: number; width: number }
  spec: FactoryBuildingSpec
  baseMetadata: Record<string, unknown>
}) {
  const roof = RoofNode.parse({
    name: '\u5c4b\u9876',
    position: [input.centerX, input.spec.storyHeight, input.centerZ],
    metadata: {
      ...input.baseMetadata,
      mcpTool: 'create_roof',
      role: 'layout-roof',
      storyIndex: input.spec.stories - 1,
      storyCount: input.spec.stories,
    },
  })
  const segment = RoofSegmentNode.parse({
    name: '\u5c4b\u9876\u6bb5',
    roofType: input.spec.roofType,
    width: input.dimensions.length,
    depth: input.dimensions.width,
    wallHeight: input.spec.roofType === 'flat' ? 0.2 : 0.35,
    roofHeight:
      input.spec.roofType === 'flat'
        ? 0.2
        : Math.max(0.8, Math.min(2.2, input.spec.storyHeight * 0.45)),
    position: [0, 0, 0],
    metadata: {
      ...input.baseMetadata,
      mcpTool: 'create_roof',
      role: 'layout-roof-segment',
      storyIndex: input.spec.stories - 1,
      storyCount: input.spec.stories,
    },
  })
  return [
    parentPatch({ ...roof, children: [segment.id] }, input.parentId),
    parentPatch(segment, roof.id),
  ]
}

export function buildFactoryLayoutCreatePatches(input: {
  prompt: string
  plan: Extract<FactoryPlan, { kind: 'layout' }>
  placement: GeneratedGeometryPlacementSpec
  params?: Record<string, unknown>
}): FactoryLayoutPatchPlan {
  const spec = inferFactoryBuildingSpec({
    prompt: input.prompt,
    plan: input.plan,
    params: input.params,
  })
  const dimensions = { length: spec.length, width: spec.width }
  const parentId =
    typeof input.placement.parentId === 'string' ? input.placement.parentId : undefined
  const buildingId = stringMetadata(input.placement.metadata?.buildingId)
  const baseMetadata = {
    generatedBy: input.placement.generatedBy ?? 'factory-agent',
    factoryLayoutType: input.plan.layoutType,
    sourcePrompt: input.prompt,
    storyCount: spec.stories,
    storyHeight: spec.storyHeight,
    hasRoof: spec.hasRoof,
    ...input.placement.metadata,
  }
  const center = resolveLayoutCenter({
    prompt: input.prompt,
    dimensions,
    metadata: baseMetadata,
    placement: input.placement,
  })
  const polygon = rectanglePolygon(
    center.centerX,
    center.centerZ,
    dimensions.length,
    dimensions.width,
  )
  const labels = roomLabels({
    layoutType: input.plan.layoutType,
    prompt: input.prompt,
    metadata: baseMetadata,
  })
  const roomName = labels.roomName
  const omitPerimeterWalls = booleanParam(input.params?.omitPerimeterWalls) ?? false

  const shouldCreateBuildingForStories = spec.stories > 1 && !buildingId
  const generatedBuilding = shouldCreateBuildingForStories
    ? BuildingNode.parse({
        name: roomName,
        children: [],
        metadata: {
          ...baseMetadata,
          mcpTool: 'create_building',
          role: 'layout-building',
        },
      })
    : null
  const effectiveBuildingId = buildingId ?? generatedBuilding?.id
  const effectiveStoryCount = spec.stories > 1 && effectiveBuildingId ? spec.stories : 1

  const storyParentIds: string[] = []
  const levelPatches: GeneratedGeometryCreatePatch[] = []
  if (effectiveStoryCount > 1 && effectiveBuildingId) {
    for (let storyIndex = 0; storyIndex < effectiveStoryCount; storyIndex += 1) {
      if (storyIndex === 0 && !generatedBuilding && parentId) {
        storyParentIds[storyIndex] = parentId
        continue
      }
      const level = LevelNode.parse({
        name: `\u697c\u5c42${storyIndex}`,
        level: storyIndex,
        children: [],
        parentId: effectiveBuildingId,
        metadata: {
          ...baseMetadata,
          buildingId: effectiveBuildingId,
          mcpTool: 'create_level',
          role: 'layout-level',
          storyIndex,
        },
      })
      levelPatches.push(parentPatch(level, effectiveBuildingId))
      storyParentIds[storyIndex] = level.id
    }
  } else if (parentId) {
    storyParentIds[0] = parentId
  }

  const patches: GeneratedGeometryCreatePatch[] = [
    ...(generatedBuilding ? [parentPatch(generatedBuilding)] : []),
    ...levelPatches,
  ]
  for (let storyIndex = 0; storyIndex < effectiveStoryCount; storyIndex += 1) {
    patches.push(
      ...createStoryShellPatches({
        plan: input.plan,
        parentId: storyParentIds[storyIndex] ?? parentId,
        polygon,
        dimensions,
        labels,
        baseMetadata: {
          ...baseMetadata,
          layoutPlacementIntent: center.placementIntent,
          ...(effectiveStoryCount !== spec.stories
            ? { requestedStoryCount: spec.stories, multiStorySkippedReason: 'missing-building-id' }
            : {}),
        },
        storyIndex,
        storyCount: effectiveStoryCount,
        storyHeight: spec.storyHeight,
        includeDoor: storyIndex === 0,
        omitPerimeterWalls,
      }),
    )
  }

  if (spec.hasRoof) {
    patches.push(
      ...createRoofPatches({
        parentId: storyParentIds[effectiveStoryCount - 1] ?? parentId,
        centerX: center.centerX,
        centerZ: center.centerZ,
        dimensions,
        spec: { ...spec, stories: effectiveStoryCount },
        baseMetadata,
      }),
    )
  }

  return {
    patches,
    nodeIds: patches.map((patch) => patch.node.id),
    created: patches.map((patch) => patch.node.name ?? patch.node.type),
    summary: `${roomName}: ${dimensions.length}m x ${dimensions.width}m x ${effectiveStoryCount}F`,
  }
}
