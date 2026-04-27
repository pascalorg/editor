import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { SceneBridge } from '../../bridge/scene-bridge'
import { registerAnalyzeFloorplanImage } from './analyze-floorplan-image'

type Handler = (req: unknown) => unknown | Promise<unknown>

/**
 * Build a connected client/server pair. Optionally advertises the `sampling`
 * capability on the client and installs a mock sampling handler that returns
 * a caller-provided reply.
 */
async function makeWiredPair(opts: {
  withSampling: boolean
  samplingHandler?: Handler
}): Promise<{ client: Client; bridge: SceneBridge }> {
  const bridge = new SceneBridge()
  bridge.loadDefault()
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerAnalyzeFloorplanImage(server, bridge)

  const [srvT, cliT] = InMemoryTransport.createLinkedPair()

  const client = new Client(
    { name: 'test-client', version: '0.0.0' },
    {
      capabilities: opts.withSampling ? { sampling: {} } : {},
    },
  )

  if (opts.withSampling && opts.samplingHandler) {
    const handler = opts.samplingHandler
    client.setRequestHandler(
      CreateMessageRequestSchema,
      async (request) =>
        // Cast to unknown — in tests we return arbitrary shapes to exercise
        // parse/validation paths in the tool handler.
        (await handler(request)) as never,
    )
  }

  await Promise.all([server.connect(srvT), client.connect(cliT)])
  return { client, bridge }
}

const VALID_REPLY = {
  model: 'mock-model',
  role: 'assistant',
  content: {
    type: 'text',
    text: JSON.stringify({
      walls: [
        { start: [0, 0], end: [5, 0], thickness: 0.2 },
        { start: [5, 0], end: [5, 4] },
      ],
      rooms: [
        {
          name: 'Living Room',
          polygon: [
            [0, 0],
            [5, 0],
            [5, 4],
            [0, 4],
          ],
          approximateAreaSqM: 20,
        },
      ],
      approximateDimensions: { widthM: 5, depthM: 4 },
      confidence: 0.82,
    }),
  },
}

describe('analyze_floorplan_image', () => {
  test('happy path: valid sampling JSON → structured output', async () => {
    const { client } = await makeWiredPair({
      withSampling: true,
      samplingHandler: () => VALID_REPLY,
    })
    const result = await client.callTool({
      name: 'analyze_floorplan_image',
      arguments: {
        image: 'aGVsbG8=', // raw base64 for "hello" — contents don't matter, mock ignores.
        scaleHint: '1 cm = 1 m',
      },
    })
    expect(result.isError).toBeFalsy()
    const structured = result.structuredContent as {
      walls: unknown[]
      rooms: unknown[]
      approximateDimensions: { widthM: number; depthM: number }
      confidence: number
    }
    expect(structured.walls.length).toBe(2)
    expect(structured.rooms[0]).toMatchObject({ name: 'Living Room' })
    expect(structured.approximateDimensions).toEqual({ widthM: 5, depthM: 4 })
    expect(structured.confidence).toBe(0.82)
  })

  test('sampling unavailable → throws sampling_unavailable', async () => {
    const { client } = await makeWiredPair({ withSampling: false })
    const result = await client.callTool({
      name: 'analyze_floorplan_image',
      arguments: { image: 'aGVsbG8=' },
    })
    // The McpError thrown inside the tool handler is surfaced as a tool error.
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    expect(text).toContain('sampling_unavailable')
  })

  test('sampling returns non-JSON text → sampling_response_unparseable', async () => {
    const { client } = await makeWiredPair({
      withSampling: true,
      samplingHandler: () => ({
        model: 'mock-model',
        role: 'assistant',
        content: { type: 'text', text: 'not json at all' },
      }),
    })
    const result = await client.callTool({
      name: 'analyze_floorplan_image',
      arguments: { image: 'aGVsbG8=' },
    })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    expect(text).toContain('sampling_response_unparseable')
  })

  test('sampling returns JSON that fails schema → sampling_response_invalid', async () => {
    const { client } = await makeWiredPair({
      withSampling: true,
      samplingHandler: () => ({
        model: 'mock-model',
        role: 'assistant',
        content: {
          type: 'text',
          text: JSON.stringify({
            // Missing required fields (no rooms, approximateDimensions, confidence).
            walls: [],
          }),
        },
      }),
    })
    const result = await client.callTool({
      name: 'analyze_floorplan_image',
      arguments: { image: 'aGVsbG8=' },
    })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    expect(text).toContain('sampling_response_invalid')
  })

  test('strips data URI prefix before base64 → still produces valid output', async () => {
    let capturedRequest: unknown
    const { client } = await makeWiredPair({
      withSampling: true,
      samplingHandler: (req) => {
        capturedRequest = req
        return VALID_REPLY
      },
    })
    await client.callTool({
      name: 'analyze_floorplan_image',
      arguments: {
        image: 'data:image/png;base64,aGVsbG8=',
      },
    })
    const params = (capturedRequest as { params: { messages: Array<{ content: unknown }> } }).params
    const content = params.messages[0]!.content as Array<{
      type: string
      data?: string
      mimeType?: string
      text?: string
    }>
    const img = content.find((b) => b.type === 'image')
    expect(img).toBeDefined()
    expect(img?.mimeType).toBe('image/png')
    expect(img?.data).toBe('aGVsbG8=')
  })
})
