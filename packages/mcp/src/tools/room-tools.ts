import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId, AssetInput } from '@pascal-app/core/schema'
import {
  CeilingNode,
  DoorNode,
  ItemNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { findCatalogItem, searchCatalogItems } from './asset-catalog'
import { ErrorCode, throwMcpError } from './errors'
import {
  pointInBoundsWithPadding,
  polygonArea,
  polygonBounds,
  type Vec2,
  wallLength,
  wallLocalXFromT,
} from './geometry'
import { publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema, Vec2Schema } from './schemas'

const ROOM_TYPES = [
  'bedroom',
  'kitchen',
  'bathroom',
  'living',
  'dining',
  'hallway',
  'entry',
  'laundry',
  'storage',
] as const

export const searchAssetsInput = {
  query: z.string().min(1),
  category: z.string().optional(),
}

export const searchAssetsOutput = {
  results: z.array(z.record(z.string(), z.unknown())),
  total: z.number(),
}

export const createRoomInput = {
  levelId: NodeIdSchema,
  name: z.string().min(1),
  polygon: z.array(Vec2Schema).min(3),
  color: z.string().optional(),
  wallHeight: z.number().positive().optional(),
  wallThickness: z.number().positive().optional(),
}

export const createRoomOutput = {
  zoneId: z.string(),
  slabId: z.string(),
  ceilingId: z.string(),
  wallIds: z.array(z.string()),
  areaSqMeters: z.number(),
}

export const addDoorInput = {
  wallId: NodeIdSchema,
  t: z.number().min(0).max(1).optional(),
  position: z.number().min(0).max(1).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  hingesSide: z.enum(['left', 'right']).optional(),
  swingDirection: z.enum(['inward', 'outward']).optional(),
}

export const addDoorOutput = {
  doorId: z.string(),
  localX: z.number(),
}

export const addWindowInput = {
  wallId: NodeIdSchema,
  t: z.number().min(0).max(1).optional(),
  position: z.number().min(0).max(1).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  sillHeight: z.number().min(0).optional(),
}

export const addWindowOutput = {
  windowId: z.string(),
  localX: z.number(),
  sillHeight: z.number(),
}

export const furnishRoomInput = {
  levelId: NodeIdSchema.optional(),
  zoneId: NodeIdSchema.optional(),
  roomType: z.enum(ROOM_TYPES),
  polygon: z.array(Vec2Schema).min(3).optional(),
  doorWallIndex: z.number().int().min(0).optional(),
}

export const furnishRoomOutput = {
  placed: z.number(),
  itemIds: z.array(z.string()),
  skipped: z.array(z.string()),
}

type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number }
type Placement = { assetId: string; x: number; z: number; rotationDeg?: number }

function textResult<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

function assertLevel(bridge: SceneOperations, levelId: string): AnyNode {
  const level = bridge.getNode(levelId as AnyNodeId)
  if (!level) throwMcpError(ErrorCode.InvalidParams, `Level not found: ${levelId}`)
  if (level.type !== 'level') {
    throwMcpError(ErrorCode.InvalidParams, `Node ${levelId} is a ${level.type}, expected level`)
  }
  if (
    typeof level.metadata === 'object' &&
    level.metadata !== null &&
    'role' in level.metadata &&
    level.metadata.role === 'roof'
  ) {
    throwMcpError(
      ErrorCode.InvalidParams,
      `Roof support level ${levelId} is not an occupied story; create rooms or furnishings on an occupied level instead`,
    )
  }
  return level
}

function assertWall(bridge: SceneOperations, wallId: string): AnyNode & { type: 'wall' } {
  const wall = bridge.getNode(wallId as AnyNodeId)
  if (!wall) throwMcpError(ErrorCode.InvalidParams, `Wall not found: ${wallId}`)
  if (wall.type !== 'wall') {
    throwMcpError(ErrorCode.InvalidParams, `Node ${wallId} is a ${wall.type}, expected wall`)
  }
  return wall
}

function inferRoomGeometry(
  bridge: SceneOperations,
  levelId: string | undefined,
  polygon: Vec2[] | undefined,
  zoneId: string | undefined,
) {
  if (levelId && polygon) return { levelId, polygon }
  if (!zoneId) {
    throwMcpError(
      ErrorCode.InvalidParams,
      'Provide either levelId + polygon or zoneId so the room can be furnished',
    )
  }
  const zone = bridge.getNode(zoneId as AnyNodeId)
  if (!zone) throwMcpError(ErrorCode.InvalidParams, `Zone not found: ${zoneId}`)
  if (zone.type !== 'zone') {
    throwMcpError(ErrorCode.InvalidParams, `Node ${zoneId} is a ${zone.type}, expected zone`)
  }
  const inferredLevelId = levelId ?? zone.parentId ?? undefined
  if (!inferredLevelId) {
    throwMcpError(ErrorCode.InvalidParams, `Zone ${zoneId} is missing a parent level`)
  }
  return {
    levelId: inferredLevelId,
    polygon: polygon ?? (zone.polygon as Vec2[]),
  }
}

function resolveWallT(toolName: string, t?: number, position?: number): number {
  const resolved = t ?? position
  if (resolved === undefined) {
    throwMcpError(ErrorCode.InvalidParams, `${toolName} requires t or position in the 0..1 range`)
  }
  return resolved
}

function makeItemAsset(asset: AssetInput) {
  return {
    id: asset.id,
    name: asset.name,
    category: asset.category,
    thumbnail: asset.thumbnail ?? '',
    src: asset.src,
    dimensions: asset.dimensions ?? [1, 1, 1],
    offset: asset.offset ?? [0, 0, 0],
    rotation: asset.rotation ?? [0, 0, 0],
    scale: asset.scale ?? [1, 1, 1],
    ...(asset.attachTo ? { attachTo: asset.attachTo } : {}),
    ...(asset.tags ? { tags: asset.tags } : {}),
    ...(asset.surface ? { surface: asset.surface } : {}),
    ...(asset.interactive ? { interactive: asset.interactive } : {}),
  }
}

function itemFootprint(asset: AssetInput, x: number, z: number, rotationDeg = 0): Footprint {
  const [w = 1, , d = 1] = asset.dimensions ?? [1, 1, 1]
  const rot = (rotationDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rot))
  const sin = Math.abs(Math.sin(rot))
  const halfW = (w * cos + d * sin) / 2
  const halfD = (w * sin + d * cos) / 2
  return { minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD }
}

function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  const gap = 0.08
  return (
    a.maxX - gap > b.minX && a.minX + gap < b.maxX && a.maxZ - gap > b.minZ && a.minZ + gap < b.maxZ
  )
}

function buildRoomPlacements(
  roomType: (typeof ROOM_TYPES)[number],
  polygon: Vec2[],
  doorWallIndex = 0,
) {
  const bounds = polygonBounds(polygon)
  const n = polygon.length
  const backIdx = (doorWallIndex + Math.floor(n / 2)) % n
  const backStart = polygon[backIdx]!
  const backEnd = polygon[(backIdx + 1) % n]!
  const backMidX = (backStart[0] + backEnd[0]) / 2
  const backMidZ = (backStart[1] + backEnd[1]) / 2
  const inwardX = bounds.centerX - backMidX
  const inwardZ = bounds.centerZ - backMidZ
  const inwardLen = Math.sqrt(inwardX * inwardX + inwardZ * inwardZ) || 1
  const inX = inwardX / inwardLen
  const inZ = inwardZ / inwardLen
  const facingRot = (Math.atan2(inX, inZ) * 180) / Math.PI

  const alongX = backEnd[0] - backStart[0]
  const alongZ = backEnd[1] - backStart[1]
  const alongLen = Math.sqrt(alongX * alongX + alongZ * alongZ) || 1
  const ax = alongX / alongLen
  const az = alongZ / alongLen

  const backPos = (inset: number, lateral = 0): [number, number] => [
    backMidX + inX * inset + ax * lateral,
    backMidZ + inZ * inset + az * lateral,
  ]

  const sideIdx = (doorWallIndex + 1) % n
  const sideStart = polygon[sideIdx]!
  const sideEnd = polygon[(sideIdx + 1) % n]!
  const sideMidX = (sideStart[0] + sideEnd[0]) / 2
  const sideMidZ = (sideStart[1] + sideEnd[1]) / 2
  const sideInX = bounds.centerX - sideMidX
  const sideInZ = bounds.centerZ - sideMidZ
  const sideInLen = Math.sqrt(sideInX * sideInX + sideInZ * sideInZ) || 1
  const snX = sideInX / sideInLen
  const snZ = sideInZ / sideInLen
  const sideRot = (Math.atan2(snX, snZ) * 180) / Math.PI
  const sideAlongX = sideEnd[0] - sideStart[0]
  const sideAlongZ = sideEnd[1] - sideStart[1]
  const sideAlongLen = Math.sqrt(sideAlongX * sideAlongX + sideAlongZ * sideAlongZ) || 1
  const sax = sideAlongX / sideAlongLen
  const saz = sideAlongZ / sideAlongLen
  const sidePos = (inset: number, lateral = 0): [number, number] => [
    sideMidX + snX * inset + sax * lateral,
    sideMidZ + snZ * inset + saz * lateral,
  ]

  const placements: Placement[] = []
  const area = polygonArea(polygon)

  const addBack = (assetId: string, inset: number, lateral = 0, rotationDeg = facingRot) => {
    const [x, z] = backPos(inset, lateral)
    placements.push({ assetId, x, z, rotationDeg })
  }
  const addSide = (assetId: string, inset: number, lateral = 0, rotationDeg = sideRot) => {
    const [x, z] = sidePos(inset, lateral)
    placements.push({ assetId, x, z, rotationDeg })
  }

  switch (roomType) {
    case 'bedroom': {
      const bedId = Math.max(bounds.width, bounds.depth) >= 3.2 ? 'double-bed' : 'single-bed'
      const bed = findCatalogItem(bedId)
      const [bedW = 2, , bedD = 2.5] = bed?.dimensions ?? []
      addBack(bedId, bedD / 2 + 0.1)
      if (alongLen > bedW + 1.1) {
        addBack('bedside-table', 0.35, -(bedW / 2 + 0.35))
        addBack('bedside-table', 0.35, bedW / 2 + 0.35)
      }
      if (area >= 10) addSide('dresser', 0.55, sideAlongLen * 0.22)
      if (area >= 13) addSide('closet', 0.6, -sideAlongLen * 0.22)
      break
    }
    case 'kitchen':
      addBack(alongLen >= 2.6 ? 'kitchen' : 'kitchen-counter', 0.55)
      if (alongLen >= 3.5) addBack('stove', 0.55, alongLen / 2 - 0.65)
      addSide('fridge', 0.6, sideAlongLen * 0.25)
      break
    case 'bathroom':
      addBack('toilet', 0.55, alongLen * 0.25)
      addBack('bathroom-sink', 0.8, -alongLen * 0.2)
      if (area >= 6.5) addSide('bathtub', 0.85)
      else placements.push({ assetId: 'shower-square', x: bounds.centerX, z: bounds.centerZ })
      break
    case 'living': {
      addBack('sofa', 0.9)
      addBack('coffee-table', 2.1)
      addSide('livingroom-chair', 0.85, -sideAlongLen * 0.18)
      const doorIdx = doorWallIndex % n
      const doorStart = polygon[doorIdx]!
      const doorEnd = polygon[(doorIdx + 1) % n]!
      placements.push({
        assetId: 'tv-stand',
        x: (doorStart[0] + doorEnd[0]) / 2 - inX * 0.35,
        z: (doorStart[1] + doorEnd[1]) / 2 - inZ * 0.35,
        rotationDeg: facingRot + 180,
      })
      break
    }
    case 'dining':
      placements.push({ assetId: 'dining-table', x: bounds.centerX, z: bounds.centerZ })
      placements.push({ assetId: 'dining-chair', x: bounds.centerX, z: bounds.centerZ - 0.85 })
      placements.push({
        assetId: 'dining-chair',
        x: bounds.centerX,
        z: bounds.centerZ + 0.85,
        rotationDeg: 180,
      })
      if (Math.min(bounds.width, bounds.depth) >= 3) {
        placements.push({
          assetId: 'dining-chair',
          x: bounds.centerX - 0.85,
          z: bounds.centerZ,
          rotationDeg: 270,
        })
        placements.push({
          assetId: 'dining-chair',
          x: bounds.centerX + 0.85,
          z: bounds.centerZ,
          rotationDeg: 90,
        })
      }
      break
    case 'laundry':
      addBack('washing-machine', 0.6, -0.55)
      addBack('drying-rack', 0.65, 0.65)
      break
    case 'entry':
    case 'hallway':
      if (Math.min(bounds.width, bounds.depth) >= 1.4) addSide('coat-rack', 0.35)
      break
    case 'storage':
      addBack('closet', 0.6)
      break
  }

  return { placements, bounds }
}

export function registerSearchAssets(server: McpServer): void {
  server.registerTool(
    'search_assets',
    {
      title: 'Search assets',
      description:
        'Search the built-in MCP item catalog by keyword. Call before place_item when you need a valid catalogItemId.',
      inputSchema: searchAssetsInput,
      outputSchema: searchAssetsOutput,
    },
    async ({ query, category }) => {
      const results = searchCatalogItems({ query, category }).map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        tags: item.tags ?? [],
        dimensions: item.dimensions,
        attachTo: item.attachTo ?? null,
      }))
      return textResult({ results, total: results.length })
    },
  )
}

export function registerCreateRoom(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'create_room',
    {
      title: 'Create room',
      description:
        'Create a room on a level: zone, slab, ceiling, and one wall per polygon edge. Returns wallIds in polygon edge order.',
      inputSchema: createRoomInput,
      outputSchema: createRoomOutput,
    },
    async ({ levelId, name, polygon, color, wallHeight, wallThickness }) => {
      assertLevel(bridge, levelId)
      const points = polygon as Vec2[]
      const zone = ZoneNode.parse({
        name,
        polygon: points,
        color: color ?? '#60a5fa',
        metadata: { mcpTool: 'create_room' },
      })
      const slab = SlabNode.parse({ polygon: points, metadata: { mcpTool: 'create_room' } })
      const ceiling = CeilingNode.parse({ polygon: points, metadata: { mcpTool: 'create_room' } })
      const walls = points.map((start, index) =>
        WallNode.parse({
          name: `${name} wall ${index + 1}`,
          start,
          end: points[(index + 1) % points.length],
          ...(wallHeight !== undefined ? { height: wallHeight } : {}),
          ...(wallThickness !== undefined ? { thickness: wallThickness } : {}),
          metadata: { mcpTool: 'create_room', roomName: name, edgeIndex: index },
        }),
      )

      bridge.applyPatch([
        { op: 'create', node: zone, parentId: levelId as AnyNodeId },
        { op: 'create', node: slab, parentId: levelId as AnyNodeId },
        { op: 'create', node: ceiling, parentId: levelId as AnyNodeId },
        ...walls.map((wall) => ({
          op: 'create' as const,
          node: wall,
          parentId: levelId as AnyNodeId,
        })),
      ])
      await publishLiveSceneSnapshot(bridge, 'create_room')

      return textResult({
        zoneId: zone.id,
        slabId: slab.id,
        ceilingId: ceiling.id,
        wallIds: walls.map((wall) => wall.id),
        areaSqMeters: Math.round(polygonArea(points) * 100) / 100,
      })
    },
  )
}

export function registerAddDoor(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'add_door',
    {
      title: 'Add door',
      description:
        'Add a door to an existing wall. t/position is 0..1 along the wall: 0 = start, 0.5 = center, 1 = end.',
      inputSchema: addDoorInput,
      outputSchema: addDoorOutput,
    },
    async ({ wallId, t, position, width = 0.9, height = 2.1, hingesSide, swingDirection }) => {
      const wall = assertWall(bridge, wallId)
      const length = wallLength(wall)
      if (length < width) {
        throwMcpError(
          ErrorCode.InvalidParams,
          `Wall ${wallId} is ${length.toFixed(2)}m long, too short for a ${width.toFixed(2)}m door`,
        )
      }
      const wallT = resolveWallT('add_door', t, position)
      const localX = wallLocalXFromT(wall, wallT, width)
      const door = DoorNode.parse({
        wallId,
        parentId: wallId,
        position: [localX, height / 2, 0],
        width,
        height,
        ...(hingesSide ? { hingesSide } : {}),
        ...(swingDirection ? { swingDirection } : {}),
      })
      const id = bridge.createNode(door, wallId as AnyNodeId)
      await publishLiveSceneSnapshot(bridge, 'add_door')
      return textResult({ doorId: id, localX })
    },
  )
}

export function registerAddWindow(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'add_window',
    {
      title: 'Add window',
      description:
        'Add a window to an existing wall. t/position is 0..1 along the wall; sillHeight is the height from floor to window bottom.',
      inputSchema: addWindowInput,
      outputSchema: addWindowOutput,
    },
    async ({ wallId, t, position, width = 1.5, height = 1.5, sillHeight = 0.9 }) => {
      const wall = assertWall(bridge, wallId)
      const length = wallLength(wall)
      if (length < width) {
        throwMcpError(
          ErrorCode.InvalidParams,
          `Wall ${wallId} is ${length.toFixed(2)}m long, too short for a ${width.toFixed(2)}m window`,
        )
      }
      const wallT = resolveWallT('add_window', t, position)
      const localX = wallLocalXFromT(wall, wallT, width)
      const windowNode = WindowNode.parse({
        wallId,
        parentId: wallId,
        position: [localX, sillHeight + height / 2, 0],
        width,
        height,
      })
      const id = bridge.createNode(windowNode, wallId as AnyNodeId)
      await publishLiveSceneSnapshot(bridge, 'add_window')
      return textResult({ windowId: id, localX, sillHeight })
    },
  )
}

export function registerFurnishRoom(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'furnish_room',
    {
      title: 'Furnish room',
      description:
        'Place realistic furniture for a room type using levelId + polygon, or infer both from zoneId. Parent floor items to the level so they render and validate.',
      inputSchema: furnishRoomInput,
      outputSchema: furnishRoomOutput,
    },
    async ({ levelId, zoneId, roomType, polygon, doorWallIndex }) => {
      const room = inferRoomGeometry(bridge, levelId, polygon as Vec2[] | undefined, zoneId)
      assertLevel(bridge, room.levelId)
      const points = room.polygon
      const { placements, bounds } = buildRoomPlacements(roomType, points, doorWallIndex ?? 0)
      const footprints: Footprint[] = []
      const skipped: string[] = []
      const items: AnyNode[] = []

      for (const placement of placements) {
        const asset = findCatalogItem(placement.assetId)
        if (!asset) {
          skipped.push(`${placement.assetId}: asset not found`)
          continue
        }
        const fp = itemFootprint(asset, placement.x, placement.z, placement.rotationDeg ?? 0)
        const padding = 0.05
        if (
          !pointInBoundsWithPadding(fp.minX, fp.minZ, bounds, -padding) ||
          !pointInBoundsWithPadding(fp.maxX, fp.maxZ, bounds, -padding)
        ) {
          skipped.push(`${asset.id}: outside room bounds`)
          continue
        }
        if (footprints.some((existing) => footprintsOverlap(fp, existing))) {
          skipped.push(`${asset.id}: overlaps another item`)
          continue
        }
        footprints.push(fp)
        items.push(
          ItemNode.parse({
            name: asset.name,
            position: [placement.x, 0, placement.z],
            rotation: [0, ((placement.rotationDeg ?? 0) * Math.PI) / 180, 0],
            asset: makeItemAsset(asset),
            metadata: { mcpTool: 'furnish_room', roomType },
          }),
        )
      }

      if (items.length > 0) {
        bridge.applyPatch(
          items.map((item) => ({
            op: 'create' as const,
            node: item,
            parentId: room.levelId as AnyNodeId,
          })),
        )
        await publishLiveSceneSnapshot(bridge, 'furnish_room')
      }

      return textResult({
        placed: items.length,
        itemIds: items.map((item) => item.id),
        skipped,
      })
    },
  )
}

export function registerRoomTools(server: McpServer, bridge: SceneOperations): void {
  registerSearchAssets(server)
  registerCreateRoom(server, bridge)
  registerAddDoor(server, bridge)
  registerAddWindow(server, bridge)
  registerFurnishRoom(server, bridge)
}
