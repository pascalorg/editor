// Side-effect import MUST come first: installs RAF polyfill before core loads.
import '../bridge/node-shims'

import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode, ZoneNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerCatalogItems } from './catalog-items'
import { registerConstraints } from './constraints'
import { registerSceneCurrent } from './scene-current'
import { registerSceneSummary } from './scene-summary'

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

/** Reset the store between tests so temporal history and nodes don't leak. */
function resetScene(): void {
  useScene.getState().unloadScene()
  useScene.temporal.getState().clear()
}

describe('pascal://scene/current', () => {
  beforeEach(() => resetScene())

  test('returns the full scene JSON', async () => {
    const pair = await spinUp(registerSceneCurrent)
    try {
      pair.bridge.loadDefault()
      const res = await pair.client.readResource({ uri: 'pascal://scene/current' })
      expect(res.contents).toHaveLength(1)
      const content = res.contents[0]
      expect(content).toBeDefined()
      const c = content as { uri: string; mimeType?: string; text?: string }
      expect(c.mimeType).toBe('application/json')
      expect(c.uri).toBe('pascal://scene/current')
      const parsed = JSON.parse(c.text ?? '{}')
      expect(parsed).toHaveProperty('nodes')
      expect(parsed).toHaveProperty('rootNodeIds')
      expect(parsed).toHaveProperty('collections')
      expect(Array.isArray(parsed.rootNodeIds)).toBe(true)
      expect(parsed.rootNodeIds.length).toBeGreaterThan(0)
    } finally {
      await pair.close()
    }
  })

  test('reflects mutations to the store', async () => {
    const pair = await spinUp(registerSceneCurrent)
    try {
      pair.bridge.loadDefault()
      const beforeRes = await pair.client.readResource({
        uri: 'pascal://scene/current',
      })
      const beforeText = (beforeRes.contents[0] as { text: string }).text
      const before = JSON.parse(beforeText)
      const beforeCount = Object.keys(before.nodes).length

      // Add a zone.
      const level = pair.bridge
        .findNodes({ type: 'level' as never })
        .find((n) => n.type === 'level')
      if (!level) throw new Error('no level')
      const zone = ZoneNode.parse({
        name: 'Living',
        parentId: level.id,
        polygon: [
          [0, 0],
          [3, 0],
          [3, 3],
          [0, 3],
        ],
      })
      pair.bridge.createNode(zone, level.id as never)

      const afterRes = await pair.client.readResource({
        uri: 'pascal://scene/current',
      })
      const afterText = (afterRes.contents[0] as { text: string }).text
      const after = JSON.parse(afterText)
      expect(Object.keys(after.nodes).length).toBe(beforeCount + 1)
    } finally {
      await pair.close()
    }
  })
})

describe('pascal://scene/current/summary', () => {
  beforeEach(() => resetScene())

  test('returns markdown with counts and bbox', async () => {
    const pair = await spinUp(registerSceneSummary)
    try {
      pair.bridge.loadDefault()
      const res = await pair.client.readResource({
        uri: 'pascal://scene/current/summary',
      })
      const content = res.contents[0] as { uri: string; mimeType?: string; text?: string }
      expect(content.mimeType).toBe('text/markdown')
      const text = content.text ?? ''
      expect(text.startsWith('# Scene summary')).toBe(true)
      expect(text).toContain('Sites:')
      expect(text).toContain('Buildings:')
      expect(text).toContain('Levels:')
      expect(text).toContain('Scene bbox')
    } finally {
      await pair.close()
    }
  })

  test('estimated floor area sums zone polygon areas', async () => {
    const pair = await spinUp(registerSceneSummary)
    try {
      pair.bridge.loadDefault()
      const level = pair.bridge
        .findNodes({ type: 'level' as never })
        .find((n) => n.type === 'level')
      if (!level) throw new Error('no level')
      const zone = ZoneNode.parse({
        name: 'Big',
        parentId: level.id,
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      })
      pair.bridge.createNode(zone, level.id as never)

      const res = await pair.client.readResource({
        uri: 'pascal://scene/current/summary',
      })
      const text = (res.contents[0] as { text: string }).text
      expect(text).toContain('12.00 m^2')
    } finally {
      await pair.close()
    }
  })

  test('empty scene returns a markdown skeleton without crashing', async () => {
    const pair = await spinUp(registerSceneSummary)
    try {
      // deliberately do NOT call loadDefault()
      const res = await pair.client.readResource({
        uri: 'pascal://scene/current/summary',
      })
      const text = (res.contents[0] as { text: string }).text
      expect(text.startsWith('# Scene summary')).toBe(true)
      expect(text).toContain('Total nodes: 0')
    } finally {
      await pair.close()
    }
  })
})

describe('pascal://catalog/items', () => {
  beforeEach(() => resetScene())

  test('returns catalog_unavailable payload', async () => {
    const pair = await spinUp(registerCatalogItems)
    try {
      const res = await pair.client.readResource({ uri: 'pascal://catalog/items' })
      const content = res.contents[0] as { uri: string; mimeType?: string; text?: string }
      expect(content.mimeType).toBe('application/json')
      const parsed = JSON.parse(content.text ?? '{}')
      expect(parsed.status).toBe('catalog_unavailable')
      expect(parsed.items).toEqual([])
      expect(typeof parsed.note).toBe('string')
    } finally {
      await pair.close()
    }
  })
})

describe('pascal://constraints/{levelId}', () => {
  beforeEach(() => resetScene())

  test('returns slabs + wall footprints for a known level', async () => {
    const pair = await spinUp(registerConstraints)
    try {
      pair.bridge.loadDefault()
      const level = pair.bridge
        .findNodes({ type: 'level' as never })
        .find((n) => n.type === 'level')
      if (!level) throw new Error('no level')
      // Add a wall so wallPolygons is non-empty.
      const wall = WallNode.parse({
        parentId: level.id,
        start: [0, 0],
        end: [4, 0],
        thickness: 0.2,
      })
      pair.bridge.createNode(wall, level.id as never)

      const res = await pair.client.readResource({
        uri: `pascal://constraints/${level.id}`,
      })
      const content = res.contents[0] as { uri: string; mimeType?: string; text?: string }
      expect(content.mimeType).toBe('application/json')
      const parsed = JSON.parse(content.text ?? '{}')
      expect(parsed.levelId).toBe(level.id)
      expect(Array.isArray(parsed.slabs)).toBe(true)
      expect(Array.isArray(parsed.wallPolygons)).toBe(true)
      expect(parsed.wallPolygons.length).toBe(1)
      expect(parsed.wallPolygons[0].wallId).toBe(wall.id)
      expect(Array.isArray(parsed.wallPolygons[0].footprint)).toBe(true)
      expect(parsed.wallPolygons[0].footprint.length).toBeGreaterThan(0)
      // Each footprint point should be [x, y].
      for (const pt of parsed.wallPolygons[0].footprint) {
        expect(pt).toHaveLength(2)
      }
    } finally {
      await pair.close()
    }
  })

  test('returns {error:"level_not_found"} for unknown levelId', async () => {
    const pair = await spinUp(registerConstraints)
    try {
      pair.bridge.loadDefault()
      const res = await pair.client.readResource({
        uri: 'pascal://constraints/level_nope',
      })
      const content = res.contents[0] as { text?: string }
      const parsed = JSON.parse(content.text ?? '{}')
      expect(parsed.error).toBe('level_not_found')
      expect(parsed.slabs).toEqual([])
      expect(parsed.wallPolygons).toEqual([])
    } finally {
      await pair.close()
    }
  })
})
