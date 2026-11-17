import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import {
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
} from '@pascal-app/core'
import { AGENT_OPERATIONS } from '@pascal-app/core/agent-operations'
import {
  addTerrainBreakTool,
  carveTerrainPadTool,
  describeTerrainUnderHouseTool,
  readSiteTerrainTool,
  readTerrainContoursTool,
  sampleTerrainLineTool,
  setSiteLotTool,
  shapeSiteTerrainTool,
} from '@pascal-app/core/agent-tools'
import { SiteNode } from '@pascal-app/core/schema'
import { createPascalMcpServer, SceneBridge } from '@pascal-app/mcp'

async function connection() {
  const field = createTerrainField({ cols: 17, rows: 17, spacing: 0.5 })
  for (let row = 0; row < 17; row++)
    for (let col = 0; col < 17; col++) field.heights[row * 17 + col] = (col * 0.5 - 3) * 100
  const site = SiteNode.parse({
    id: 'site_terrain',
    polygon: {
      type: 'polygon',
      points: [
        [1, 1],
        [5, 1],
        [5, 5],
        [1, 5],
      ],
    },
    terrain: encodeTerrainField(field),
  })
  const bridge = new SceneBridge()
  bridge.setScene({ [site.id]: site }, [site.id])
  bridge.clearHistory()
  const server = createPascalMcpServer({ bridge })
  const client = new Client({ name: 'terrain-client', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { bridge, server, client }
}

describe('terrain tools over MCP', () => {
  test('set_site_lot exposes continuation without rewriting ground and has one-step undo', async () => {
    const { bridge, server, client } = await connection()
    try {
      const before = structuredClone(bridge.getNodes())
      const result = await client.callTool({
        name: 'set_site_lot',
        arguments: { widthM: 60, depthM: 80 },
      })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({ siteId: 'site_terrain', areaM2: 4800 })
      const after = bridge.getNodes().site_terrain as SiteNode
      expect(after.terrain).toEqual((before.site_terrain as SiteNode).terrain)
      expect(after.polygon.points).toEqual([
        [-27, -37],
        [33, -37],
        [33, 43],
        [-27, 43],
      ])
      const profile = await client.callTool({
        name: 'sample_terrain_line',
        arguments: { from: [8, 2], to: [9, 2], stepM: 1 },
      })
      expect(profile.isError).toBeFalsy()
      const points = (profile.structuredContent as { points: { yM: number }[] }).points
      expect(points[0]?.yM).toBe(5)
      expect(points[1]?.yM).toBeGreaterThan(5)
      expect(bridge.undo()).toBe(1)
      expect(bridge.getNodes()).toEqual(before)
      expect(bridge.undo()).toBe(0)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('registers the shared contracts with closed-world read-only annotations', async () => {
    const { server, client } = await connection()
    try {
      const tools = (await client.listTools()).tools
      for (const contract of [
        readSiteTerrainTool,
        sampleTerrainLineTool,
        readTerrainContoursTool,
      ]) {
        const tool = tools.find((entry) => entry.name === contract.name)
        expect(tool?.description).toBe(contract.description)
        expect(tool?.annotations).toEqual({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        })
      }
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('executes all three operations without mutations, persistence or undo entries', async () => {
    const { bridge, server, client } = await connection()
    try {
      const before = structuredClone(bridge.getNodes())
      const requests = [
        { name: 'read_site_terrain', arguments: { cellM: 1 } },
        { name: 'sample_terrain_line', arguments: { from: [1, 2], to: [5, 2], stepM: 2 } },
        { name: 'read_terrain_contours', arguments: { intervalM: 1 } },
      ]
      for (const request of requests) {
        const result = await client.callTool(request)
        expect(result.isError).toBeFalsy()
        const operation = AGENT_OPERATIONS[request.name as keyof typeof AGENT_OPERATIONS]
        const expected = operation(before, request.arguments as never, {
          activeLevelId: null,
        }).result
        expect(result.structuredContent).toEqual(expected)
        expect(bridge.getNodes()).toEqual(before)
      }
      expect(bridge.undo()).toBe(0)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('returns coded refusals for invalid and excessive inputs', async () => {
    const { bridge, server, client } = await connection()
    try {
      const before = structuredClone(bridge.getNodes())
      const requests = [
        { name: 'read_site_terrain', arguments: { footprint: [] }, code: 'footprint_empty' },
        { name: 'read_site_terrain', arguments: { cellM: 0 }, code: 'invalid_input' },
        {
          name: 'sample_terrain_line',
          arguments: { from: [1, 2], to: [5, 2], stepM: 0.00001 },
          code: 'sampling_limit',
        },
        { name: 'read_terrain_contours', arguments: { intervalM: 0.001 }, code: 'contour_limit' },
      ]
      for (const { code, ...request } of requests) {
        const result = await client.callTool(request)
        expect(result.isError).toBe(true)
        const text = result.content as { type: string; text?: string }[]
        expect(JSON.parse(text[0]?.text ?? '{}').code).toBe(code)
        expect(bridge.getNodes()).toEqual(before)
      }
    } finally {
      await client.close()
      await server.close()
    }
  })
  test('registers the shaping writes as destructive and the house facts as read-only', async () => {
    const { server, client } = await connection()
    try {
      const tools = (await client.listTools()).tools
      for (const contract of [
        setSiteLotTool,
        shapeSiteTerrainTool,
        carveTerrainPadTool,
        addTerrainBreakTool,
      ]) {
        const tool = tools.find((entry) => entry.name === contract.name)
        expect(tool?.description).toBe(contract.description)
        expect(tool?.annotations).toEqual({
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        })
      }
      const describe = tools.find((entry) => entry.name === describeTerrainUnderHouseTool.name)
      expect(describe?.description).toBe(describeTerrainUnderHouseTool.description)
      expect(describe?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      })
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('carves a pad through the bridge in one undo step, and refuses outside the property', async () => {
    const { bridge, server, client } = await connection()
    try {
      const before = structuredClone(bridge.getNodes())
      const pad = [
        [2, 2],
        [4, 2],
        [4, 4],
        [2, 4],
      ]
      const result = await client.callTool({
        name: 'carve_terrain_pad',
        arguments: { pad, padHeightM: 0, blendM: 1 },
      })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({ padHeightM: 0, padAreaM2: 4 })
      expect(bridge.getNodes()).not.toEqual(before)
      expect((bridge.getNodes().site_terrain as SiteNode).terrain).toEqual(
        (before.site_terrain as SiteNode).terrain,
      )
      expect(Object.values(bridge.getNodes()).some((node) => node.type === 'terrain-tile')).toBe(
        true,
      )
      expect(bridge.undo()).toBe(1)
      expect(bridge.getNodes()).toEqual(before)

      const refused = await client.callTool({
        name: 'shape_site_terrain',
        arguments: { verb: 'raise', area: { x: 4.5, z: 3, radiusM: 1 }, heightM: 1 },
      })
      expect(refused.isError).toBe(true)
      const text = refused.content as { type: string; text?: string }[]
      expect(JSON.parse(text[0]?.text ?? '{}').code).toBe('outside_property')
      expect(bridge.getNodes()).toEqual(before)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('creates an exact cliff, returns break facts through reads and measure, and undoes once', async () => {
    const { bridge, server, client } = await connection()
    try {
      const before = structuredClone(bridge.getNodes())
      const result = await client.callTool({
        name: 'add_terrain_break',
        arguments: {
          line: [
            [3, 1],
            [3, 5],
          ],
          kind: 'cliff',
          left: 2.125,
          right: -4.875,
        },
      })
      expect(result.isError).toBeFalsy()
      const facts = result.structuredContent as { breakId: string }
      expect(facts).toMatchObject({
        lengthM: 4,
        left: { minM: 2.125, maxM: 2.125 },
        right: { minM: -4.875, maxM: -4.875 },
        dropMinM: 7,
        dropMaxM: 7,
        faceAreaM2: 28,
      })
      const nodes = bridge.getNodes()
      const field = persistedTerrainFieldOf(nodes.site_terrain as SiteNode, nodes)
      if (!field) throw new Error('Cliff authority missing')
      expect(heightAt(field, 3 - 1e-7, 3)).toBe(2.125)
      expect(heightAt(field, 3 + 1e-7, 3)).toBe(-4.875)
      expect((nodes.site_terrain as SiteNode).terrain).toEqual(
        (before.site_terrain as SiteNode).terrain,
      )
      const read = await client.callTool({ name: 'read_site_terrain', arguments: {} })
      expect(read.structuredContent).toMatchObject({
        breaks: [{ breakId: facts.breakId, faceAreaM2: 28 }],
      })
      const measured = await client.callTool({
        name: 'measure',
        arguments: { fromId: facts.breakId, toId: facts.breakId },
      })
      expect(measured.structuredContent).toMatchObject({
        terrainBreak: { breakId: facts.breakId, lengthM: 4 },
      })
      const nodeRead = await client.callTool({ name: 'get_node', arguments: { id: facts.breakId } })
      expect(nodeRead.structuredContent).toMatchObject({ terrainBreak: { faceAreaM2: 28 } })
      expect(bridge.undo()).toBe(1)
      expect(bridge.getNodes()).toEqual(before)
      expect(bridge.undo()).toBe(0)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
