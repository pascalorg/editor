import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { SceneBridge } from '../../bridge/scene-bridge'
import { registerAnalyzeRoomPhoto } from './analyze-room-photo'

type Handler = (req: unknown) => unknown | Promise<unknown>

async function makeWiredPair(opts: {
  withSampling: boolean
  samplingHandler?: Handler
}): Promise<{ client: Client; bridge: SceneBridge }> {
  const bridge = new SceneBridge()
  bridge.loadDefault()
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerAnalyzeRoomPhoto(server, bridge)

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
      async (request) => (await handler(request)) as never,
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
      approximateDimensions: { widthM: 4.2, lengthM: 5.8, heightM: 2.7 },
      identifiedFixtures: [
        { type: 'sofa', approximatePosition: [1.5, 2.0] },
        { type: 'coffee table' },
      ],
      identifiedWindows: [{ wallLabel: 'north', approximateWidthM: 1.2, approximateHeightM: 1.4 }],
    }),
  },
}

describe('analyze_room_photo', () => {
  test('happy path: valid sampling JSON → structured output', async () => {
    const { client } = await makeWiredPair({
      withSampling: true,
      samplingHandler: () => VALID_REPLY,
    })
    const result = await client.callTool({
      name: 'analyze_room_photo',
      arguments: { image: 'aGVsbG8=' },
    })
    expect(result.isError).toBeFalsy()
    const structured = result.structuredContent as {
      approximateDimensions: { widthM: number; lengthM: number; heightM?: number }
      identifiedFixtures: Array<{ type: string; approximatePosition?: [number, number] }>
      identifiedWindows: Array<{
        wallLabel?: string
        approximateWidthM?: number
        approximateHeightM?: number
      }>
    }
    expect(structured.approximateDimensions.widthM).toBe(4.2)
    expect(structured.approximateDimensions.lengthM).toBe(5.8)
    expect(structured.identifiedFixtures.length).toBe(2)
    expect(structured.identifiedFixtures[0]!.type).toBe('sofa')
    expect(structured.identifiedWindows[0]!.wallLabel).toBe('north')
  })

  test('sampling unavailable → throws sampling_unavailable', async () => {
    const { client } = await makeWiredPair({ withSampling: false })
    const result = await client.callTool({
      name: 'analyze_room_photo',
      arguments: { image: 'aGVsbG8=' },
    })
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
        content: { type: 'text', text: '{ not json' },
      }),
    })
    const result = await client.callTool({
      name: 'analyze_room_photo',
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
            // approximateDimensions missing required widthM/lengthM.
            approximateDimensions: {},
            identifiedFixtures: [],
            identifiedWindows: [],
          }),
        },
      }),
    })
    const result = await client.callTool({
      name: 'analyze_room_photo',
      arguments: { image: 'aGVsbG8=' },
    })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    expect(text).toContain('sampling_response_invalid')
  })
})
