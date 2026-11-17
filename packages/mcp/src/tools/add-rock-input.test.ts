import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { RockNode, SiteNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerSharedTools } from './shared-tools'

const outline = [
  [-2, -1],
  [2, -1],
  [2, 1],
  [-2, 1],
]

async function connection() {
  const site = SiteNode.parse({ id: 'site_rock_input_mcp' })
  const bridge = new SceneBridge()
  bridge.setScene({ [site.id]: site }, [site.id])
  bridge.clearHistory()
  const server = new McpServer({ name: 'rock-input-acceptance', version: '0.0.0' })
  registerSharedTools(server, bridge)
  const client = new Client({ name: 'rock-input-client', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { bridge, server, client, site }
}

function expectBounds(rock: RockNode, bounds: [number, number, number, number]) {
  const xs = rock.polygon.map(([x]) => x)
  const zs = rock.polygon.map(([, z]) => z)
  const actual = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(bounds[index]!, 9)
  })
}

// Contract-derived bounds and persisted scene state through the real MCP registration,
// transport and bridge. No listening server, mocks, or direct operation calls here.
describe('add_rock footprint inputs over MCP', () => {
  test('discovery exposes both polygon spellings and at/size, and scalar/rectangle calls persist their dimensions', async () => {
    const { bridge, server, client, site } = await connection()
    try {
      const tool = (await client.listTools()).tools.find((entry) => entry.name === 'add_rock')
      expect(tool).toBeDefined()
      for (const key of ['outline', 'polygon', 'at', 'size']) {
        expect(tool?.inputSchema.properties).toHaveProperty(key)
        expect(tool?.inputSchema.required ?? []).not.toContain(key)
      }
      for (const sample of [
        { size: 4, bounds: [3, -5, 7, -1] },
        { size: [6, 2], bounds: [2, -4, 8, -2] },
      ]) {
        const result = await client.callTool({
          name: 'add_rock',
          arguments: { at: [5, -3], size: sample.size, seed: 17 },
        })
        expect(result.isError).toBeFalsy()
        const rockId = result.structuredContent?.rockId as string
        const rock = RockNode.parse(bridge.getNodes()[rockId])
        expect(rock).toMatchObject({ parentId: site.id, height: 2.4, seed: 17, gen: 2 })
        expectBounds(rock, sample.bounds as [number, number, number, number])
        expect(result.structuredContent).toMatchObject({
          siteId: site.id,
          facts: { heightM: 2.4, topElevationM: 2.35 },
        })
      }
      expect(Object.values(bridge.getNodes()).filter((node) => node.type === 'rock')).toHaveLength(
        2,
      )
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('both polygon spellings survive the wire and an existing rock can be edited without a footprint', async () => {
    const { bridge, server, client } = await connection()
    try {
      for (const footprint of [{ outline }, { polygon: outline }]) {
        const result = await client.callTool({
          name: 'add_rock',
          arguments: { ...footprint, gen: 1, seed: 42 },
        })
        expect(result.isError).toBeFalsy()
        const rockId = result.structuredContent?.rockId as string
        expect(bridge.getNodes()[rockId]).toMatchObject({ polygon: outline, gen: 1, seed: 42 })
        const edited = await client.callTool({ name: 'add_rock', arguments: { rockId, height: 3 } })
        expect(edited.isError).toBeFalsy()
        expect(bridge.getNodes()[rockId]).toMatchObject({
          polygon: outline,
          height: 3,
          gen: 1,
          seed: 42,
        })
      }
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('ambiguous, incomplete and invalid inputs leave the real scene unchanged, including on edits', async () => {
    const { bridge, server, client } = await connection()
    try {
      const created = await client.callTool({ name: 'add_rock', arguments: { outline } })
      expect(created.isError).toBeFalsy()
      const rockId = created.structuredContent?.rockId as string
      const before = JSON.stringify(bridge.getNodes())
      const missing = await client.callTool({ name: 'add_rock', arguments: {} })
      expect(missing.isError).toBe(true)
      expect(JSON.stringify(bridge.getNodes())).toBe(before)
      for (const invalid of [
        { outline, polygon: outline },
        { outline, at: [0, 0], size: 2 },
        { polygon: outline, at: [0, 0], size: 2 },
        { outline, at: [0, 0] },
        { polygon: outline, size: 2 },
        { at: [0, 0] },
        { size: 2 },
        { at: [0, 0], size: 0 },
        { at: [0, 0], size: [2, -1] },
        { at: [0, 0], size: [2] },
        { at: [0, 0], size: 2, height: 60.01 },
      ]) {
        for (const input of [invalid, { rockId, ...invalid }]) {
          const result = await client.callTool({ name: 'add_rock', arguments: input })
          expect(result.isError).toBe(true)
          expect(JSON.stringify(bridge.getNodes())).toBe(before)
        }
      }
      const tiny = await client.callTool({
        name: 'add_rock',
        arguments: {
          polygon: [
            [0, 0],
            [0.2, 0],
            [0.2, 0.2],
            [0, 0.2],
          ],
        },
      })
      expect(tiny.isError).toBe(true)
      const message = JSON.stringify(tiny)
      expect(message).toMatch(/0\.25\s*m(?:²|2|\^2)/)
      expect(message).toMatch(/\bat\b/)
      expect(message).toMatch(/\bsize\b/)
      expect(JSON.stringify(bridge.getNodes())).toBe(before)
      const recovery = await client.callTool({
        name: 'add_rock',
        arguments: { at: [0, 0], size: 0.6 },
      })
      expect(recovery.isError).toBeFalsy()
      const recoveredId = recovery.structuredContent?.rockId as string
      expectBounds(RockNode.parse(bridge.getNodes()[recoveredId]), [-0.3, -0.3, 0.3, 0.3])
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('a supported 0.6 m rock at step eleven does not abort the public batch', async () => {
    const { bridge, server, client } = await connection()
    try {
      const result = await client.callTool({
        name: 'run_batch',
        arguments: {
          calls: [
            ...Array.from({ length: 10 }, (_, index) => ({
              tool: 'add_rock',
              input: { at: [index * 3, 0], size: 2 },
            })),
            { tool: 'add_rock', input: { at: [35, 0], size: 0.6 } },
          ],
        },
      })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({ applied: 11, refused: 0 })
      const rocks = Object.values(bridge.getNodes()).filter((node) => node.type === 'rock')
      expect(rocks).toHaveLength(11)
      const small = rocks.find((node) => RockNode.parse(node).polygon.every(([x]) => x > 34))
      expectBounds(RockNode.parse(small), [34.7, -0.3, 35.3, 0.3])
    } finally {
      await client.close()
      await server.close()
    }
  })
})
