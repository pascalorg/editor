import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { AnyNode as AnyNodeSchema, SiteNode, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../../bridge/scene-bridge'
import { createSceneOperations } from '../../operations'
import {
  InMemorySceneStore,
  parseToolText,
  type StoredTextContent,
} from '../scene-lifecycle/test-utils'
import { registerGenerateVariants } from './generate-variants'

type Variant = {
  index: number
  description: string
  nodeCount: number
  sceneId?: string
  url?: string
  graph?: SceneGraph
}

/**
 * Narrows the untyped `parseToolText` payload to the `{ variants: Variant[] }`
 * shape the tool guarantees, verifying at runtime that `variants` is an array.
 */
function parseVariantsResult(content: StoredTextContent[]): { variants: Variant[] } {
  const parsed = parseToolText(content)
  const variants = parsed.variants
  expect(Array.isArray(variants)).toBe(true)
  return { variants: variants as Variant[] }
}

/** Asserts the variant carries an inline graph and returns it typed. */
function expectGraph(variant: Variant | undefined): SceneGraph {
  expect(variant).toBeDefined()
  if (variant === undefined) throw new Error('variant is undefined')
  const graph = variant.graph
  expect(graph).toBeDefined()
  if (graph === undefined) throw new Error('variant.graph is undefined')
  return graph
}

function emptyBase(): SceneGraph {
  const site = SiteNode.parse({
    id: 'site_empty',
    parentId: null,
    polygon: {
      type: 'polygon',
      points: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
    },
    children: [],
  })
  return {
    nodes: { [site.id]: site },
    rootNodeIds: [site.id],
  }
}

async function setup(): Promise<{
  client: Client
  bridge: SceneBridge
  store: InMemorySceneStore
}> {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const store = new InMemorySceneStore()
  const operations = createSceneOperations({ bridge, store })
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerGenerateVariants(server, operations)
  const [srvT, cliT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(srvT), client.connect(cliT)])
  return { client, bridge, store }
}

describe('generate_variants', () => {
  let client: Client
  let bridge: SceneBridge
  let store: InMemorySceneStore

  beforeEach(async () => {
    ;({ client, bridge, store } = await setup())
  })

  test('happy path: returns count variants that exercise the mutation', async () => {
    // Seed the bridge scene with some walls of known thickness.
    const base = bridge.exportJSON()
    // Find the level and add a couple of walls.
    const level = Object.values(base.nodes).find((n) => n.type === 'level')
    expect(level).toBeDefined()
    const wall1 = WallNode.parse({
      id: 'wall_1',
      parentId: level?.id ?? null,
      start: [0, 0],
      end: [5, 0],
      thickness: 0.1,
      height: 2.5,
      children: [],
    })
    const wall2 = WallNode.parse({
      id: 'wall_2',
      parentId: level?.id ?? null,
      start: [0, 5],
      end: [5, 5],
      thickness: 0.1,
      height: 2.5,
      children: [],
    })
    const withWalls: SceneGraph = {
      nodes: {
        ...base.nodes,
        [wall1.id]: wall1,
        [wall2.id]: wall2,
      },
      rootNodeIds: base.rootNodeIds,
    }
    bridge.setScene(withWalls.nodes, withWalls.rootNodeIds)

    const result = await client.callTool({
      name: 'generate_variants',
      arguments: {
        count: 3,
        vary: ['wall-thickness'],
        seed: 42,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseVariantsResult(result.content as StoredTextContent[])
    expect(parsed.variants.length).toBe(3)
    for (const v of parsed.variants) {
      const graph = expectGraph(v)
      // Every wall's thickness is in the allowed set.
      const allowed = new Set([0.1, 0.15, 0.2, 0.25])
      for (const node of Object.values(graph.nodes)) {
        if (node.type !== 'wall') continue
        expect(allowed.has((node as { thickness: number }).thickness)).toBe(true)
      }
    }
  })

  test('deterministic: same seed yields same mutation outputs', async () => {
    // Seed walls so the mutation has something to act on.
    const base = bridge.exportJSON()
    const level = Object.values(base.nodes).find((n) => n.type === 'level')
    const wallA = WallNode.parse({
      id: 'wall_a',
      parentId: level?.id ?? null,
      start: [0, 0],
      end: [4, 0],
      thickness: 0.1,
      height: 2.5,
      children: [],
    })
    const wallB = WallNode.parse({
      id: 'wall_b',
      parentId: level?.id ?? null,
      start: [0, 4],
      end: [4, 4],
      thickness: 0.1,
      height: 2.5,
      children: [],
    })
    const withWalls: SceneGraph = {
      nodes: {
        ...base.nodes,
        [wallA.id]: wallA,
        [wallB.id]: wallB,
      },
      rootNodeIds: base.rootNodeIds,
    }
    bridge.setScene(withWalls.nodes, withWalls.rootNodeIds)

    const args = { count: 2, vary: ['wall-thickness'], seed: 123 }
    const r1 = await client.callTool({ name: 'generate_variants', arguments: args })
    const r2 = await client.callTool({ name: 'generate_variants', arguments: args })
    const p1 = parseVariantsResult(r1.content as StoredTextContent[])
    const p2 = parseVariantsResult(r2.content as StoredTextContent[])
    expect(p1.variants.length).toBe(p2.variants.length)
    // Compare the mutated fields (not the ids, which fresh-nanoid each time).
    function wallThicknesses(g: SceneGraph): number[] {
      return Object.values(g.nodes)
        .filter((n) => n.type === 'wall')
        .map((w) => (w as { thickness: number }).thickness)
        .sort()
    }
    for (let i = 0; i < p1.variants.length; i++) {
      const t1 = wallThicknesses(expectGraph(p1.variants[i]))
      const t2 = wallThicknesses(expectGraph(p2.variants[i]))
      expect(t1).toEqual(t2)
    }
  })

  test('no-op: empty scene + wall-thickness still returns count graphs, unchanged', async () => {
    const graph = emptyBase()
    // Save, then reference by id.
    const meta = await store.save({ name: 'empty', graph })
    const result = await client.callTool({
      name: 'generate_variants',
      arguments: {
        baseSceneId: meta.id,
        count: 3,
        vary: ['wall-thickness'],
        seed: 99,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseVariantsResult(result.content as StoredTextContent[])
    expect(parsed.variants.length).toBe(3)
    for (const v of parsed.variants) {
      const g = expectGraph(v)
      // No walls were present — so node counts should match the (forked) base.
      expect(Object.keys(g.nodes).length).toBe(Object.keys(graph.nodes).length)
    }
  })

  test('save=true: each variant gets a sceneId and url', async () => {
    const result = await client.callTool({
      name: 'generate_variants',
      arguments: {
        count: 2,
        vary: ['wall-thickness'],
        seed: 55,
        save: true,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseVariantsResult(result.content as StoredTextContent[])
    expect(parsed.variants.length).toBe(2)
    for (const v of parsed.variants) {
      expect(typeof v.sceneId).toBe('string')
      expect(v.url).toBe(`/scene/${v.sceneId}`)
      // Inline graph should be omitted.
      expect(v.graph).toBeUndefined()
    }
    const listed = await store.list()
    expect(listed.length).toBe(2)
  })

  test('baseSceneId not found returns an error', async () => {
    const result = await client.callTool({
      name: 'generate_variants',
      arguments: {
        baseSceneId: 'scene_does_not_exist',
        count: 2,
        vary: ['wall-thickness'],
        seed: 1,
      },
    })
    expect(result.isError).toBe(true)
  })

  test('every returned variant validates against AnyNode', async () => {
    const result = await client.callTool({
      name: 'generate_variants',
      arguments: {
        count: 3,
        vary: ['wall-thickness', 'wall-height'],
        seed: 7,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseVariantsResult(result.content as StoredTextContent[])
    for (const v of parsed.variants) {
      const g = expectGraph(v)
      for (const node of Object.values(g.nodes)) {
        const res = AnyNodeSchema.safeParse(node)
        expect(res.success).toBe(true)
      }
    }
  })
})
