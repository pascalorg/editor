// Side-effect import MUST come first: installs RAF polyfill before core loads.
import '../bridge/node-shims'

import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { publishLiveSceneSnapshot } from '../tools/live-sync'
import { InMemorySceneStore } from '../tools/scene-lifecycle/test-utils'
import { buildFromBriefPrompt, registerFromBrief } from './from-brief'
import { buildIterateOnFeedbackPrompt, registerIterateOnFeedback } from './iterate-on-feedback'
import { buildRenovationMessages, registerRenovationFromPhotos } from './renovation-from-photos'

type ClientServerPair = {
  client: Client
  server: McpServer
  bridge: SceneBridge
  close: () => Promise<void>
}

async function spinUp(
  register: (server: McpServer, bridge: SceneBridge) => void,
): Promise<ClientServerPair> {
  const bridge = new SceneBridge()
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  register(server, bridge)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return {
    client,
    server,
    bridge,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

function resetScene(): void {
  useScene.getState().unloadScene()
  useScene.temporal.getState().clear()
}

describe('from_brief', () => {
  beforeEach(() => resetScene())

  test('includes brief in the returned user message', async () => {
    const pair = await spinUp(registerFromBrief)
    try {
      const res = await pair.client.getPrompt({
        name: 'from_brief',
        arguments: { brief: 'A 60 sqm studio with a kitchenette' },
      })
      expect(res.messages).toHaveLength(1)
      const m = res.messages[0]
      expect(m).toBeDefined()
      if (!m) return
      expect(m.role).toBe('user')
      expect(m.content.type).toBe('text')
      if (m.content.type === 'text') {
        expect(m.content.text).toContain('60 sqm studio')
        expect(m.content.text).toContain('create_story_shell')
        expect(m.content.text).toContain('pascal://agent/guide')
        expect(m.content.text).toContain('dedicated roof level')
      }
    } finally {
      await pair.close()
    }
  })

  test('instructs the LLM to bind an active scene before mutations', async () => {
    const pair = await spinUp(registerFromBrief)
    try {
      const res = await pair.client.getPrompt({
        name: 'from_brief',
        arguments: { brief: 'Add a bedroom' },
      })
      const m = res.messages[0]
      expect(m).toBeDefined()
      if (!m) return
      if (m.content.type === 'text') {
        expect(m.content.text).toContain('CRITICAL FIRST STEP')
        expect(m.content.text).toContain('load_scene')
        expect(m.content.text).toContain('create_project')
        expect(m.content.text).toContain('create_house_from_brief')
        expect(m.content.text).toContain('no bound scene')
      }
    } finally {
      await pair.close()
    }
  })

  test('appends constraints section when provided', async () => {
    const pair = await spinUp(registerFromBrief)
    try {
      const res = await pair.client.getPrompt({
        name: 'from_brief',
        arguments: {
          brief: 'Tiny house',
          constraints: 'footprint under 40 sqm',
        },
      })
      const m = res.messages[0]
      expect(m).toBeDefined()
      if (!m) return
      if (m.content.type === 'text') {
        expect(m.content.text).toContain('## Constraints')
        expect(m.content.text).toContain('footprint under 40 sqm')
      }
    } finally {
      await pair.close()
    }
  })

  test('buildFromBriefPrompt omits constraints section when empty', () => {
    const text = buildFromBriefPrompt({ brief: 'Studio', constraints: '' })
    expect(text).not.toContain('## Constraints')
    expect(text).toContain('Studio')
  })
})

describe('iterate_on_feedback', () => {
  beforeEach(() => resetScene())

  test('returns single user message referencing the feedback and the scene resource', async () => {
    const pair = await spinUp(registerIterateOnFeedback)
    try {
      const res = await pair.client.getPrompt({
        name: 'iterate_on_feedback',
        arguments: { feedback: 'Move the fridge to the opposite wall' },
      })
      expect(res.messages).toHaveLength(1)
      const m = res.messages[0]
      expect(m).toBeDefined()
      if (!m) return
      expect(m.role).toBe('user')
      if (m.content.type === 'text') {
        expect(m.content.text).toContain('Move the fridge')
        expect(m.content.text).toContain('pascal://scene/current')
        expect(m.content.text).toContain('apply_patch')
      }
    } finally {
      await pair.close()
    }
  })

  test('buildIterateOnFeedbackPrompt emphasises minimal diff', () => {
    const text = buildIterateOnFeedbackPrompt({ feedback: 'x' })
    expect(text.toLowerCase()).toContain('minimum')
  })
})

describe('renovation_from_photos', () => {
  beforeEach(() => resetScene())

  test('parses JSON-array photo lists and emits image/text content', async () => {
    const pair = await spinUp(registerRenovationFromPhotos)
    try {
      const longBase64 = 'A'.repeat(40) // length % 4 == 0, pure base64 chars.
      const res = await pair.client.getPrompt({
        name: 'renovation_from_photos',
        arguments: {
          currentPhotos: JSON.stringify(['https://example.com/current1.jpg', longBase64]),
          referencePhotos: JSON.stringify(['data:image/png;base64,iVBORw0K']),
          goals: 'make it look mid-century modern',
        },
      })
      expect(res.messages.length).toBeGreaterThan(1)

      // Intro text should mention goals + counts.
      const intro = res.messages[0]
      expect(intro).toBeDefined()
      if (!intro) return
      if (intro.content.type !== 'text') throw new Error('intro not text')
      expect(intro.content.text).toContain('mid-century modern')
      expect(intro.content.text).toContain('Current photos: 2')
      expect(intro.content.text).toContain('Reference photos: 1')

      // There should be at least one image content (from the base64) and one
      // URL text fallback (from the https URL).
      const kinds = res.messages.map((m) => m.content.type)
      expect(kinds).toContain('image')
      const textMessages = res.messages.filter((m) => m.content.type === 'text')
      const hasUrlFallback = textMessages.some(
        (m) => m.content.type === 'text' && m.content.text.startsWith('URL: https://'),
      )
      expect(hasUrlFallback).toBe(true)

      // Final message should be a task directive.
      const last = res.messages[res.messages.length - 1]
      expect(last).toBeDefined()
      if (!last) return
      if (last.content.type === 'text') {
        expect(last.content.text).toContain('## Task')
        expect(last.content.text).toContain('apply_patch')
      }
    } finally {
      await pair.close()
    }
  })

  test('data-URL with explicit mimeType becomes image content', () => {
    const messages = buildRenovationMessages({
      currentPhotos: JSON.stringify(['data:image/png;base64,aGVsbG8='] as string[]),
      referencePhotos: '[]',
      goals: 'test',
    })
    const imageMsg = messages.find((m) => m.content.type === 'image')
    expect(imageMsg).toBeDefined()
    if (imageMsg && imageMsg.content.type === 'image') {
      expect(imageMsg.content.mimeType).toBe('image/png')
      expect(imageMsg.content.data).toBe('aGVsbG8=')
    }
  })

  test('comma-separated fallback parses a list correctly', () => {
    const messages = buildRenovationMessages({
      currentPhotos: 'https://a.example/1.jpg, https://b.example/2.jpg',
      referencePhotos: '',
      goals: 'test',
    })
    const urlTextMsgs = messages.filter(
      (m) => m.content.type === 'text' && m.content.text.startsWith('URL: https://'),
    )
    expect(urlTextMsgs.length).toBe(2)
  })

  test('empty lists produce no per-photo sections but still include task directive', () => {
    const messages = buildRenovationMessages({
      currentPhotos: '',
      referencePhotos: '',
      goals: 'nothing to do',
    })
    // 1 intro + 1 task = 2 messages.
    expect(messages.length).toBe(2)
    const last = messages[messages.length - 1]
    expect(last).toBeDefined()
    if (last && last.content.type === 'text') {
      expect(last.content.text).toContain('## Task')
    }
  })
})

describe('full prompt→tool→save→event regression', () => {
  beforeEach(() => {
    useScene.getState().unloadScene()
    useScene.temporal.getState().clear()
  })

  test('bedroom prompt scenario: create_room + add_door + add_window + furnish_room persists to store and emits events', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const store = new InMemorySceneStore()
    const operations = createSceneOperations({ bridge, store })

    const graph = { nodes: bridge.getNodes(), rootNodeIds: bridge.getRootNodeIds() }
    const meta = await store.save({
      name: 'Empty Project',
      graph,
      saveMode: 'draft',
      publish: false,
      operation: 'init',
    })
    operations.setActiveScene(meta)

    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!

    const {
      ZoneNode,
      SlabNode,
      CeilingNode,
      WallNode: WallSchema,
      DoorNode,
      WindowNode,
      ItemNode,
    } = await import('@pascal-app/core/schema')

    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]

    const zone = ZoneNode.parse({ name: 'Bedroom', polygon, color: '#60a5fa' })
    const slab = SlabNode.parse({ polygon })
    const ceiling = CeilingNode.parse({ polygon })
    const walls = polygon.map((start, i) =>
      WallSchema.parse({
        name: `Bedroom wall ${i + 1}`,
        start,
        end: polygon[(i + 1) % polygon.length],
      }),
    )

    const patchResult = await operations.applyPatch([
      { op: 'create', node: zone, parentId: level.id },
      { op: 'create', node: slab, parentId: level.id },
      { op: 'create', node: ceiling, parentId: level.id },
      ...walls.map((w) => ({ op: 'create' as const, node: w, parentId: level.id })),
    ])
    expect(patchResult.appliedOps).toBe(7)
    await publishLiveSceneSnapshot(operations, 'create_room')

    const doorWall = walls[0]!
    const door = DoorNode.parse({
      wallId: doorWall.id,
      parentId: doorWall.id,
      position: [1.5, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    await operations.applyPatch([{ op: 'create', node: door, parentId: doorWall.id }])
    await publishLiveSceneSnapshot(operations, 'add_door')

    const windowWall = walls[2]!
    const win = WindowNode.parse({
      wallId: windowWall.id,
      parentId: windowWall.id,
      position: [2, 1.65, 0],
      width: 1.5,
      height: 1.5,
    })
    await operations.applyPatch([{ op: 'create', node: win, parentId: windowWall.id }])
    await publishLiveSceneSnapshot(operations, 'add_window')

    const bed = ItemNode.parse({
      name: 'Double Bed',
      position: [2, 0, 0.5],
      asset: {
        id: 'double-bed',
        name: 'Double Bed',
        category: 'furniture',
        thumbnail: '',
        src: '',
        dimensions: [1.8, 0.5, 2],
        offset: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    })
    const nightstand1 = ItemNode.parse({
      name: 'Nightstand 1',
      position: [0.4, 0, 0.5],
      asset: {
        id: 'bedside-table',
        name: 'Nightstand',
        category: 'furniture',
        thumbnail: '',
        src: '',
        dimensions: [0.4, 0.5, 0.4],
        offset: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    })
    const nightstand2 = ItemNode.parse({
      name: 'Nightstand 2',
      position: [3.6, 0, 0.5],
      asset: {
        id: 'bedside-table',
        name: 'Nightstand',
        category: 'furniture',
        thumbnail: '',
        src: '',
        dimensions: [0.4, 0.5, 0.4],
        offset: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    })
    const wardrobe = ItemNode.parse({
      name: 'Wardrobe',
      position: [0.3, 0, 1.5],
      rotation: [0, Math.PI / 2, 0],
      asset: {
        id: 'closet',
        name: 'Wardrobe',
        category: 'furniture',
        thumbnail: '',
        src: '',
        dimensions: [1.2, 0.6, 2],
        offset: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    })
    await operations.applyPatch([
      { op: 'create', node: bed, parentId: level.id },
      { op: 'create', node: nightstand1, parentId: level.id },
      { op: 'create', node: nightstand2, parentId: level.id },
      { op: 'create', node: wardrobe, parentId: level.id },
    ])
    await publishLiveSceneSnapshot(operations, 'furnish_room')

    const events = await store.listSceneEvents(meta.id)
    expect(events.length).toBe(4)
    expect(events.map((e) => e.kind)).toEqual([
      'create_room',
      'add_door',
      'add_window',
      'furnish_room',
    ])

    const savedScene = await store.load(meta.id)
    expect(savedScene).not.toBeNull()
    const nodes = savedScene!.graph.nodes
    const nodeTypes = new Set(Object.values(nodes).map((n) => n.type))
    expect(nodeTypes).toContain('zone')
    expect(nodeTypes).toContain('slab')
    expect(nodeTypes).toContain('ceiling')
    expect(nodeTypes).toContain('wall')
    expect(nodeTypes).toContain('door')
    expect(nodeTypes).toContain('window')
    expect(nodeTypes).toContain('item')

    const itemCount = Object.values(nodes).filter((n) => n.type === 'item').length
    expect(itemCount).toBe(4)
    const doorCount = Object.values(nodes).filter((n) => n.type === 'door').length
    expect(doorCount).toBe(1)
    const windowCount = Object.values(nodes).filter((n) => n.type === 'window').length
    expect(windowCount).toBe(1)
  })

  test('mutation without active scene and with store throws a descriptive error', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const store = new InMemorySceneStore()
    const operations = createSceneOperations({ bridge, store })

    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    bridge.createNode(wall, level.id)

    await expect(
      publishLiveSceneSnapshot(operations, 'create_wall'),
    ).rejects.toThrow('no_active_scene')
  })

  test('mutation without active scene and without store silently returns', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const operations = createSceneOperations({ bridge })

    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    bridge.createNode(wall, level.id)

    await publishLiveSceneSnapshot(operations, 'create_wall')
  })
})
