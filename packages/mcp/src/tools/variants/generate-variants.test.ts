import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { type AnyNodeId, AnyNode as AnyNodeSchema } from '@pascal-app/core/schema'
import { SceneBridge } from '../../bridge/scene-bridge'
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

function emptyBase(): SceneGraph {
  return {
    nodes: {
      site_empty: {
        object: 'node',
        id: 'site_empty',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
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
      },
    } as unknown as SceneGraph['nodes'],
    rootNodeIds: ['site_empty'] as AnyNodeId[],
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
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerGenerateVariants(server, bridge, store)
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
    const withWalls: SceneGraph = {
      nodes: {
        ...base.nodes,
        wall_1: {
          object: 'node',
          id: 'wall_1',
          type: 'wall',
          parentId: level?.id ?? null,
          visible: true,
          metadata: {},
          start: [0, 0],
          end: [5, 0],
          thickness: 0.1,
          height: 2.5,
          children: [],
          frontSide: 'unknown',
          backSide: 'unknown',
        },
        wall_2: {
          object: 'node',
          id: 'wall_2',
          type: 'wall',
          parentId: level?.id ?? null,
          visible: true,
          metadata: {},
          start: [0, 5],
          end: [5, 5],
          thickness: 0.1,
          height: 2.5,
          children: [],
          frontSide: 'unknown',
          backSide: 'unknown',
        },
      } as unknown as SceneGraph['nodes'],
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
    const parsed = parseToolText(result.content as StoredTextContent[]) as unknown as {
      variants: Variant[]
    }
    expect(parsed.variants.length).toBe(3)
    for (const v of parsed.variants) {
      expect(v.graph).toBeDefined()
      // Every wall's thickness is in the allowed set.
      const allowed = new Set([0.1, 0.15, 0.2, 0.25])
      for (const node of Object.values((v.graph as SceneGraph).nodes)) {
        if (node.type !== 'wall') continue
        expect(allowed.has((node as { thickness: number }).thickness)).toBe(true)
      }
    }
  })

  test('deterministic: same seed yields same mutation outputs', async () => {
    // Seed walls so the mutation has something to act on.
    const base = bridge.exportJSON()
    const level = Object.values(base.nodes).find((n) => n.type === 'level')
    const withWalls: SceneGraph = {
      nodes: {
        ...base.nodes,
        wall_a: {
          object: 'node',
          id: 'wall_a',
          type: 'wall',
          parentId: level?.id ?? null,
          visible: true,
          metadata: {},
          start: [0, 0],
          end: [4, 0],
          thickness: 0.1,
          height: 2.5,
          children: [],
          frontSide: 'unknown',
          backSide: 'unknown',
        },
        wall_b: {
          object: 'node',
          id: 'wall_b',
          type: 'wall',
          parentId: level?.id ?? null,
          visible: true,
          metadata: {},
          start: [0, 4],
          end: [4, 4],
          thickness: 0.1,
          height: 2.5,
          children: [],
          frontSide: 'unknown',
          backSide: 'unknown',
        },
      } as unknown as SceneGraph['nodes'],
      rootNodeIds: base.rootNodeIds,
    }
    bridge.setScene(withWalls.nodes, withWalls.rootNodeIds)

    const args = { count: 2, vary: ['wall-thickness'], seed: 123 }
    const r1 = await client.callTool({ name: 'generate_variants', arguments: args })
    const r2 = await client.callTool({ name: 'generate_variants', arguments: args })
    const p1 = parseToolText(r1.content as StoredTextContent[]) as unknown as {
      variants: Variant[]
    }
    const p2 = parseToolText(r2.content as StoredTextContent[]) as unknown as {
      variants: Variant[]
    }
    expect(p1.variants.length).toBe(p2.variants.length)
    // Compare the mutated fields (not the ids, which fresh-nanoid each time).
    function wallThicknesses(g: SceneGraph): number[] {
      return Object.values(g.nodes)
        .filter((n) => n.type === 'wall')
        .map((w) => (w as { thickness: number }).thickness)
        .sort()
    }
    for (let i = 0; i < p1.variants.length; i++) {
      const t1 = wallThicknesses(p1.variants[i]?.graph as SceneGraph)
      const t2 = wallThicknesses(p2.variants[i]?.graph as SceneGraph)
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
    const parsed = parseToolText(result.content as StoredTextContent[]) as unknown as {
      variants: Variant[]
    }
    expect(parsed.variants.length).toBe(3)
    for (const v of parsed.variants) {
      const g = v.graph as SceneGraph
      expect(g).toBeDefined()
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
    const parsed = parseToolText(result.content as StoredTextContent[]) as unknown as {
      variants: Variant[]
    }
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
    const parsed = parseToolText(result.content as StoredTextContent[]) as unknown as {
      variants: Variant[]
    }
    for (const v of parsed.variants) {
      const g = v.graph as SceneGraph
      for (const node of Object.values(g.nodes)) {
        const res = AnyNodeSchema.safeParse(node)
        expect(res.success).toBe(true)
      }
    }
  })
})
