import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { PlantingNode, SiteNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerSharedTools } from './shared-tools'
import { registerUndo } from './undo'

async function connection() {
  const site = SiteNode.parse({ id: 'site_planting' })
  const bridge = new SceneBridge()
  bridge.setScene({ [site.id]: site }, [site.id])
  bridge.clearHistory()
  const server = new McpServer({ name: 'planting-acceptance', version: '0.0.0' })
  registerSharedTools(server, bridge)
  registerUndo(server, bridge)
  const client = new Client({ name: 'real-planting-client', version: '0.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return { site, bridge, server, client }
}
const refusalCode = (content: unknown) =>
  JSON.parse((content as { text?: string }[] | undefined)?.[0]?.text ?? '{}').code

// Real MCP transport, shared production adapter and bridge: no mocked echo of an operation.
describe('add_planting over MCP', () => {
  test('is discoverable with closed-world destructive-write annotations', async () => {
    const { server, client } = await connection()
    try {
      const tools = (await client.listTools()).tools.filter((t) => t.name === 'add_planting')
      expect(tools).toHaveLength(1)
      expect(tools[0]!.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      })
      expect(tools[0]!.inputSchema.properties).toHaveProperty('outline')
      expect(tools[0]!.inputSchema.properties).toHaveProperty('plants')
    } finally {
      await client.close()
      await server.close()
    }
  })
  test('creates one Site child, returns true habit/layer facts, updates only supplied fields and undoes atomically', async () => {
    const { site, bridge, server, client } = await connection()
    try {
      const result = await client.callTool({
        name: 'add_planting',
        arguments: {
          area: 12,
          seed: 19,
          plants: [{ habit: 'ball', height: 0.7, spread: 0.6, spacing: 0.8, layer: 'mid' }],
        },
      })
      expect(result.isError).toBeFalsy()
      const nodes = Object.values(bridge.getNodes()).filter((n) => n.type === 'planting')
      expect(nodes).toHaveLength(1)
      const node = PlantingNode.parse(nodes[0])
      expect(node).toMatchObject({ parentId: site.id, area: 12, seed: 19 })
      expect(result.structuredContent?.plantingId).toBe(node.id)
      const facts = result.structuredContent?.facts as {
        areaM2: number
        plants: number
        triangles: number
        cover: number
        byHabit: Record<string, number>
        byLayer: Record<string, number>
      }
      expect(facts.areaM2).toBeCloseTo(12, 7)
      expect(facts.plants).toBeGreaterThan(0)
      expect(facts.byHabit).toEqual({ mound: 0, ball: facts.plants, spike: 0, tuft: 0, carpet: 0 })
      expect(facts.byLayer).toEqual({ back: 0, mid: facts.plants, edge: 0 })
      expect(facts.triangles).toBeGreaterThan(0)
      expect(facts.cover).toBeGreaterThan(0)
      expect(facts.cover).toBeLessThanOrEqual(1)
      const update = await client.callTool({
        name: 'add_planting',
        arguments: { plantingId: node.id, seed: 20 },
      })
      expect(update.isError).toBeFalsy()
      expect(bridge.getNodes()[node.id]).toEqual({ ...node, seed: 20 })
      const undoUpdate = await client.callTool({ name: 'undo', arguments: {} })
      expect(undoUpdate.isError).toBeFalsy()
      expect(bridge.getNodes()[node.id]).toEqual(node)
      const undoCreate = await client.callTool({ name: 'undo', arguments: {} })
      expect(undoCreate.isError).toBeFalsy()
      expect(Object.values(bridge.getNodes()).some((n) => n.type === 'planting')).toBe(false)
    } finally {
      await client.close()
      await server.close()
    }
  })
  test.each([
    [{}, 'planting_outline_required'],
    [
      {
        area: 12,
        outline: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
      'planting_outline_required',
    ],
    [
      {
        outline: [
          [0, 0],
          [4, 4],
          [0, 4],
          [4, 0],
        ],
      },
      'planting_invalid_outline',
    ],
    [{ area: 2500, plants: [{ spacing: 0.12 }] }, 'planting_budget_exceeded'],
  ] as [Record<string, unknown>, string][])(
    'refuses %j with %s and no partial state',
    async (args, code) => {
      const { bridge, server, client } = await connection()
      try {
        const before = JSON.stringify(bridge.getNodes())
        const result = await client.callTool({ name: 'add_planting', arguments: args })
        expect(result.isError).toBe(true)
        expect(refusalCode(result.content)).toBe(code)
        expect(JSON.stringify(bridge.getNodes())).toBe(before)
      } finally {
        await client.close()
        await server.close()
      }
    },
  )
})
