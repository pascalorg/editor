import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import {
  type AnyNode,
  BuildingNode,
  type CompiledGeometryScript,
  GeometryArtifactManifest,
  ItemNode,
  LevelNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'
import type { GeometryScriptHost } from './add-object'

// run_batch builds several objects in one call; the host compiles each module, and one that does
// not run is reported on its own while the others are placed.
type Result = { isError?: boolean; content: Array<{ type: string; text: string }> }

/** What the host's compile reports for a plain box of this size. */
function compiledBox([width, height, depth]: [number, number, number]): CompiledGeometryScript {
  return {
    sha256: 'a'.repeat(64),
    script: 'b'.repeat(64),
    language: 'three',
    mount: 'floor',
    params: {},
    manifest: GeometryArtifactManifest.parse({
      bounds: { min: [-width / 2, 0, -depth / 2], max: [width / 2, height, depth / 2] },
      triangles: 12,
    }),
  }
}

/** One floor holding a screen built earlier. */
function floorWithScreen() {
  const screen = ItemNode.parse({
    id: 'item_screen',
    parentId: 'level_0',
    name: 'Garden screen',
    asset: {
      id: 'screen',
      category: 'screen',
      name: 'Garden screen',
      thumbnail: '',
      src: '/items/screen/model.glb',
      dimensions: [1.2, 1.8, 0.2],
    },
  })
  const level = LevelNode.parse({
    id: 'level_0',
    parentId: 'building_main',
    level: 0,
    height: 3,
    children: [screen.id],
  })
  const building = BuildingNode.parse({ id: 'building_main', children: [level.id] })
  return {
    nodes: Object.fromEntries([building, level, screen].map((node) => [node.id, node])),
    rootNodeIds: [building.id],
  }
}

const object = (name: string, code = 'export default () => null') => ({
  tool: 'add_object',
  input: { code, name, category: 'table', reason: `${name}: nothing in the catalog` },
})

describe('add_object in run_batch over MCP', () => {
  let directory: string
  let bridge: SceneBridge
  let client: Client
  let compiles: string[]

  const host: GeometryScriptHost = {
    compile: async ({ code }) => {
      compiles.push(code)
      if (code.includes('broken')) throw new Error('ReferenceError: Foo is not defined')
      return { ...compiledBox([0.8, 0.7, 0.8]), glb: new Uint8Array() }
    },
    storeArtifact: async ({ sha256 }) => sha256,
    readArtifact: async () => null,
  }

  async function connect(geometryScripts?: GeometryScriptHost) {
    const server = createPascalMcpServer({
      bridge,
      store: new SqliteSceneStore({ databasePath: join(directory, 'pascal.db') }),
      ...(geometryScripts ? { geometryScripts } : {}),
    })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pascal-mcp-batch-objects-'))
    bridge = new SceneBridge()
    compiles = []
    const { nodes, rootNodeIds } = floorWithScreen()
    bridge.setScene(nodes as never, rootNodeIds as never)
    bridge.setActiveScene({ id: 'scene_batch', name: 'Batch' } as never)
    bridge.agentSession.keep({
      designBrief: {
        fixed: ['the test’s pieces'],
        open: [],
        source: 'catalog',
        vision: 'The catalog as it is.',
        beyond: 'none: the test places what the request names.',
      },
    })
  })

  afterEach(async () => {
    await client.close()
    rmSync(directory, { recursive: true, force: true })
  })

  const itemsNamed = (...names: string[]) =>
    Object.values(bridge.getNodes() as Record<string, AnyNode>).filter(
      (node) => node.type === 'item' && names.includes(node.name ?? ''),
    )

  test('three objects, one failing: two are placed, the third reports its own error', async () => {
    await connect(host)
    const result = (await client.callTool({
      name: 'run_batch',
      arguments: {
        calls: [
          object('Low oak table'),
          object('Slatted bench', 'broken()'),
          object('Paper lantern'),
        ],
      },
    })) as Result
    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content[0]!.text) as {
      applied: number
      refused: number
      calls: { status: string; code?: string; error?: string; result?: { nodeId: string } }[]
    }
    expect(payload).toMatchObject({ status: 'applied', applied: 2, refused: 1 })
    expect(payload.calls.map((call) => call.status)).toEqual(['ok', 'refused', 'ok'])
    expect(payload.calls[1]).toMatchObject({ code: 'script_failed' })
    expect(payload.calls[1]!.error).toContain('Foo is not defined')
    expect(compiles).toHaveLength(3)
    expect(itemsNamed('Low oak table', 'Paper lantern')).toHaveLength(2)
    expect(itemsNamed('Slatted bench')).toHaveLength(0)
    // One id each, and the same receipt a lone add_object gives.
    expect(
      new Set(payload.calls.filter((call) => call.result).map((c) => c.result!.nodeId)).size,
    ).toBe(2)
    expect(payload.calls[0]!.result).toHaveProperty('achieved')
  })

  test('a server that cannot run scripts reports each object, and the batch’s other calls stand', async () => {
    await connect()
    const result = (await client.callTool({
      name: 'run_batch',
      arguments: {
        calls: [object('Low oak table'), { tool: 'delete_node', input: { id: 'item_screen' } }],
      },
    })) as Result
    const payload = JSON.parse(result.content[0]!.text) as { calls: { code?: string }[] }
    expect(payload.calls[0]).toMatchObject({ code: 'scripts_unavailable' })
    expect(bridge.getNode('item_screen' as never)).toBeNull()
    expect(itemsNamed('Low oak table')).toHaveLength(0)
  })

  test('the lone add_object and the batch share the compile: the same module gives the same object', async () => {
    await connect(host)
    await client.callTool({ name: 'add_object', arguments: object('Lone table').input })
    await client.callTool({ name: 'run_batch', arguments: { calls: [object('Batched table')] } })
    const [lone] = itemsNamed('Lone table')
    const [batched] = itemsNamed('Batched table')
    expect(
      batched?.type === 'item' && lone?.type === 'item' ? batched.asset.dimensions : 1,
    ).toEqual(lone?.type === 'item' ? lone.asset.dimensions : 2)
    expect(batched?.type === 'item' ? batched.metadata : null).toMatchObject({
      reason: 'Batched table: nothing in the catalog',
    })
  })
})
