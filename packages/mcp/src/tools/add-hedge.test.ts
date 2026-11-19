import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { SiteNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerSharedTools } from './shared-tools'

type HedgeFacts = { lengthM: number; triangles: number }

async function connection() {
  const site = SiteNode.parse({ id: 'site_hedges' })
  const bridge = new SceneBridge()
  bridge.setScene({ [site.id]: site }, [site.id])
  bridge.clearHistory()
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerSharedTools(server, bridge)
  const client = new Client({ name: 'hedge-client', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { bridge, server, client, site }
}

function refusalCode(content: unknown): string | undefined {
  return JSON.parse((content as { text?: string }[] | undefined)?.[0]?.text ?? '{}').code
}

describe('add_hedge over MCP', () => {
  test('is listed as a destructive write of the shared contracts', async () => {
    const { server, client } = await connection()
    try {
      const listed = (await client.listTools()).tools.find((tool) => tool.name === 'add_hedge')
      expect(listed).toBeDefined()
      expect(listed?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      })
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('plants a hedge under the Site and reports its length and triangles', async () => {
    const { bridge, server, client, site } = await connection()
    try {
      const result = await client.callTool({
        name: 'add_hedge',
        arguments: {
          points: [
            [0, 0],
            [6, 0],
          ],
          height: 1.5,
        },
      })
      expect(result.isError).toBeFalsy()
      const hedgeId = result.structuredContent?.hedgeId
      expect(typeof hedgeId).toBe('string')

      const hedges = Object.values(bridge.getNodes()).filter((node) => node.type === 'hedge')
      expect(hedges).toHaveLength(1)
      expect(hedges[0]).toMatchObject({
        id: hedgeId,
        type: 'hedge',
        parentId: site.id,
        path: [
          [0, 0],
          [6, 0],
        ],
        height: 1.5,
        gen: 2,
      })

      const facts = result.structuredContent?.facts as HedgeFacts
      expect(facts.lengthM).toBeCloseTo(6, 6)
      expect(facts.triangles).toBeGreaterThan(1000)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('refuses a side shorter than 10 cm before building anything', async () => {
    const { bridge, server, client } = await connection()
    try {
      const result = await client.callTool({
        name: 'add_hedge',
        arguments: {
          points: [
            [0, 0],
            [0.05, 0],
          ],
        },
      })
      expect(result.isError).toBe(true)
      expect(refusalCode(result.content)).toBe('hedge_side_too_short')
      expect(Object.values(bridge.getNodes()).some((node) => node.type === 'hedge')).toBe(false)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
