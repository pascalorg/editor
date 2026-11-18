import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { LawnNode, SiteNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

const outline: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
const stroke = { points: [[2, 2]], radiusM: 1, effect: 'bare', strength: 1 }

async function withLawn(use: (client: Client, bridge: SceneBridge) => Promise<void>) {
  const lawn = LawnNode.parse({ id: 'lawn_patch', parentId: 'site_garden', outline, density: 10 })
  const site = SiteNode.parse({ id: 'site_garden', children: [lawn.id] })
  const bridge = new SceneBridge()
  bridge.setScene({ [site.id]: site, [lawn.id]: lawn }, [site.id])
  bridge.clearHistory()
  const server = createPascalMcpServer({ bridge })
  const client = new Client({ name: 'lawn-patch', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    await use(client, bridge)
  } finally {
    await client.close()
    await server.close()
  }
}

async function patch(client: Client, patches: unknown[]) {
  const result = await client.callTool({ name: 'apply_patch', arguments: { patches } })
  const text = (result.content as { type: string; text?: string }[]).find(
    (part) => part.type === 'text',
  )?.text
  return { ...result, payload: JSON.parse(text ?? '{}') }
}

describe('lawn edits over real MCP', () => {
  test('the existing surface tool creates a lawn with brush facts, never a slab id', async () => {
    await withLawn(async (client, bridge) => {
      const result = await client.callTool({
        name: 'add_site_surface',
        arguments: {
          kind: 'lawn',
          siteId: 'site_garden',
          corners: [
            [5, 0],
            [9, 4],
          ],
          strokes: [{ ...stroke, points: [[7, 2]] }],
        },
      })
      expect(result.isError).toBeFalsy()
      const facts = result.structuredContent as Record<string, unknown>
      expect(facts).toMatchObject({
        kind: 'lawn',
        siteId: 'site_garden',
        requestedAreaM2: 16,
        retainedAreaM2: 16,
        achieved: { created: { lawn: 1 } },
      })
      expect(facts).not.toHaveProperty('slabId')
      expect(Object.values(bridge.getNodes()).find((node) => node.id === facts.lawnId)?.type).toBe(
        'lawn',
      )
      expect(facts.strokeAreas).toMatchObject({
        estimated: true,
        byEffect: { bare: expect.any(Number) },
      })
    })
  })

  test('brush edits report estimated touched area and form one undo step', async () => {
    await withLawn(async (client, bridge) => {
      const before = structuredClone(bridge.getNodes())
      const result = await patch(client, [
        { op: 'update', id: 'lawn_patch', data: { strokes: [stroke] } },
      ])
      expect(result.isError).toBeFalsy()
      expect(result.payload.lawnFacts).toHaveLength(1)
      expect(result.payload.lawnFacts[0]).toMatchObject({
        lawnId: 'lawn_patch',
        requestedAreaM2: 16,
        retainedAreaM2: 16,
        strokeAreas: { estimated: true },
      })
      expect(result.payload.lawnFacts[0].strokeAreas.byEffect.bare).toBeGreaterThan(0)
      expect(bridge.getNode('lawn_patch')).toMatchObject({ strokes: [stroke] })
      expect(bridge.undo()).toBe(1)
      expect(bridge.getNodes()).toEqual(before)
    })
  })

  test('a create with no id returns facts for the same lawn the bridge persists', async () => {
    await withLawn(async (client, bridge) => {
      const before = structuredClone(bridge.getNodes())
      const result = await patch(client, [
        {
          op: 'create',
          node: { type: 'lawn', outline, density: 10 },
          parentId: 'site_garden',
        },
      ])
      expect(result.isError).toBeFalsy()
      expect(result.payload.createdIds).toHaveLength(1)
      expect(result.payload.lawnFacts).toHaveLength(1)
      const [id] = result.payload.createdIds as string[]
      expect(result.payload.lawnFacts[0]).toMatchObject({
        lawnId: id,
        requestedAreaM2: 16,
        retainedAreaM2: 16,
      })
      expect(Object.values(bridge.getNodes()).find((node) => node.id === id)).toMatchObject({
        type: 'lawn',
        parentId: 'site_garden',
        outline,
      })
      expect(bridge.getNode('site_garden')).toMatchObject({ children: ['lawn_patch', id] })
      expect(bridge.undo()).toBe(1)
      expect(bridge.getNodes()).toEqual(before)
    })
  })

  test('a schema-valid edit leaving no retained area refuses the entire batch before writes', async () => {
    await withLawn(async (client, bridge) => {
      const before = structuredClone(bridge.getNodes())
      const result = await patch(client, [
        { op: 'update', id: 'site_garden', data: { name: 'Must not be written' } },
        {
          op: 'update',
          id: 'lawn_patch',
          data: { outline: outline.map(([x, z]) => [x + 100, z + 100]) },
        },
      ])
      expect(result.isError).toBe(true)
      expect(result.payload).toMatchObject({ code: 'lawn_empty', id: 'lawn_patch', patchIndex: 1 })
      expect(bridge.getNodes()).toEqual(before)
      expect(bridge.undo()).toBe(0)
    })
  })

  test('oversized stroke lists refuse atomically and never evict earlier strokes', async () => {
    await withLawn(async (client, bridge) => {
      const before = structuredClone(bridge.getNodes())
      const result = await patch(client, [
        {
          op: 'update',
          id: 'lawn_patch',
          data: { strokes: Array.from({ length: 65 }, () => stroke) },
        },
      ])
      expect(result.isError).toBe(true)
      expect(bridge.getNodes()).toEqual(before)
      expect(bridge.undo()).toBe(0)
    })
  })

  test('brush facts use the final batch ground, including a later lot edit', async () => {
    await withLawn(async (client) => {
      const result = await patch(client, [
        { op: 'update', id: 'lawn_patch', data: { strokes: [stroke] } },
        {
          op: 'update',
          id: 'site_garden',
          data: {
            polygon: {
              type: 'polygon',
              points: [
                [2, -15],
                [15, -15],
                [15, 15],
                [2, 15],
              ],
            },
          },
        },
      ])
      expect(result.isError).toBeFalsy()
      expect(result.payload.lawnFacts[0]).toMatchObject({
        lawnId: 'lawn_patch',
        requestedAreaM2: 16,
        retainedAreaM2: 8,
        coverageFraction: 0.5,
      })
    })
  })

  test('a lawn created and then brushed in one batch is preflighted in its new Site', async () => {
    await withLawn(async (client, bridge) => {
      const lawn = LawnNode.parse({ id: 'lawn_new', parentId: 'site_new', outline, density: 10 })
      const site = SiteNode.parse({ id: 'site_new' })
      const result = await patch(client, [
        { op: 'create', node: site },
        { op: 'create', node: lawn, parentId: site.id },
        { op: 'update', id: lawn.id, data: { strokes: [stroke] } },
      ])
      expect(result.isError).toBeFalsy()
      expect(result.payload.lawnFacts).toHaveLength(1)
      expect(result.payload.lawnFacts[0]).toMatchObject({ lawnId: lawn.id, retainedAreaM2: 16 })
      expect(bridge.getNode(lawn.id)?.type).toBe('lawn')
    })
  })
})
