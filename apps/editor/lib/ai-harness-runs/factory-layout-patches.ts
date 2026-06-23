import type { AnyNodeId } from '@pascal-app/core/schema'
import {
  CeilingNode,
  DoorNode,
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
type SceneBoundsLike = {
  min: Vec2
  max: Vec2
  center?: Vec2
  size?: Vec2
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
  const vertical = /\u4e0a|top|upper|north/.test(normalized)
    ? 'top'
    : /\u4e0b|bottom|lower|south/.test(normalized)
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
  if (!bounds || (!intent.horizontal && !intent.vertical)) {
    return { centerX: 0, centerZ: 0, placementIntent: 'default-origin' }
  }

  const margin = 1
  const defaultCenterX = bounds.center?.[0] ?? (bounds.min[0] + bounds.max[0]) / 2
  const defaultCenterZ = bounds.center?.[1] ?? (bounds.min[1] + bounds.max[1]) / 2
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

export function buildFactoryLayoutCreatePatches(input: {
  prompt: string
  plan: Extract<FactoryPlan, { kind: 'layout' }>
  placement: GeneratedGeometryPlacementSpec
  params?: Record<string, unknown>
}): FactoryLayoutPatchPlan {
  const dimensions = inferFactoryLayoutDimensions({
    prompt: input.prompt,
    plan: input.plan,
    params: input.params,
  })
  const parentId =
    typeof input.placement.parentId === 'string' ? input.placement.parentId : undefined
  const baseMetadata = {
    generatedBy: input.placement.generatedBy ?? 'factory-agent',
    factoryLayoutType: input.plan.layoutType,
    sourcePrompt: input.prompt,
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

  const zone = ZoneNode.parse({
    name: roomName,
    polygon,
    color: input.plan.layoutType === 'factory' ? '#94a3b8' : '#60a5fa',
    metadata: {
      ...baseMetadata,
      mcpTool: 'create_room',
      role: 'layout-zone',
      layoutPlacementIntent: center.placementIntent,
    },
  })
  const slab = SlabNode.parse({
    name: labels.floorName,
    polygon,
    metadata: { ...baseMetadata, mcpTool: 'create_room', role: 'layout-floor' },
  })
  const ceiling = CeilingNode.parse({
    name: labels.ceilingName,
    polygon,
    metadata: { ...baseMetadata, mcpTool: 'create_room', role: 'layout-ceiling' },
  })
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      name: labels.wallName(index),
      start,
      end: polygon[(index + 1) % polygon.length]!,
      height: input.plan.layoutType === 'factory' ? 4.5 : 2.8,
      thickness: input.plan.layoutType === 'factory' ? 0.24 : 0.16,
      metadata: { ...baseMetadata, mcpTool: 'create_room', roomName, edgeIndex: index },
    }),
  )

  const firstWall = walls[0]!
  const firstStart = polygon[0]!
  const firstEnd = polygon[1]!
  const doorWidth = input.plan.layoutType === 'factory' ? 2.4 : 0.9
  const doorHeight = input.plan.layoutType === 'factory' ? 3.2 : 2.1
  const door = DoorNode.parse({
    name: labels.doorName,
    wallId: firstWall.id,
    parentId: firstWall.id,
    position: [wallLocalX(firstStart, firstEnd, 0.5, doorWidth), doorHeight / 2, 0],
    width: doorWidth,
    height: doorHeight,
    ...(input.plan.layoutType === 'factory'
      ? { doorCategory: 'garage' as const, doorType: 'garage-rollup' as const }
      : {}),
    metadata: { ...baseMetadata, mcpTool: 'add_door', role: 'layout-door' },
  })

  const windowWidth = Math.min(
    1.5,
    Math.max(0.8, Math.min(dimensions.length, dimensions.width) / 3),
  )
  const windows = walls.slice(1, 3).map((wall, offsetIndex) => {
    const start = polygon[offsetIndex + 1]!
    const end = polygon[(offsetIndex + 2) % polygon.length]!
    return WindowNode.parse({
      name: labels.windowName,
      wallId: wall.id,
      parentId: wall.id,
      position: [wallLocalX(start, end, 0.5, windowWidth), 1.55, 0],
      width: windowWidth,
      height: 1.1,
      metadata: { ...baseMetadata, mcpTool: 'add_window', role: 'layout-window' },
    })
  })

  const patches: GeneratedGeometryCreatePatch[] = [
    parentPatch(zone, parentId),
    parentPatch(slab, parentId),
    parentPatch(ceiling, parentId),
    ...(omitPerimeterWalls
      ? []
      : [
          ...walls.map((wall) => parentPatch(wall, parentId)),
          parentPatch(door, firstWall.id),
          ...windows.map((windowNode) => parentPatch(windowNode, windowNode.wallId)),
        ]),
  ]
  return {
    patches,
    nodeIds: patches.map((patch) => patch.node.id),
    created: patches.map((patch) => patch.node.name ?? patch.node.type),
    summary: `${roomName}: ${dimensions.length}m x ${dimensions.width}m`,
  }
}
