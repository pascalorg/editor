import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNodeId, AnyNode as AnyNodeT } from '@pascal-app/core/schema'
import {
  AnyNode,
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  SiteNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { findCatalogItem } from '../asset-catalog'
import {
  collectDoorKeepouts,
  collectOccupiedFootprints,
  findValidPlacement,
  itemPlanAabb,
  type PlanAabb,
} from '../layout-clearance'
import { DESTRUCTIVE_OPEN_WORLD_TOOL_ANNOTATIONS } from '../annotations'
import { appendLiveSceneEvent } from '../live-sync'
import { measurement } from '../measurement'

/**
 * Input shape for the `photo_to_scene` orchestrator. `image` matches the
 * contract documented on `analyze_floorplan_image` — base64 or http(s) URL.
 */
export const photoToSceneInput = {
  image: z.string().describe('Base64 or https URL of the floor-plan photo'),
  scaleHint: z.string().optional().describe('e.g. "1 cm = 1 m" or "approx 80 m²"'),
  name: z.string().default('Scene from photo'),
  save: z.boolean().default(true),
  defaultWallThickness: measurement('length', 'm', {
    positive: true,
    description: 'Default wall thickness.',
  }).default(0.2),
  defaultWallHeight: measurement('length', 'm', {
    positive: true,
    description: 'Default wall height.',
  }).default(2.6),
}

export const photoToSceneOutput = {
  sceneId: z.string().optional(),
  url: z.string().optional(),
  walls: z.number(),
  rooms: z.number(),
  doors: z.number(),
  windows: z.number(),
  stairs: z.number(),
  furniture: z.number(),
  confidence: z.number(),
  notes: z.string().optional(),
  graph: z.any().optional(),
}

/**
 * Shape of the vision JSON we consume. Kept in-sync with
 * `analyze_floorplan_image`'s output schema (walls / rooms /
 * approximateDimensions / confidence).
 */
const VisionResponseSchema = z.object({
  walls: z.array(
    z.object({
      start: z.tuple([z.number(), z.number()]),
      end: z.tuple([z.number(), z.number()]),
      thickness: z.number().optional(),
      height: z.number().positive().optional(),
    }),
  ),
  rooms: z.array(
    z.object({
      name: z.string(),
      polygon: z.array(z.tuple([z.number(), z.number()])),
      approximateAreaSqM: z.number().optional(),
    }),
  ),
  doors: z.array(
    z.object({
      position: z.tuple([z.number(), z.number()]),
      widthM: z.number().positive().optional(),
      heightM: z.number().positive().optional(),
      swingDirection: z.enum(['inward', 'outward']).optional(),
    }),
  ).default([]),
  windows: z.array(
    z.object({
      position: z.tuple([z.number(), z.number()]),
      widthM: z.number().positive().optional(),
      heightM: z.number().positive().optional(),
      sillHeightM: z.number().nonnegative().optional(),
    }),
  ).default([]),
  stairs: z.array(
    z.object({
      position: z.tuple([z.number(), z.number()]),
      widthM: z.number().positive().optional(),
      runLengthM: z.number().positive().optional(),
      rotationDeg: z.number().optional(),
      stepCount: z.number().int().positive().optional(),
    }),
  ).default([]),
  furniture: z.array(
    z.object({
      type: z.string().min(1),
      position: z.tuple([z.number(), z.number()]),
      rotationDeg: z.number().optional(),
      widthM: z.number().positive().optional(),
      depthM: z.number().positive().optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ).default([]),
  approximateDimensions: z.object({
    widthM: z.number(),
    depthM: z.number(),
  }),
  confidence: z.number().min(0).max(1),
})

type VisionResponse = z.infer<typeof VisionResponseSchema>

/**
 * System prompt mirrors `analyze_floorplan_image` — the contract between
 * orchestrator and host is identical, so we keep the prompt verbatim to
 * guarantee wire-compatible responses.
 */
const SYSTEM_PROMPT = `You are a vision assistant that extracts structured floor-plan data from an image.
Your ONLY job: return a JSON object that exactly matches this schema — no prose, no markdown fences.

{
  "walls": [{ "start": [x, z], "end": [x, z], "thickness": number?, "height": number? }, ...],
  "rooms": [{ "name": string, "polygon": [[x,z], ...], "approximateAreaSqM": number? }, ...],
  "doors": [{ "position": [x,z], "widthM": number?, "heightM": number?, "swingDirection": "inward"|"outward"? }, ...],
  "windows": [{ "position": [x,z], "widthM": number?, "heightM": number?, "sillHeightM": number? }, ...],
  "stairs": [{ "position": [x,z], "widthM": number?, "runLengthM": number?, "rotationDeg": number?, "stepCount": number? }, ...],
  "furniture": [{ "type": string, "position": [x,z], "rotationDeg": number?, "widthM": number?, "depthM": number?, "confidence": number? }, ...],
  "approximateDimensions": { "widthM": number, "depthM": number },
  "confidence": number 0..1
}

Coordinates are in metres. Origin can be the floor plan's centre or bottom-left — be consistent.
Only include a wall height when it is visibly measured or annotated in the image.
Identify furniture symbols and fixtures separately from walls. Use common catalog terms such as double-bed, single-bed, sofa, coffee-table, dining-table, dining-chair, closet, dresser, kitchen, kitchen-counter, stove, fridge, toilet, bathroom-sink, bathtub, shower-square, tv-stand, shelf, desk, bookshelf, washing-machine, or coat-rack where applicable. Preserve each item's centre, orientation, and approximate footprint.
If the image is unclear, lower the confidence score but still produce your best attempt.
DO NOT wrap the JSON in markdown. DO NOT explain. Just output the raw JSON.`

const DATA_URI_RE = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i

type ImageBlock = {
  type: 'image'
  data: string
  mimeType: string
}

/**
 * Resolve the `image` input into a sampling-ready image block. Follows the
 * same fetch/data-uri/raw-base64 rules as the vision tool so the user gets
 * consistent behaviour whether they call `photo_to_scene` or
 * `analyze_floorplan_image` directly.
 */
async function resolveImageBlock(image: string): Promise<ImageBlock> {
  if (/^https?:\/\//i.test(image)) {
    // SSRF-safe fetch (see packages/mcp/src/lib/safe-fetch.ts).
    const { safeFetch } = await import('../../lib/safe-fetch')
    const res = await safeFetch(image, { accept: 'image/*' })
    const data = res.buffer.toString('base64')
    const mimeType = res.contentType ?? 'image/jpeg'
    return { type: 'image', data, mimeType }
  }

  const dataUriMatch = image.match(DATA_URI_RE)
  if (dataUriMatch) {
    return {
      type: 'image',
      mimeType: dataUriMatch[1]!,
      data: dataUriMatch[2]!,
    }
  }

  return { type: 'image', mimeType: 'image/jpeg', data: image }
}

/** Collect all text content blocks returned by the sampling host into one string. */
function extractText(
  content:
    | { type: 'text'; text: string }
    | { type: 'image' | 'audio'; data: string; mimeType: string }
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image' | 'audio'; data: string; mimeType: string }
        | { type: string; [k: string]: unknown }
      >,
): string {
  const blocks = Array.isArray(content) ? content : [content]
  const texts: string[] = []
  for (const block of blocks) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const t = (block as { text?: unknown }).text
      if (typeof t === 'string') texts.push(t)
    }
  }
  return texts.join('\n').trim()
}

/**
 * Call the host's sampling capability to analyse a floor-plan photo. Throws
 * `sampling_unavailable` when the host has not advertised the capability and
 * `sampling_response_unparseable` / `sampling_response_invalid` when the
 * reply cannot be mapped onto `VisionResponseSchema`.
 */
async function callVisionSampling(
  server: McpServer,
  image: string,
  scaleHint: string | undefined,
): Promise<VisionResponse> {
  const caps = server.server.getClientCapabilities()
  if (!caps?.sampling) {
    throw new McpError(ErrorCode.InvalidRequest, 'sampling_unavailable')
  }

  const imageBlock = await resolveImageBlock(image)
  const instruction = scaleHint
    ? `Analyze this floor plan. Scale hint: ${scaleHint}. Return ONLY the JSON described by the system prompt.`
    : 'Analyze this floor plan. Return ONLY the JSON described by the system prompt.'

  const response = await server.server.createMessage({
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 2000,
    messages: [
      {
        role: 'user',
        content: [imageBlock, { type: 'text', text: instruction }],
      },
    ],
  })

  const text = extractText(response.content as Parameters<typeof extractText>[0])
  if (!text) {
    throw new McpError(ErrorCode.InternalError, 'sampling_response_unparseable', {
      reason: 'no text content returned by host',
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new McpError(ErrorCode.InternalError, 'sampling_response_unparseable', {
      raw: text,
      reason: err instanceof Error ? err.message : String(err),
    })
  }

  const validation = VisionResponseSchema.safeParse(parsed)
  if (!validation.success) {
    throw new McpError(ErrorCode.InternalError, 'sampling_response_invalid', {
      raw: text,
      errors: validation.error.issues,
    })
  }

  return validation.data
}

type BuildResult = {
  nodes: Record<AnyNodeId, AnyNodeT>
  rootNodeIds: AnyNodeId[]
  walls: number
  rooms: number
  doors: number
  windows: number
  stairs: number
  furniture: number
  warnings: string[]
  levelId: AnyNodeId
}

type Point2 = readonly [number, number]

function nearestWall(walls: AnyNodeT[], point: Point2) {
  let best: { wall: AnyNodeT & { type: 'wall' }; t: number; distance: number } | undefined
  for (const candidate of walls) {
    if (candidate.type !== 'wall') continue
    const wall = candidate as AnyNodeT & { type: 'wall'; start: Point2; end: Point2 }
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length2 = dx * dx + dz * dz
    if (length2 <= 1e-9) continue
    const rawT = ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dz) / length2
    const t = Math.max(0, Math.min(1, rawT))
    const x = wall.start[0] + t * dx
    const z = wall.start[1] + t * dz
    const distance = Math.hypot(point[0] - x, point[1] - z)
    if (!best || distance < best.distance) best = { wall, t, distance }
  }
  return best
}

function assetForDetectedFurniture(type: string) {
  const key = type.trim().toLowerCase().replace(/\s+/g, '-')
  const aliases: Record<string, string> = {
    bed: 'double-bed',
    doublebed: 'double-bed',
    bunk: 'bunkbed',
    sofa: 'sofa',
    couch: 'sofa',
    table: 'dining-table',
    chair: 'dining-chair',
    wardrobe: 'closet',
    cabinet: 'closet',
    'kitchen-cabinet': 'kitchen-cabinet',
    sink: 'bathroom-sink',
    toilet: 'toilet',
    wc: 'toilet',
    shower: 'shower-square',
    tv: 'tv-stand',
    television: 'tv-stand',
    washingmachine: 'washing-machine',
  }
  const id = aliases[key] ?? key
  return { asset: findCatalogItem(id), requested: type, id }
}

function makeDetectedAsset(asset: NonNullable<ReturnType<typeof findCatalogItem>>, widthM?: number, depthM?: number) {
  const dimensions = [...(asset.dimensions ?? [1, 1, 1])] as [number, number, number]
  if (widthM) dimensions[0] = widthM
  if (depthM) dimensions[2] = depthM
  return { ...asset, dimensions }
}

/**
 * Build a SceneGraph (flat `nodes` dict + `rootNodeIds`) from the vision
 * response. Uses the schema factories for every node so IDs, defaults, and
 * parent linkage match what the core store would produce. Each node is
 * revalidated via `AnyNode.safeParse`; failures are dropped with a warning.
 */
function buildSceneGraphFromVision(
  vision: VisionResponse,
  defaultWallThickness: number,
  defaultWallHeight: number,
): BuildResult {
  const warnings: string[] = []

  // Build the skeleton: site → building → level.
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ level: 0, height: defaultWallHeight })
  const site = SiteNode.parse({ children: [building.id] })

  // Link parent ids so downstream traversal works.
  const siteId = site.id as AnyNodeId
  const buildingId = building.id as AnyNodeId
  const levelId = level.id as AnyNodeId
  const linkedBuilding: AnyNodeT = {
    ...(building as AnyNodeT),
    parentId: siteId,
  }
  const linkedLevel: AnyNodeT = {
    ...(level as AnyNodeT),
    parentId: buildingId,
  }

  // BuildingNode children stores level ids (string[]).
  ;(linkedBuilding as BuildingNode).children = [levelId as BuildingNode['children'][number]]

  // Collect level children (ids of walls/zones we create below).
  const levelChildren: string[] = []

  const nodes: Record<AnyNodeId, AnyNodeT> = {}

  // Validate + add site, building, level in that order.
  const siteValidated = AnyNode.safeParse(site)
  if (!siteValidated.success) {
    warnings.push(`site node failed schema validation: ${siteValidated.error.message}`)
  }
  nodes[siteId] = (siteValidated.success ? siteValidated.data : site) as AnyNodeT

  const buildingValidated = AnyNode.safeParse(linkedBuilding)
  if (!buildingValidated.success) {
    warnings.push(`building node failed schema validation: ${buildingValidated.error.message}`)
  }
  nodes[buildingId] = (
    buildingValidated.success ? buildingValidated.data : linkedBuilding
  ) as AnyNodeT

  // Walls.
  let wallsAdded = 0
  for (let i = 0; i < vision.walls.length; i++) {
    const w = vision.walls[i]!
    try {
      const wall = WallNode.parse({
        start: w.start,
        end: w.end,
        thickness: w.thickness ?? defaultWallThickness,
        ...(w.height !== undefined ? { height: w.height } : {}),
      })
      const linkedWall: AnyNodeT = {
        ...(wall as AnyNodeT),
        parentId: levelId,
      }
      const validated = AnyNode.safeParse(linkedWall)
      if (!validated.success) {
        warnings.push(`wall[${i}] dropped: ${validated.error.message}`)
        continue
      }
      nodes[wall.id as AnyNodeId] = validated.data as AnyNodeT
      levelChildren.push(wall.id)
      wallsAdded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push(`wall[${i}] dropped: ${msg}`)
    }
  }

  // Rooms → zones.
  let roomsAdded = 0
  for (let i = 0; i < vision.rooms.length; i++) {
    const r = vision.rooms[i]!
    try {
      const zone = ZoneNode.parse({
        name: r.name,
        polygon: r.polygon,
      })
      const linkedZone: AnyNodeT = {
        ...(zone as AnyNodeT),
        parentId: levelId,
      }
      const validated = AnyNode.safeParse(linkedZone)
      if (!validated.success) {
        warnings.push(`room[${i}] dropped: ${validated.error.message}`)
        continue
      }
      nodes[zone.id as AnyNodeId] = validated.data as AnyNodeT
      levelChildren.push(zone.id)
      roomsAdded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push(`room[${i}] dropped: ${msg}`)
    }
  }

  const createdWalls = Object.values(nodes).filter((node) => node.type === 'wall')
  const warningsFor = (kind: string, index: number, reason: string) =>
    warnings.push(`${kind}[${index}] skipped: ${reason}`)

  // Openings are anchored to the nearest detected wall. The vision model only
  // returns plan coordinates, while Pascal stores door/window positions in the
  // wall-local coordinate system.
  let doorsAdded = 0
  for (let i = 0; i < vision.doors.length; i++) {
    const detected = vision.doors[i]!
    const nearest = nearestWall(createdWalls, detected.position)
    if (!nearest || nearest.distance > 0.75) {
      warningsFor('door', i, 'no nearby wall')
      continue
    }
    const wall = nearest.wall
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const width = detected.widthM ?? 0.9
    const height = detected.heightM ?? 2.1
    const localX = Math.max(width / 2, Math.min(length - width / 2, nearest.t * length))
    const door = DoorNode.parse({
      wallId: wall.id,
      parentId: wall.id,
      position: [localX, height / 2, 0],
      width,
      height,
      swingDirection: detected.swingDirection ?? 'inward',
      metadata: { mcpTool: 'photo_to_scene', detectedIndex: i },
    })
    nodes[door.id as AnyNodeId] = door as AnyNodeT
    ;(nodes[wall.id] as AnyNodeT & { children?: string[] }).children = [
      ...((nodes[wall.id] as AnyNodeT & { children?: string[] }).children ?? []),
      door.id,
    ]
    doorsAdded++
  }

  let windowsAdded = 0
  for (let i = 0; i < vision.windows.length; i++) {
    const detected = vision.windows[i]!
    const nearest = nearestWall(createdWalls, detected.position)
    if (!nearest || nearest.distance > 0.75) {
      warningsFor('window', i, 'no nearby wall')
      continue
    }
    const wall = nearest.wall
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const width = detected.widthM ?? 1.5
    const height = detected.heightM ?? 1.5
    const sillHeight = detected.sillHeightM ?? 0.9
    const localX = Math.max(width / 2, Math.min(length - width / 2, nearest.t * length))
    const windowNode = WindowNode.parse({
      wallId: wall.id,
      parentId: wall.id,
      position: [localX, sillHeight + height / 2, 0],
      width,
      height,
      metadata: { mcpTool: 'photo_to_scene', detectedIndex: i },
    })
    nodes[windowNode.id as AnyNodeId] = windowNode as AnyNodeT
    ;(nodes[wall.id] as AnyNodeT & { children?: string[] }).children = [
      ...((nodes[wall.id] as AnyNodeT & { children?: string[] }).children ?? []),
      windowNode.id,
    ]
    windowsAdded++
  }

  let stairsAdded = 0
  for (let i = 0; i < vision.stairs.length; i++) {
    const detected = vision.stairs[i]!
    const stair = StairNode.parse({
      position: [detected.position[0], 0, detected.position[1]],
      rotation: ((detected.rotationDeg ?? 0) * Math.PI) / 180,
      width: detected.widthM ?? 1,
      totalRise: defaultWallHeight,
      stepCount: detected.stepCount ?? 10,
      children: [],
      metadata: { mcpTool: 'photo_to_scene', detectedIndex: i },
    })
    const segment = StairSegmentNode.parse({
      width: detected.widthM ?? 1,
      length: detected.runLengthM ?? 3,
      height: defaultWallHeight,
      stepCount: detected.stepCount ?? 10,
      parentId: stair.id,
    })
    const linkedStair = { ...stair, children: [segment.id] }
    nodes[stair.id as AnyNodeId] = linkedStair as AnyNodeT
    nodes[segment.id as AnyNodeId] = segment as AnyNodeT
    levelChildren.push(stair.id)
    stairsAdded++
  }

  let furnitureAdded = 0
  const occupied: PlanAabb[] = collectOccupiedFootprints(Object.values(nodes), {
    levelId,
    floorOnly: true,
  }).map((entry) => entry.aabb)
  const doorKeepouts = collectDoorKeepouts(Object.values(nodes), { levelId }).map(
    (entry) => entry.aabb,
  )
  const bounds = vision.rooms.length > 0
    ? vision.rooms.reduce(
        (acc, room) => {
          for (const [x, z] of room.polygon) {
            acc.minX = Math.min(acc.minX, x)
            acc.maxX = Math.max(acc.maxX, x)
            acc.minZ = Math.min(acc.minZ, z)
            acc.maxZ = Math.max(acc.maxZ, z)
          }
          return acc
        },
        { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
      )
    : undefined

  for (let i = 0; i < vision.furniture.length; i++) {
    const detected = vision.furniture[i]!
    const resolved = assetForDetectedFurniture(detected.type)
    if (!resolved.asset) {
      warningsFor('furniture', i, `no catalog match for ${resolved.requested}`)
      continue
    }
    const asset = makeDetectedAsset(resolved.asset, detected.widthM, detected.depthM)
    const primary = {
      x: detected.position[0],
      z: detected.position[1],
      rotationDeg: detected.rotationDeg ?? 0,
    }
    const placement = findValidPlacement({
      primary,
      dimensions: asset.dimensions,
      doorKeepouts,
      occupied,
      roomBounds: bounds,
    })
    if (!placement.candidate) {
      warningsFor('furniture', i, `${detected.type}: ${placement.reason}`)
      continue
    }
    const { x, z, rotationDeg } = placement.candidate
    const item = ItemNode.parse({
      name: asset.name,
      position: [x, 0, z],
      rotation: [0, (rotationDeg * Math.PI) / 180, 0],
      asset,
      metadata: {
        mcpTool: 'photo_to_scene',
        detectedType: detected.type,
        detectedConfidence: detected.confidence,
        ...(x !== primary.x || z !== primary.z ? { placementAdjusted: true } : {}),
      },
    })
    nodes[item.id as AnyNodeId] = item as AnyNodeT
    levelChildren.push(item.id)
    occupied.push(itemPlanAabb([x, 0, z], asset.dimensions, (rotationDeg * Math.PI) / 180))
    furnitureAdded++
  }
  // Finalise the level's children array now that walls/zones are in the dict.
  ;(linkedLevel as LevelNode).children = levelChildren as LevelNode['children']
  const levelValidated = AnyNode.safeParse(linkedLevel)
  if (!levelValidated.success) {
    warnings.push(`level node failed schema validation: ${levelValidated.error.message}`)
  }
  nodes[levelId] = (levelValidated.success ? levelValidated.data : linkedLevel) as AnyNodeT

  return {
    nodes,
    rootNodeIds: [siteId],
    walls: wallsAdded,
    rooms: roomsAdded,
    doors: doorsAdded,
    windows: windowsAdded,
    stairs: stairsAdded,
    furniture: furnitureAdded,
    warnings,
    levelId,
  }
}

export function registerPhotoToScene(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'photo_to_scene',
    {
      title: 'Photo to Pascal scene',
      description:
        'Orchestrator: analyse a floor-plan photo via MCP sampling, translate the structured vision result into a Pascal SceneGraph (site → building → level with walls and zones), optionally save it, and swap the bridge to the new scene. Requires host support for sampling.',
      inputSchema: photoToSceneInput,
      outputSchema: photoToSceneOutput,
      annotations: DESTRUCTIVE_OPEN_WORLD_TOOL_ANNOTATIONS,
    },
    async ({ image, scaleHint, name, save, defaultWallThickness, defaultWallHeight }) => {
      // 1. Vision.
      const vision = await callVisionSampling(server, image, scaleHint)

      // 2. Build scene graph.
      const built = buildSceneGraphFromVision(vision, defaultWallThickness, defaultWallHeight)

      const graph: SceneGraph = {
        nodes: built.nodes as SceneGraph['nodes'],
        rootNodeIds: built.rootNodeIds as SceneGraph['rootNodeIds'],
        collections: {} as SceneGraph['collections'],
      }

      // 5. Swap the bridge to the new scene so follow-up MCP calls operate on it.
      bridge.setScene(graph.nodes, graph.rootNodeIds)

      const notes = built.warnings.length > 0 ? built.warnings.join('; ') : undefined

      // 4. Save or return inline.
      if (save) {
        const meta = await bridge.saveScene({
          name,
          graph,
        })
        bridge.setActiveScene(meta)
        await appendLiveSceneEvent(bridge, meta.id, meta.version, 'photo_to_scene', graph)
        const payload: {
          sceneId: string
          url: string
          walls: number
          rooms: number
          doors: number
          windows: number
          stairs: number
          furniture: number
          confidence: number
          notes?: string
        } = {
          sceneId: meta.id,
          url: `/scene/${meta.id}`,
          walls: built.walls,
          rooms: built.rooms,
          doors: built.doors,
          windows: built.windows,
          stairs: built.stairs,
          furniture: built.furniture,
          confidence: vision.confidence,
        }
        if (notes) payload.notes = notes
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      }

      const payload: {
        walls: number
        rooms: number
        doors: number
        windows: number
        stairs: number
        furniture: number
        confidence: number
        notes?: string
        graph: SceneGraph
      } = {
        walls: built.walls,
        rooms: built.rooms,
        doors: built.doors,
        windows: built.windows,
        stairs: built.stairs,
        furniture: built.furniture,
        confidence: vision.confidence,
        graph,
      }
      bridge.clearActiveScene()
      if (notes) payload.notes = notes
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
