import type { AnyNodeId } from '@pascal-app/core/schema'
import { CeilingNode, DoorNode, SlabNode, WallNode, WindowNode, ZoneNode } from '@pascal-app/core/schema'
import type {
  GeneratedGeometryCreatePatch,
  GeneratedGeometryPlacementSpec,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import type { FactoryPlan } from './factory-planner'

type Vec2 = [number, number]

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

function numbersFromText(text: string) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:m|\u7c73|meter|meters)?/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
}

function numberBeforeKeyword(text: string, keyword: RegExp) {
  const match = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:m|\\u7c73|meter|meters)?\\s*(?:${keyword.source})`, 'i'))
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
  const explicitWidth = firstNumber(params.width, params.depth, dimensionParams.width, dimensionParams.depth)
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
  const centerX = input.placement.position?.[0] ?? 0
  const centerZ = input.placement.position?.[2] ?? 0
  const polygon = rectanglePolygon(centerX, centerZ, dimensions.length, dimensions.width)
  const parentId = typeof input.placement.parentId === 'string' ? input.placement.parentId : undefined
  const baseMetadata = {
    generatedBy: input.placement.generatedBy ?? 'factory-agent',
    factoryLayoutType: input.plan.layoutType,
    sourcePrompt: input.prompt,
    ...input.placement.metadata,
  }
  const roomName =
    input.plan.layoutType === 'factory'
      ? 'Factory shell'
      : input.plan.layoutType === 'production_line'
        ? 'Production line area'
        : input.plan.layoutType === 'house'
          ? 'Generated house'
          : 'Generated room'

  const zone = ZoneNode.parse({
    name: roomName,
    polygon,
    color: input.plan.layoutType === 'factory' ? '#94a3b8' : '#60a5fa',
    metadata: { ...baseMetadata, mcpTool: 'create_room', role: 'layout-zone' },
  })
  const slab = SlabNode.parse({
    name: `${roomName} floor`,
    polygon,
    metadata: { ...baseMetadata, mcpTool: 'create_room', role: 'layout-floor' },
  })
  const ceiling = CeilingNode.parse({
    name: `${roomName} ceiling`,
    polygon,
    metadata: { ...baseMetadata, mcpTool: 'create_room', role: 'layout-ceiling' },
  })
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      name: `${roomName} wall ${index + 1}`,
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
    name: input.plan.layoutType === 'factory' ? 'Factory door' : 'Door',
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

  const windowWidth = Math.min(1.5, Math.max(0.8, Math.min(dimensions.length, dimensions.width) / 3))
  const windows = walls.slice(1, 3).map((wall, offsetIndex) => {
    const start = polygon[offsetIndex + 1]!
    const end = polygon[(offsetIndex + 2) % polygon.length]!
    return WindowNode.parse({
      name: 'Window',
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
    ...walls.map((wall) => parentPatch(wall, parentId)),
    parentPatch(door, firstWall.id),
    ...windows.map((windowNode) => parentPatch(windowNode, windowNode.wallId)),
  ]
  return {
    patches,
    nodeIds: patches.map((patch) => patch.node.id),
    created: patches.map((patch) => patch.node.name ?? patch.node.type),
    summary: `${roomName}: ${dimensions.length}m x ${dimensions.width}m`,
  }
}
