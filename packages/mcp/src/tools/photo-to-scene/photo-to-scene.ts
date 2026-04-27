import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNodeId, AnyNode as AnyNodeT } from '@pascal-app/core/schema'
import {
  AnyNode,
  BuildingNode,
  LevelNode,
  SiteNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { appendLiveSceneEvent } from '../live-sync'

/**
 * Input shape for the `photo_to_scene` orchestrator. `image` matches the
 * contract documented on `analyze_floorplan_image` — base64 or http(s) URL.
 */
export const photoToSceneInput = {
  image: z.string().describe('Base64 or https URL of the floor-plan photo'),
  scaleHint: z.string().optional().describe('e.g. "1 cm = 1 m" or "approx 80 m²"'),
  name: z.string().default('Scene from photo'),
  save: z.boolean().default(true),
  defaultWallThickness: z.number().default(0.2),
  defaultWallHeight: z.number().default(2.6),
}

export const photoToSceneOutput = {
  sceneId: z.string().optional(),
  url: z.string().optional(),
  walls: z.number(),
  rooms: z.number(),
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
    }),
  ),
  rooms: z.array(
    z.object({
      name: z.string(),
      polygon: z.array(z.tuple([z.number(), z.number()])),
      approximateAreaSqM: z.number().optional(),
    }),
  ),
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
  "walls": [{ "start": [x, z], "end": [x, z], "thickness": number? }, ...],
  "rooms": [{ "name": string, "polygon": [[x,z], ...], "approximateAreaSqM": number? }, ...],
  "approximateDimensions": { "widthM": number, "depthM": number },
  "confidence": number 0..1
}

Coordinates are in metres. Origin can be the floor plan's centre or bottom-left — be consistent.
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
  warnings: string[]
  levelId: AnyNodeId
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
  const level = LevelNode.parse({ level: 0 })
  const site = SiteNode.parse({ children: [building] })

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
        height: defaultWallHeight,
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
          confidence: number
          notes?: string
        } = {
          sceneId: meta.id,
          url: `/scene/${meta.id}`,
          walls: built.walls,
          rooms: built.rooms,
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
        confidence: number
        notes?: string
        graph: SceneGraph
      } = {
        walls: built.walls,
        rooms: built.rooms,
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
