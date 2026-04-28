import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import {
  distance2D,
  pointInPolygon,
  polygonArea,
  polygonContainsPolygon,
  type Vec2,
  wallLength,
} from './geometry'
import { NodeIdSchema } from './schemas'

export const levelScopedInput = {
  levelId: NodeIdSchema.optional(),
}

const jsonObject = z.record(z.string(), z.unknown())

export const listLevelsOutput = {
  activeSceneId: z.string().nullable(),
  levelCount: z.number(),
  occupiedStoryCount: z.number(),
  supportLevelCount: z.number(),
  roofLevelIds: z.array(z.string()),
  levels: z.array(jsonObject),
}

export const getLevelSummaryOutput = {
  levelId: z.string(),
  levelName: z.string().optional(),
  role: z.string(),
  metadataRole: z.string().nullable(),
  isOccupiedStory: z.boolean(),
  isSupportLevel: z.boolean(),
  referenceLevelId: z.string().nullable(),
  counts: jsonObject,
  walls: z.array(jsonObject),
  zones: z.array(jsonObject),
  items: z.array(jsonObject),
  slabs: z.array(jsonObject),
  ceilings: z.array(jsonObject),
}

export const getWallsOutput = {
  levelId: z.string(),
  walls: z.array(jsonObject),
}

export const getZonesOutput = {
  levelId: z.string(),
  zones: z.array(jsonObject),
}

export const verifySceneOutput = {
  ok: z.boolean(),
  valid: z.boolean(),
  levelCount: z.number(),
  occupiedStoryCount: z.number(),
  supportLevelCount: z.number(),
  roofLevelIds: z.array(z.string()),
  activeSceneId: z.string().nullable(),
  levels: z.array(jsonObject),
  emptyLevelIds: z.array(z.string()),
  issues: z.array(z.string()),
  hasIssues: z.boolean(),
}

type ContentCounts = {
  walls: number
  zones: number
  doors: number
  windows: number
  items: number
  slabs: number
  ceilings: number
  roofs: number
  stairs: number
}

type LevelRole = 'occupied' | 'roof' | 'support'

function textResult<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

function getLevels(bridge: SceneOperations): AnyNode[] {
  return bridge.findNodes({ type: 'level' }).sort((a, b) => {
    const aa = a.type === 'level' ? a.level : 0
    const bb = b.type === 'level' ? b.level : 0
    return aa - bb
  })
}

function getDefaultLevelId(
  bridge: SceneOperations,
  requested?: string | undefined,
): AnyNodeId | null {
  if (requested) return requested as AnyNodeId
  const level = getLevels(bridge)[0]
  return (level?.id as AnyNodeId | undefined) ?? null
}

function nodesOnLevel(bridge: SceneOperations, levelId: AnyNodeId): AnyNode[] {
  return Object.values(bridge.getNodes()).filter(
    (node) => node.id !== levelId && bridge.resolveLevelId(node.id as AnyNodeId) === levelId,
  )
}

function metadataRecord(node: AnyNode): Record<string, unknown> | null {
  return typeof node.metadata === 'object' && node.metadata !== null
    ? (node.metadata as Record<string, unknown>)
    : null
}

function metadataString(node: AnyNode, key: string): string | undefined {
  const value = metadataRecord(node)?.[key]
  return typeof value === 'string' ? value : undefined
}

function occupiedContentCount(counts: ContentCounts): number {
  return (
    counts.walls +
    counts.zones +
    counts.doors +
    counts.windows +
    counts.items +
    counts.slabs +
    counts.ceilings +
    counts.stairs
  )
}

function classifyLevel(level: AnyNode, counts: ContentCounts): LevelRole {
  const metadataRole = metadataString(level, 'role')
  if (metadataRole === 'roof') return 'roof'
  if (metadataRole === 'support') return 'support'
  if (counts.roofs > 0 && occupiedContentCount(counts) === 0) return 'roof'
  return 'occupied'
}

function openingSummaries(bridge: SceneOperations, wallId: AnyNodeId) {
  return bridge
    .getChildren(wallId)
    .filter((child) => child.type === 'door' || child.type === 'window')
    .map((child) => ({
      id: child.id,
      type: child.type,
      position: child.position,
      width: child.width,
      height: child.height,
    }))
}

function wallSummary(bridge: SceneOperations, wall: AnyNode) {
  if (wall.type !== 'wall') return null
  const length = distance2D(wall.start, wall.end)
  return {
    id: wall.id,
    name: wall.name,
    start: wall.start,
    end: wall.end,
    length: Math.round(length * 100) / 100,
    height: wall.height,
    thickness: wall.thickness,
    openings: openingSummaries(bridge, wall.id as AnyNodeId),
  }
}

function zoneSummary(zone: AnyNode) {
  if (zone.type !== 'zone') return null
  const xs = zone.polygon.map((p) => p[0])
  const zs = zone.polygon.map((p) => p[1])
  return {
    id: zone.id,
    name: zone.name,
    color: zone.color,
    polygon: zone.polygon,
    areaSqMeters: Math.round(polygonArea(zone.polygon) * 100) / 100,
    bounds: {
      width: Math.round((Math.max(...xs) - Math.min(...xs)) * 100) / 100,
      depth: Math.round((Math.max(...zs) - Math.min(...zs)) * 100) / 100,
    },
  }
}

function itemSummary(item: AnyNode) {
  if (item.type !== 'item') return null
  return {
    id: item.id,
    name: item.name ?? item.asset.name,
    parentId: item.parentId,
    position: item.position,
    rotation: item.rotation,
    asset: {
      id: item.asset.id,
      name: item.asset.name,
      category: item.asset.category,
      dimensions: item.asset.dimensions,
      attachTo: item.asset.attachTo ?? null,
    },
  }
}

type SegmentTransform = {
  position: [number, number, number]
  rotation: number
}

type StairSegmentLike = {
  width: number
  length: number
  height: number
  stepCount: number
  attachmentSide: 'front' | 'left' | 'right'
}

function rotateXZ(x: number, z: number, angle: number): Vec2 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}

function toWorldPlanPoint(
  stair: AnyNode & { type: 'stair' },
  localX: number,
  localZ: number,
): Vec2 {
  const [worldX, worldZ] = rotateXZ(localX, localZ, stair.rotation ?? 0)
  return [stair.position[0] + worldX, stair.position[2] + worldZ]
}

function computeSegmentTransforms(segments: StairSegmentLike[]): SegmentTransform[] {
  const transforms: SegmentTransform[] = []
  let currentX = 0
  let currentY = 0
  let currentZ = 0
  let currentRot = 0

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (!segment) continue

    if (index === 0) {
      transforms.push({ position: [currentX, currentY, currentZ], rotation: currentRot })
      continue
    }

    const previous = segments[index - 1]
    if (!previous) continue

    let attachX = 0
    let attachZ = 0
    let rotationDelta = 0
    switch (segment.attachmentSide) {
      case 'front':
        attachZ = previous.length
        break
      case 'left':
        attachX = previous.width / 2
        attachZ = previous.length / 2
        rotationDelta = Math.PI / 2
        break
      case 'right':
        attachX = -previous.width / 2
        attachZ = previous.length / 2
        rotationDelta = -Math.PI / 2
        break
    }

    const [deltaX, deltaZ] = rotateXZ(attachX, attachZ, currentRot)
    currentX += deltaX
    currentY += previous.height
    currentZ += deltaZ
    currentRot += rotationDelta
    transforms.push({ position: [currentX, currentY, currentZ], rotation: currentRot })
  }

  return transforms
}

function stairFootprintPolygons(
  bridge: SceneOperations,
  stair: AnyNode & { type: 'stair' },
): Vec2[][] {
  if (stair.stairType === 'curved' || stair.stairType === 'spiral') {
    const radius = Math.max(0.05, stair.innerRadius ?? 0.9) + Math.max(stair.width ?? 1, 0.4)
    return [
      Array.from({ length: 24 }).map((_, index) => {
        const angle = (index / 24) * Math.PI * 2
        return toWorldPlanPoint(stair, Math.cos(angle) * radius, Math.sin(angle) * radius)
      }),
    ]
  }

  const nodes = bridge.getNodes()
  const segments = (stair.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((node): node is AnyNode & { type: 'stair-segment' } => node?.type === 'stair-segment')
  const usableSegments: StairSegmentLike[] =
    segments.length > 0
      ? segments
      : [
          {
            width: stair.width ?? 1,
            length: 3,
            height: stair.totalRise ?? 2.5,
            stepCount: stair.stepCount ?? 10,
            attachmentSide: 'front' as const,
          },
        ]
  const transforms = computeSegmentTransforms(usableSegments)

  return usableSegments.map((segment, index) => {
    const transform = transforms[index] ?? {
      position: [0, 0, 0] as [number, number, number],
      rotation: 0,
    }
    const halfWidth = segment.width / 2
    const corners: Vec2[] = [
      [-halfWidth, 0],
      [halfWidth, 0],
      [halfWidth, segment.length],
      [-halfWidth, segment.length],
    ]
    return corners.map(([localX, localZ]) => {
      const [rx, rz] = rotateXZ(localX, localZ, transform.rotation)
      return toWorldPlanPoint(stair, transform.position[0] + rx, transform.position[2] + rz)
    })
  })
}

function wallSamplePoints(wall: AnyNode & { type: 'wall' }): Vec2[] {
  return [0.25, 0.5, 0.75].map((t) => [
    wall.start[0] + (wall.end[0] - wall.start[0]) * t,
    wall.start[1] + (wall.end[1] - wall.start[1]) * t,
  ])
}

function getLevelNumber(
  levelId: string | null | undefined,
  nodes: Record<string, AnyNode>,
): number | undefined {
  if (!levelId) return undefined
  const node = nodes[levelId as AnyNodeId]
  return node?.type === 'level' ? node.level : undefined
}

function targetLevelIdsForStair(
  bridge: SceneOperations,
  stair: AnyNode & { type: 'stair' },
): AnyNodeId[] {
  const nodes = bridge.getNodes()
  const parentLevelId = bridge.resolveLevelId(stair.id as AnyNodeId)
  const fromLevelId = (stair.fromLevelId ?? parentLevelId) as string | null
  const toLevelId = (stair.toLevelId ?? fromLevelId) as string | null
  const fromLevel = getLevelNumber(fromLevelId, nodes)
  const toLevel = getLevelNumber(toLevelId, nodes)

  if (fromLevel === undefined || toLevel === undefined) {
    return toLevelId ? [toLevelId as AnyNodeId] : []
  }

  const minLevel = Math.min(fromLevel, toLevel)
  const maxLevel = Math.max(fromLevel, toLevel)
  return getLevels(bridge)
    .filter((level) => level.type === 'level' && level.level > minLevel && level.level <= maxLevel)
    .map((level) => level.id as AnyNodeId)
}

function holeBelongsToStair(
  surface: AnyNode & { type: 'slab' | 'ceiling' },
  holeIndex: number,
  stairId: string,
) {
  const metadata = surface.holeMetadata?.[holeIndex]
  return metadata?.source === 'stair' && metadata.stairId === stairId
}

function parentListsChild(parent: AnyNode, childId: string): boolean {
  if (!('children' in parent) || !Array.isArray(parent.children)) return false
  return parent.children.some((child) => {
    if (typeof child === 'string') return child === childId
    return (
      child !== null &&
      typeof child === 'object' &&
      'id' in child &&
      (child as { id?: unknown }).id === childId
    )
  })
}

function levelSummary(bridge: SceneOperations, levelId: AnyNodeId) {
  const level = bridge.getNode(levelId)
  if (!level || level.type !== 'level') {
    throw new Error(`Level not found: ${levelId}`)
  }
  const nodes = nodesOnLevel(bridge, levelId)
  const walls = nodes
    .map((n) => wallSummary(bridge, n))
    .filter((n): n is NonNullable<typeof n> => !!n)
  const zones = nodes.map(zoneSummary).filter((n): n is NonNullable<typeof n> => !!n)
  const items = nodes.map(itemSummary).filter((n): n is NonNullable<typeof n> => !!n)
  const slabs = nodes
    .filter((node) => node.type === 'slab')
    .map((node) => ({
      id: node.id,
      polygon: node.polygon,
      holes: node.holes ?? [],
      holeMetadata: node.holeMetadata ?? [],
      elevation: node.elevation,
    }))
  const ceilings = nodes
    .filter((node) => node.type === 'ceiling')
    .map((node) => ({
      id: node.id,
      polygon: node.polygon,
      holes: node.holes ?? [],
      holeMetadata: node.holeMetadata ?? [],
      height: node.height,
    }))
  const doors = nodes.filter((node) => node.type === 'door')
  const windows = nodes.filter((node) => node.type === 'window')
  const roofs = nodes.filter((node) => node.type === 'roof')
  const stairs = nodes.filter((node) => node.type === 'stair')
  const counts: ContentCounts = {
    walls: walls.length,
    zones: zones.length,
    doors: doors.length,
    windows: windows.length,
    items: items.length,
    slabs: slabs.length,
    ceilings: ceilings.length,
    roofs: roofs.length,
    stairs: stairs.length,
  }
  const role = classifyLevel(level, counts)
  const metadataRole = metadataString(level, 'role') ?? null
  const referenceLevelId = metadataString(level, 'referenceLevelId') ?? null

  return {
    levelId,
    levelName: level.name,
    floorIndex: level.level,
    role,
    metadataRole,
    isOccupiedStory: role === 'occupied',
    isSupportLevel: role !== 'occupied',
    referenceLevelId,
    counts,
    walls,
    zones,
    items,
    slabs,
    ceilings,
  }
}

export function registerListLevels(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'list_levels',
    {
      title: 'List levels',
      description:
        'List all levels in the current scene with ids, names, floor indices, and child counts.',
      inputSchema: {},
      outputSchema: listLevelsOutput,
    },
    async () => {
      const activeScene = bridge.getActiveScene()
      const levels = getLevels(bridge).map((level) => {
        const summary = levelSummary(bridge, level.id as AnyNodeId)
        return {
          id: level.id,
          name: level.name,
          floorIndex: level.type === 'level' ? level.level : 0,
          parentId: level.parentId,
          role: summary.role,
          metadataRole: summary.metadataRole,
          isOccupiedStory: summary.isOccupiedStory,
          isSupportLevel: summary.isSupportLevel,
          referenceLevelId: summary.referenceLevelId,
          childCount: bridge.getChildren(level.id as AnyNodeId).length,
        }
      })
      const occupiedStoryCount = levels.filter((level) => level.isOccupiedStory).length
      const roofLevelIds = levels
        .filter((level) => level.role === 'roof')
        .map((level) => level.id as string)
      return textResult({
        activeSceneId: activeScene?.id ?? null,
        levelCount: levels.length,
        occupiedStoryCount,
        supportLevelCount: levels.length - occupiedStoryCount,
        roofLevelIds,
        levels,
      })
    },
  )
}

export function registerGetLevelSummary(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'get_level_summary',
    {
      title: 'Get level summary',
      description:
        'Get a compact model-friendly summary of one level: counts plus walls, zones, slabs, ceilings, and items. Omit levelId to use the first level.',
      inputSchema: levelScopedInput,
      outputSchema: getLevelSummaryOutput,
    },
    async ({ levelId }) => {
      const resolved = getDefaultLevelId(bridge, levelId)
      if (!resolved) throw new Error('No level exists in the scene')
      return textResult(levelSummary(bridge, resolved))
    },
  )
}

export function registerGetWalls(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'get_walls',
    {
      title: 'Get walls',
      description:
        'Get walls on a level with start/end coordinates, length, height, thickness, and child doors/windows. Omit levelId to use the first level.',
      inputSchema: levelScopedInput,
      outputSchema: getWallsOutput,
    },
    async ({ levelId }) => {
      const resolved = getDefaultLevelId(bridge, levelId)
      if (!resolved) throw new Error('No level exists in the scene')
      return textResult({
        levelId: resolved,
        walls: levelSummary(bridge, resolved).walls,
      })
    },
  )
}

export function registerGetZones(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'get_zones',
    {
      title: 'Get zones',
      description:
        'Get room/zone polygons on a level with names, colors, bounds, and approximate areas. Omit levelId to use the first level.',
      inputSchema: levelScopedInput,
      outputSchema: getZonesOutput,
    },
    async ({ levelId }) => {
      const resolved = getDefaultLevelId(bridge, levelId)
      if (!resolved) throw new Error('No level exists in the scene')
      return textResult({
        levelId: resolved,
        zones: levelSummary(bridge, resolved).zones,
      })
    },
  )
}

export function registerVerifyScene(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'verify_scene',
    {
      title: 'Verify scene',
      description:
        'High-level self-check after complex edits. Returns validation status, per-level room/content counts, empty levels, and practical layout issues.',
      inputSchema: {},
      outputSchema: verifySceneOutput,
    },
    async () => {
      const validation = bridge.validateScene()
      const levels = getLevels(bridge).map((level) => {
        const summary = levelSummary(bridge, level.id as AnyNodeId)
        const totalContent = Object.values(summary.counts).reduce(
          (sum, count) => sum + (typeof count === 'number' ? count : 0),
          0,
        )
        return {
          levelId: level.id,
          levelName: level.name ?? `Level ${summary.floorIndex}`,
          floorIndex: summary.floorIndex,
          role: summary.role,
          metadataRole: summary.metadataRole,
          isOccupiedStory: summary.isOccupiedStory,
          isSupportLevel: summary.isSupportLevel,
          referenceLevelId: summary.referenceLevelId,
          isEmpty: totalContent === 0,
          content: summary.counts,
        }
      })

      const issues: string[] = []
      const occupiedStoryCount = levels.filter((level) => level.isOccupiedStory).length
      const roofLevelIds = levels
        .filter((level) => level.role === 'roof')
        .map((level) => level.levelId as string)
      const emptyLevelIds = levels.filter((level) => level.isEmpty).map((level) => level.levelId)
      if (emptyLevelIds.length > 0) {
        issues.push(`Empty level(s): ${emptyLevelIds.join(', ')}`)
      }

      for (const level of levels) {
        const occupiedContent = occupiedContentCount(level.content)
        if (level.role === 'roof') {
          if (level.content.roofs === 0) {
            issues.push(
              `${level.levelName} is a roof support level but has no roof geometry; add or move roof geometry there rather than deleting the support level to satisfy story count`,
            )
          }
          if (occupiedContent > 0) {
            issues.push(
              `${level.levelName} is a roof support level but contains occupied-story content; move rooms, walls, stairs, slabs, ceilings, and items to an occupied story and keep the roof level for roof geometry only`,
            )
          }
          if (level.referenceLevelId) {
            const referenceLevel = bridge.getNode(level.referenceLevelId as AnyNodeId)
            if (referenceLevel?.type === 'level' && level.floorIndex <= referenceLevel.level) {
              issues.push(
                `${level.levelName} roof support level should be above its reference occupied level ${referenceLevel.name ?? referenceLevel.id}`,
              )
            }
          }
          continue
        }

        if (level.content.walls > 0 && level.content.zones === 0) {
          issues.push(`${level.levelName} has walls but no zones/rooms`)
        }
        if (level.content.zones > 0 && level.content.slabs === 0) {
          issues.push(`${level.levelName} has zones but no slabs/floors`)
        }
        if (level.content.zones > 0 && level.content.ceilings === 0) {
          issues.push(`${level.levelName} has zones but no ceilings`)
        }
        if (level.content.walls > 0 && level.content.doors === 0) {
          issues.push(`${level.levelName} has walls but no doors`)
        }
        if (
          level.content.roofs > 0 &&
          (level.content.walls > 0 || level.content.zones > 0 || level.content.stairs > 0)
        ) {
          issues.push(
            `${level.levelName} mixes roof geometry with occupied-level content; place roofs on a dedicated roof level for solo/exploded level views`,
          )
        }
      }

      const hasMultipleOccupiedStories = occupiedStoryCount > 1
      if (hasMultipleOccupiedStories) {
        for (const level of getLevels(bridge)) {
          if (level.type !== 'level') continue
          const summary = levels.find((entry) => entry.levelId === level.id)
          if (!summary?.isOccupiedStory) continue
          const expectedHeight =
            typeof level.metadata === 'object' &&
            level.metadata !== null &&
            'height' in level.metadata &&
            typeof level.metadata.height === 'number'
              ? level.metadata.height
              : 3.2
          for (const wall of nodesOnLevel(bridge, level.id as AnyNodeId).filter(
            (node): node is AnyNode & { type: 'wall' } => node.type === 'wall',
          )) {
            const wallHeight = wall.height ?? 2.5
            if (wallHeight > expectedHeight + 0.25) {
              issues.push(
                `Wall ${wall.name ?? wall.id} on ${level.name ?? level.id} is ${wallHeight}m high; multi-story exterior walls should be split into level-owned story walls`,
              )
            }
          }
        }
      }

      for (const node of Object.values(bridge.getNodes())) {
        if (node.type === 'door' || node.type === 'window') {
          const parent = node.parentId ? bridge.getNode(node.parentId as AnyNodeId) : null
          if (!parent || parent.type !== 'wall') {
            issues.push(`${node.type} ${node.id} is not parented to a wall`)
            continue
          }
          if (node.wallId !== parent.id) {
            issues.push(
              `${node.type} ${node.id} has wallId ${node.wallId ?? 'unset'} but is parented to wall ${parent.id}`,
            )
          }
          if (!parentListsChild(parent, node.id)) {
            issues.push(`${node.type} ${node.id} is not listed in wall ${parent.id} children`)
          }
          const length = wallLength(parent)
          const width = node.width ?? (node.type === 'door' ? 0.9 : 1.5)
          const height = node.height ?? (node.type === 'door' ? 2.1 : 1.5)
          const localX = node.position[0]
          if (localX - width / 2 < -0.01 || localX + width / 2 > length + 0.01) {
            issues.push(`${node.type} ${node.id} extends outside wall ${parent.id}`)
          }
          const wallHeight = parent.height ?? 2.5
          const bottom = node.position[1] - height / 2
          const top = node.position[1] + height / 2
          if (bottom < -0.01 || top > wallHeight + 0.01) {
            issues.push(
              `${node.type} ${node.id} vertical bounds [${bottom.toFixed(2)}, ${top.toFixed(2)}] exceed wall ${parent.id} height ${wallHeight.toFixed(2)}m`,
            )
          }
        }
      }

      for (const stair of Object.values(bridge.getNodes()).filter(
        (node): node is AnyNode & { type: 'stair' } => node.type === 'stair',
      )) {
        const sourceLevelId = bridge.resolveLevelId(stair.id as AnyNodeId)
        if (sourceLevelId) {
          const sourceLevel = bridge.getNode(sourceLevelId)
          const footprints = stairFootprintPolygons(bridge, stair)
          const sourceSlabs = nodesOnLevel(bridge, sourceLevelId).filter(
            (node): node is AnyNode & { type: 'slab' } => node.type === 'slab',
          )
          if (sourceSlabs.length > 0) {
            const outsideFootprints = footprints.filter(
              (footprint) =>
                !sourceSlabs.some((slab) =>
                  polygonContainsPolygon(slab.polygon as Vec2[], footprint),
                ),
            )
            if (outsideFootprints.length > 0) {
              issues.push(
                `Stair ${stair.name ?? stair.id} footprint extends outside source floor slab on ${
                  sourceLevel?.name ?? sourceLevelId
                }`,
              )
            }
          }
          const obstructingWalls = nodesOnLevel(bridge, sourceLevelId)
            .filter((node): node is AnyNode & { type: 'wall' } => node.type === 'wall')
            .filter((wall) =>
              footprints.some((footprint) =>
                wallSamplePoints(wall).some((point) => pointInPolygon(point, footprint, false)),
              ),
            )
          for (const wall of obstructingWalls) {
            issues.push(
              `Wall ${wall.name ?? wall.id} obstructs stair ${stair.name ?? stair.id} on ${
                sourceLevel?.name ?? sourceLevelId
              }`,
            )
          }
        }

        if ((stair.slabOpeningMode ?? 'none') === 'destination') {
          const targetLevelIds = targetLevelIdsForStair(bridge, stair)
          if (targetLevelIds.length === 0) {
            issues.push(
              `Stair ${stair.name ?? stair.id} requests a slab opening but has no target level`,
            )
          }

          for (const targetLevelId of targetLevelIds) {
            const targetLevel = bridge.getNode(targetLevelId)
            const targetSlabs = nodesOnLevel(bridge, targetLevelId).filter(
              (node): node is AnyNode & { type: 'slab' } => node.type === 'slab',
            )
            if (targetSlabs.length === 0) {
              issues.push(
                `Stair ${stair.name ?? stair.id} targets ${targetLevel?.name ?? targetLevelId} but it has no slab`,
              )
              continue
            }

            const matchingHoles = targetSlabs.flatMap((slab) =>
              (slab.holes ?? [])
                .map((hole, index) => ({ slab, hole, index }))
                .filter((entry) => holeBelongsToStair(entry.slab, entry.index, stair.id)),
            )
            if (matchingHoles.length === 0) {
              issues.push(
                `Stair ${stair.name ?? stair.id} has no destination slab opening on ${
                  targetLevel?.name ?? targetLevelId
                }`,
              )
              continue
            }

            for (const { slab, hole } of matchingHoles) {
              if (!polygonContainsPolygon(slab.polygon as Vec2[], hole as Vec2[])) {
                issues.push(
                  `Stair ${stair.name ?? stair.id} opening extends outside slab ${slab.name ?? slab.id}`,
                )
              }
            }
          }
        }
      }

      if (!validation.valid) {
        for (const error of validation.errors.slice(0, 5)) {
          issues.push(`Schema: ${error.nodeId}.${error.path} ${error.message}`)
        }
        if (validation.errors.length > 5) {
          issues.push(`Schema: ${validation.errors.length - 5} additional validation errors`)
        }
      }

      const payload = {
        ok: true,
        valid: validation.valid,
        levelCount: levels.length,
        occupiedStoryCount,
        supportLevelCount: levels.length - occupiedStoryCount,
        roofLevelIds,
        activeSceneId: bridge.getActiveScene()?.id ?? null,
        levels,
        emptyLevelIds,
        issues,
        hasIssues: issues.length > 0,
      }
      return textResult(payload)
    },
  )
}

export function registerSceneQueryTools(server: McpServer, bridge: SceneOperations): void {
  registerListLevels(server, bridge)
  registerGetLevelSummary(server, bridge)
  registerGetWalls(server, bridge)
  registerGetZones(server, bridge)
  registerVerifyScene(server, bridge)
}
