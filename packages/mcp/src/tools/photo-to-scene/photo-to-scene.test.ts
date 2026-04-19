import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { SceneBridge } from '../../bridge/scene-bridge'
import { InMemorySceneStore } from '../scene-lifecycle/test-utils'
import { registerPhotoToScene } from './photo-to-scene'

type Handler = (req: unknown) => unknown | Promise<unknown>

/**
 * Build a connected client/server pair for the `photo_to_scene` orchestrator.
 * Optionally advertises the `sampling` capability on the client and installs
 * a mock sampling handler that returns a caller-provided reply.
 */
async function makeWiredPair(opts: { withSampling: boolean; samplingHandler?: Handler }): Promise<{
  client: Client
  bridge: SceneBridge
  store: InMemorySceneStore
}> {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  const store = new InMemorySceneStore()
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerPhotoToScene(server, bridge, store)

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
        // Cast to unknown — tests return arbitrary shapes to exercise
        // parse/validation paths in the tool handler.
        (await handler(request)) as never,
    )
  }

  await Promise.all([server.connect(srvT), client.connect(cliT)])
  return { client, bridge, store }
}

const VALID_VISION_JSON = {
  walls: [
    { start: [0, 0], end: [5, 0], thickness: 0.2 },
    { start: [5, 0], end: [5, 4] },
    { start: [5, 4], end: [0, 4] },
    { start: [0, 4], end: [0, 0] },
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
}

const VALID_REPLY = {
  model: 'mock-model',
  role: 'assistant',
  content: {
    type: 'text',
    text: JSON.stringify(VALID_VISION_JSON),
  },
}

describe('photo_to_scene', () => {
  test('happy path: vision reply → walls + rooms + scene in bridge + saved', async () => {
    const { client, bridge, store } = await makeWiredPair({
      withSampling: true,
      samplingHandler: () => VALID_REPLY,
    })
    const result = await client.callTool({
      name: 'photo_to_scene',
      arguments: {
        image: 'aGVsbG8=',
        scaleHint: '1 cm = 1 m',
        name: 'Test Scene',
      },
    })
    expect(result.isError).toBeFalsy()
    const structured = result.structuredContent as {
      sceneId?: string
      url?: string
      walls: number
      rooms: number
      confidence: number
    }
    expect(structured.walls).toBe(4)
    expect(structured.rooms).toBe(1)
    expect(structured.confidence).toBe(0.82)
    expect(typeof structured.sceneId).toBe('string')
    expect(structured.url).toBe(`/scene/${structured.sceneId}`)

    // Bridge was swapped.
    const rootIds = bridge.getRootNodeIds()
    expect(rootIds.length).toBe(1)
    const rootId = rootIds[0]!
    const root = bridge.getNode(rootId)
    expect(root?.type).toBe('site')

    // Walls and zones exist in the flat dict.
    const allNodes = Object.values(bridge.getNodes())
    const walls = allNodes.filter((n) => n.type === 'wall')
    const zones = allNodes.filter((n) => n.type === 'zone')
    expect(walls.length).toBe(4)
    expect(zones.length).toBe(1)

    // Scene was persisted in the store.
    const saved = await store.load(structured.sceneId!)
    expect(saved).not.toBeNull()
    expect(saved?.name).toBe('Test Scene')
  })

  test('sampling unavailable → sampling_unavailable error', async () => {
    const { client } = await makeWiredPair({ withSampling: false })
    const result = await client.callTool({
      name: 'photo_to_scene',
      arguments: { image: 'aGVsbG8=' },
    })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    expect(text).toContain('sampling_unavailable')
  })

  test('invalid JSON reply → sampling_response_unparseable', async () => {
    const { client } = await makeWiredPair({
      withSampling: true,
      samplingHandler: () => ({
        model: 'mock-model',
        role: 'assistant',
        content: { type: 'text', text: 'not json at all' },
      }),
    })
    const result = await client.callTool({
      name: 'photo_to_scene',
      arguments: { image: 'aGVsbG8=' },
    })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    expect(text).toContain('sampling_response_unparseable')
  })

  test('save=false → returns graph inline, no sceneId', async () => {
    const { client, store } = await makeWiredPair({
      withSampling: true,
      samplingHandler: () => VALID_REPLY,
    })
    const result = await client.callTool({
      name: 'photo_to_scene',
      arguments: {
        image: 'aGVsbG8=',
        save: false,
      },
    })
    expect(result.isError).toBeFalsy()
    const structured = result.structuredContent as {
      sceneId?: string
      url?: string
      walls: number
      rooms: number
      confidence: number
      graph?: { nodes: Record<string, unknown>; rootNodeIds: string[] }
    }
    expect(structured.sceneId).toBeUndefined()
    expect(structured.url).toBeUndefined()
    expect(structured.graph).toBeDefined()
    expect(Array.isArray(structured.graph?.rootNodeIds)).toBe(true)
    expect(structured.graph?.rootNodeIds.length).toBe(1)
    expect(structured.walls).toBe(4)
    expect(structured.rooms).toBe(1)

    // Nothing persisted.
    const list = await store.list()
    expect(list.length).toBe(0)
  })
})
