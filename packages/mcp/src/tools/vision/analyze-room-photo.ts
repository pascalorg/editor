import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { SceneBridge } from '../../bridge/scene-bridge'

/**
 * Input shape for `analyze_room_photo`.
 *
 * Same image resolution rules as `analyze_floorplan_image`.
 */
export const analyzeRoomPhotoInput = {
  image: z.string().describe('Base64-encoded image or http(s) URL'),
}

export const analyzeRoomPhotoOutput = {
  approximateDimensions: z.object({
    widthM: z.number(),
    lengthM: z.number(),
    heightM: z.number().optional(),
  }),
  identifiedFixtures: z.array(
    z.object({
      type: z.string(),
      approximatePosition: z.tuple([z.number(), z.number()]).optional(),
    }),
  ),
  identifiedWindows: z.array(
    z.object({
      wallLabel: z.string().optional(),
      approximateWidthM: z.number().optional(),
      approximateHeightM: z.number().optional(),
    }),
  ),
}

const OutputSchema = z.object(analyzeRoomPhotoOutput)

const SYSTEM_PROMPT = `You are a vision assistant that extracts structured room data from a single photograph.
Your ONLY job: return a JSON object that exactly matches this schema — no prose, no markdown fences.

{
  "approximateDimensions": { "widthM": number, "lengthM": number, "heightM": number? },
  "identifiedFixtures": [{ "type": string, "approximatePosition": [x, z]? }, ...],
  "identifiedWindows": [{ "wallLabel": string?, "approximateWidthM": number?, "approximateHeightM": number? }, ...]
}

All measurements are in metres. "type" for fixtures is a short noun phrase such as "sofa", "kitchen island", "door".
If measurements cannot be estimated confidently, omit the optional fields rather than guessing.
DO NOT wrap the JSON in markdown. DO NOT explain. Just output the raw JSON.`

const DATA_URI_RE = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i

type ImageBlock = {
  type: 'image'
  data: string
  mimeType: string
}

async function resolveImageBlock(image: string): Promise<ImageBlock> {
  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image)
    if (!res.ok) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `failed to fetch image: ${res.status} ${res.statusText}`,
        { url: image, status: res.status },
      )
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const data = buf.toString('base64')
    const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
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

export function registerAnalyzeRoomPhoto(server: McpServer, _bridge: SceneBridge): void {
  server.registerTool(
    'analyze_room_photo',
    {
      title: 'Analyze room photo',
      description:
        'Defer to the MCP host (via sampling) to extract approximate dimensions, fixtures, and windows from a single-room photograph. Requires host support for sampling.',
      inputSchema: analyzeRoomPhotoInput,
      outputSchema: analyzeRoomPhotoOutput,
    },
    async ({ image }) => {
      const caps = server.server.getClientCapabilities()
      if (!caps?.sampling) {
        throw new McpError(ErrorCode.InvalidRequest, 'sampling_unavailable')
      }

      const imageBlock = await resolveImageBlock(image)

      const response = await server.server.createMessage({
        systemPrompt: SYSTEM_PROMPT,
        temperature: 0,
        maxTokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              imageBlock,
              {
                type: 'text',
                text: 'Analyze this room photo. Return ONLY the JSON described by the system prompt.',
              },
            ],
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
