import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { SceneBridge } from '../../bridge/scene-bridge'

/**
 * Input shape for `analyze_floorplan_image`.
 *
 * `image` is either a base64-encoded payload (optionally prefixed with a
 * `data:image/<mime>;base64,` URL) or an `http(s)` URL which we fetch and
 * inline as base64 before forwarding to the MCP host via sampling.
 */
export const analyzeFloorplanImageInput = {
  image: z.string().describe('Base64-encoded image or http(s) URL'),
  scaleHint: z
    .string()
    .optional()
    .describe("Text hint about scale, e.g. '1 cm = 1 m' or 'approximately 80 m²'"),
}

export const analyzeFloorplanImageOutput = {
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
}

const OutputSchema = z.object(analyzeFloorplanImageOutput)

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
 * Resolve the `image` input into a sampling-ready image block.
 *
 * - `http(s)://` URLs are fetched, base64-encoded, and the mime type sniffed
 *   from the `content-type` response header.
 * - `data:image/*;base64,...` URIs are stripped of the prefix; mime type taken
 *   from the URI itself.
 * - Otherwise we treat the string as raw base64 and default to `image/jpeg`.
 */
async function resolveImageBlock(image: string): Promise<ImageBlock> {
  if (/^https?:\/\//i.test(image)) {
    // SSRF-safe fetch: blocks loopback / private / link-local / metadata IPs,
    // caps size at 20 MB, times out at 10s, validates each redirect hop.
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

export function registerAnalyzeFloorplanImage(server: McpServer, _bridge: SceneBridge): void {
  server.registerTool(
    'analyze_floorplan_image',
    {
      title: 'Analyze floor-plan image',
      description:
        'Defer to the MCP host (via sampling) to extract walls, rooms, and approximate dimensions from a floor-plan image. Requires host support for sampling.',
      inputSchema: analyzeFloorplanImageInput,
      outputSchema: analyzeFloorplanImageOutput,
    },
    async ({ image, scaleHint }) => {
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

      const validation = OutputSchema.safeParse(parsed)
      if (!validation.success) {
        throw new McpError(ErrorCode.InternalError, 'sampling_response_invalid', {
          raw: text,
          errors: validation.error.issues,
        })
      }

      const payload = validation.data
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
