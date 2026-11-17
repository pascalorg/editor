import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { SiteNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerSharedTools } from './shared-tools'

const outline = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
]
async function connection() {
  const site = SiteNode.parse({ id: 'site_rock_acceptance' })
  const bridge = new SceneBridge()
  bridge.setScene({ [site.id]: site }, [site.id])
  bridge.clearHistory()
  const server = new McpServer({ name: 'rock-acceptance', version: '0.0.0' })
  registerSharedTools(server, bridge)
  const client = new Client({ name: 'rock-acceptance-client', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { bridge, server, client, site }
}

// Real in-memory MCP registration/transport/scene bridge, with no database or mocked operation.
describe('versioned rock parity over MCP', () => {
  test('lists the shared inputs and persists/reports an exterior type with its looks', async () => {
    const { bridge, server, client, site } = await connection()
    try {
      const tool = (await client.listTools()).tools.find((entry) => entry.name === 'add_rock')
      expect(tool).toBeDefined()
      expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
      for (const key of ['gen', 'rockType', 'weathering', 'moss']) {
        expect(tool?.inputSchema.properties).toHaveProperty(key)
      }
      const result = await client.callTool({
        name: 'add_rock',
        arguments: {
          outline,
          rockType: 'volcanic',
          seed: -19,
          weathering: 0.75,
          moss: 0.4,
          height: 2,
        },
      })
      expect(result.isError).toBeFalsy()
      const rocks = Object.values(bridge.getNodes()).filter((node) => node.type === 'rock')
      expect(rocks).toHaveLength(1)
      expect(rocks[0]).toMatchObject({
        id: result.structuredContent?.rockId,
        parentId: site.id,
        gen: 2,
        polygon: outline,
        rockType: 'volcanic',
        seed: -19,
        weathering: 0.75,
        moss: 0.4,
        height: 2,
      })
      expect(result.structuredContent).toMatchObject({
        siteId: site.id,
        facts: {
          gen: 2,
          rockType: 'volcanic',
          look: { weathering: 0.75, moss: 0.4 },
          heightM: 2,
          topElevationM: 1.95,
          footprintAreaM2: 24,
        },
      })
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('invalid new looks never create a rock or modify the scene', async () => {
    const { bridge, server, client } = await connection()
    try {
      const before = JSON.stringify(bridge.getNodes())
      for (const invalid of [
        { gen: 3 },
        { rockType: 'unknown' },
        { moss: -0.01 },
        { weathering: 1.01 },
      ]) {
        const result = await client.callTool({
          name: 'add_rock',
          arguments: { outline, ...invalid },
        })
        expect(result.isError).toBe(true)
        expect(JSON.stringify(bridge.getNodes())).toBe(before)
      }
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('a legacy rock stays legacy over edits and requires an explicit upgrade for new looks', async () => {
    const { bridge, server, client } = await connection()
    try {
      const created = await client.callTool({
        name: 'add_rock',
        arguments: { outline, gen: 1, seed: 42 },
      })
      expect(created.isError).toBeFalsy()
      const rockId = created.structuredContent?.rockId as string
      const edit = await client.callTool({ name: 'add_rock', arguments: { rockId, height: 3 } })
      expect(edit.isError).toBeFalsy()
      expect(bridge.getNodes()[rockId]).toMatchObject({ gen: 1, seed: 42, height: 3 })
      const before = JSON.stringify(bridge.getNodes())
      const refused = await client.callTool({ name: 'add_rock', arguments: { rockId, moss: 0.5 } })
      expect(refused.isError).toBe(true)
      expect(JSON.stringify(bridge.getNodes())).toBe(before)
      const upgraded = await client.callTool({
        name: 'add_rock',
        arguments: { rockId, gen: 2, rockType: 'river', moss: 0.5 },
      })
      expect(upgraded.isError).toBeFalsy()
      expect(bridge.getNodes()[rockId]).toMatchObject({
        gen: 2,
        rockType: 'river',
        moss: 0.5,
        seed: 42,
        height: 3,
      })
    } finally {
      await client.close()
      await server.close()
    }
  })
})
