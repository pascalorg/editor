import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { type SceneCommit, subscribeSceneCommits } from '@pascal-app/core'
import {
  applyPatchWithDependencies,
  captureRegistryVersions,
  effectIds,
  openDetachedScene,
  SceneEnvironmentDisposedError,
  type SceneSnapshot,
} from '@pascal-app/core/runtime'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  GeometryArtifactManifest,
  ItemNode,
  LevelNode,
  RoofNode,
  WallNode,
} from '@pascal-app/core/schema'
import { createSceneOperations, type SceneOperations } from '../operations'
import { createPascalMcpServer } from '../server'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'
import type { GeometryScriptHost } from '../tools/add-object'
import { registerSharedTools } from '../tools/shared-tools'
import { SceneBridge } from './scene-bridge'

function snapshot(): SceneSnapshot {
  const level = LevelNode.parse({ id: 'level_g', parentId: 'building_b', level: 0, height: 2.8 })
  const building = BuildingNode.parse({ id: 'building_b', children: [level.id] })
  return {
    nodes: Object.fromEntries([building, level].map((node) => [node.id, node])) as Record<
      AnyNode['id'],
      AnyNode
    >,
    rootNodeIds: [building.id],
    collections: {},
    materials: {},
    installedPlugins: [],
  } as SceneSnapshot
}

function detached(effectId: string, from: SceneSnapshot = snapshot()) {
  return openDetachedScene(from, {
    base: { kind: 'authority', seq: 1 },
    context: {
      activeLevelId: 'level_g',
      selection: [],
      units: 'metric',
      catalogVersion: 'test',
      registryVersions: captureRegistryVersions(),
    },
    ids: effectIds(effectId),
  })
}

async function connect(server: ReturnType<typeof createPascalMcpServer>) {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

async function addWallDetached(effectId: string) {
  const scene = openDetachedScene(snapshot(), {
    base: { kind: 'authority', seq: 1 },
    context: {
      activeLevelId: 'level_g',
      selection: [],
      units: 'metric',
      catalogVersion: 'test',
      registryVersions: captureRegistryVersions(),
    },
    ids: effectIds(effectId),
  })
  const bridge = new SceneBridge({ runtime: scene })
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerSharedTools(server, bridge)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const result = await client.callTool({
    name: 'add_wall',
    arguments: { levelId: 'level_g', start: [0, 0], end: [4, 0] },
  })
  return { scene, bridge, result }
}

describe('SceneBridge over a detached scene', () => {
  test('a shared tool computes on the detached scene, with its ids and reads, and leaves the editor alone', async () => {
    const editor = new SceneBridge()
    const editorBefore = editor.exportJSON()
    const { scene, bridge, result } = await addWallDetached('effect_wall')
    expect(result.isError).toBeFalsy()

    const patch = scene.patch()
    const walls = patch.nodeCreates.filter(({ node }) => node.type === 'wall')
    expect(walls).toHaveLength(1)
    expect(bridge.getNode(walls[0]!.node.id)).not.toBeNull()
    expect(editor.exportJSON()).toEqual(editorBefore)
    // The default name counts the walls: that selection is a dependency.
    expect(scene.dependencies()).toContainEqual(
      expect.objectContaining({ kind: 'query', entity: 'node', predicate: { type: 'wall' } }),
    )

    // The same effect recomputed mints the same ids.
    const again = await addWallDetached('effect_wall')
    expect(again.scene.patch()).toEqual(patch)

    scene.dispose()
    expect(() => bridge.getNodes()).toThrow(SceneEnvironmentDisposedError)
    expect(() => bridge.updateNode(walls[0]!.node.id, { name: 'Late' })).toThrow(
      SceneEnvironmentDisposedError,
    )
    again.scene.dispose()
  })
})

describe('every MCP tool on a detached scene', () => {
  const compiledBox = {
    sha256: 'a'.repeat(64),
    script: 'b'.repeat(64),
    mount: 'floor' as const,
    params: {},
    manifest: GeometryArtifactManifest.parse({
      bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
      triangles: 12,
    }),
  }
  const host: GeometryScriptHost = {
    compile: async () => ({ ...compiledBox, glb: new Uint8Array() }) as never,
    storeArtifact: async ({ sha256 }) => sha256,
    readArtifact: async () => null,
  }

  async function build(effectId: string) {
    const base = snapshot()
    const wall = WallNode.parse({
      id: 'wall_g',
      parentId: 'level_g',
      start: [0, 0],
      end: [6, 0],
      height: 2.8,
    })
    const level = base.nodes['level_g' as AnyNodeId] as LevelNode
    const scene = detached(effectId, {
      ...base,
      nodes: { ...base.nodes, [wall.id]: wall, [level.id]: { ...level, children: [wall.id] } },
    } as SceneSnapshot)
    const bridge = new SceneBridge({ runtime: scene })
    bridge.setActiveScene({ id: 'scene_detached', name: 'Detached' } as never)
    bridge.agentSession.keep({
      designBrief: {
        fixed: ['the test’s pieces'],
        open: [],
        source: 'catalog',
        vision: 'The catalog as it is.',
        beyond: 'none: the test places what the request names.',
      },
    })
    const client = await connect(createPascalMcpServer({ bridge, geometryScripts: host }))
    const calls = [
      ['create_unit', { buildingId: 'building_b', name: 'Flat' }],
      ['create_roof', { levelId: 'level_g', width: 6, depth: 4 }],
      ['add_column', { levelId: 'level_g', x: 1, z: 1 }],
      // These await their (absent) compile before planning.
      ['add_door', { wallId: 'wall_g', t: 0.25 }],
      ['add_window', { wallId: 'wall_g', t: 0.7 }],
      [
        'add_object',
        {
          code: 'export default function build() {}',
          levelId: 'level_g',
          name: 'Planter',
          reason: 'No planter type.',
          x: 2,
          z: 2,
        },
      ],
    ] as const
    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).toBeFalsy()
    }
    const patch = scene.patch()
    scene.dispose()
    return patch
  }

  test('mint the scene ids: the same effect recomputed gives the same patch', async () => {
    const first = await build('effect_tools')
    expect(first.nodeCreates.map(({ node }) => node.type)).toEqual(
      expect.arrayContaining(['unit', 'roof', 'column', 'item', 'door', 'window']),
    )
    expect(await build('effect_tools')).toEqual(first)
  })
})

describe('SceneBridge commits', () => {
  test('an edit and the roof it moves land in one commit and one undo step', () => {
    const bridge = new SceneBridge()
    const level = LevelNode.parse({ id: 'level_w', parentId: 'building_w', level: 0, height: 3 })
    const upper = LevelNode.parse({ id: 'level_u', parentId: 'building_w', level: 1, height: 3 })
    const corners: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const walls = corners.map((start, index) =>
      WallNode.parse({
        id: `wall_${index}`,
        parentId: level.id,
        start,
        end: corners[(index + 1) % 4]!,
        height: 3,
      }),
    )
    const roof = RoofNode.parse({
      id: 'roof_w',
      parentId: upper.id,
      support: { kind: 'walls' },
      position: [2, 0, 1.5],
    })
    level.children = walls.map((wall) => wall.id)
    upper.children = [roof.id]
    const building = BuildingNode.parse({ id: 'building_w', children: [level.id, upper.id] })
    bridge.setScene(
      Object.fromEntries(
        [building, level, upper, ...walls, roof].map((node) => [node.id, node]),
      ) as never,
      [building.id] as never,
    )
    bridge.clearHistory()
    const roofY = () => (bridge.getNode('roof_w' as AnyNodeId) as RoofNode).position[1]
    const settledY = roofY()
    const commits: SceneCommit[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit))
    try {
      bridge.updateNode('wall_0' as AnyNodeId, { height: 4.2 } as never)
    } finally {
      stop()
    }
    expect(roofY()).toBeGreaterThan(settledY)
    expect(commits).toHaveLength(1)
    expect((commits[0]!.current.nodes['roof_w' as AnyNodeId] as RoofNode).position[1]).toBe(roofY())
    expect(commits[0]!.changedNodeIds).toContain('roof_w' as AnyNodeId)
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(roofY()).toBe(settledY)
  })
})

describe('SceneOperations without runInScene', () => {
  test('a custom implementation serves the shared tools, its ids unscoped', async () => {
    const operations = createSceneOperations({ bridge: new SceneBridge() })
    // A host's own implementation predating the scene scope.
    const custom = new Proxy(operations, {
      get: (target, key) => {
        if (key === 'runInScene') return undefined
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as SceneOperations
    const bridge = new SceneBridge()
    bridge.setScene(snapshot().nodes as never, snapshot().rootNodeIds as never)
    const client = await connect(createPascalMcpServer({ bridge, operations: custom }))
    const result = await client.callTool({
      name: 'add_wall',
      arguments: { levelId: 'level_g', start: [0, 0], end: [3, 0] },
    })
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy()
  })
})

describe('SceneBridge writes on a detached scene', () => {
  test("copy what they are given: the caller's objects stay theirs", () => {
    const scene = detached('effect_copy')
    const bridge = new SceneBridge({ runtime: scene })
    const metadata = { note: { tags: ['one'] } }
    bridge.updateNode('level_g' as AnyNodeId, { metadata } as never)
    metadata.note.tags.push('two')
    expect(bridge.getNode('level_g' as AnyNodeId)?.metadata).toEqual({ note: { tags: ['one'] } })

    const collections = {
      collection_a: { id: 'collection_a', name: 'A', nodeIds: ['level_g'] },
    } as never as Record<string, { nodeIds: string[] }>
    bridge.setCollections(collections as never)
    collections.collection_a!.nodeIds.push('building_b')
    expect(bridge.getCollections()['collection_a' as never]).toMatchObject({ nodeIds: ['level_g'] })

    const replacement = snapshot()
    const level = replacement.nodes['level_g' as AnyNodeId] as AnyNode & {
      metadata: Record<string, unknown>
    }
    level.metadata = { tags: ['one'] }
    bridge.setScene(replacement.nodes, replacement.rootNodeIds)
    ;(level.metadata.tags as string[]).push('two')
    expect(bridge.getNode('level_g' as AnyNodeId)?.metadata).toEqual({ tags: ['one'] })
    scene.dispose()
  })
  /** A rename of one chair, written by `write`; what it recorded, checked against edits meanwhile. */
  async function readsOf(write: (bridge: SceneBridge) => Promise<void> | void) {
    const base = snapshot()
    const upper = LevelNode.parse({ id: 'level_u', parentId: 'building_b', level: 1, height: 2.8 })
    const wall = (id: string) =>
      WallNode.parse({ id, parentId: upper.id, start: [0, 0], end: [4, 0], height: 2.8 })
    const chair = ItemNode.parse({
      id: 'item_a',
      parentId: 'level_g',
      position: [1, 0, 1],
      asset: {
        id: 'chair',
        name: 'Chair',
        category: 'furniture',
        thumbnail: '/items/chair/thumbnail.webp',
        src: '/items/chair/model.glb',
      },
    })
    const away = wall('wall_b')
    const building = base.nodes['building_b' as AnyNodeId] as BuildingNode
    const level = base.nodes['level_g' as AnyNodeId] as LevelNode
    const from = {
      ...base,
      nodes: {
        ...base.nodes,
        [building.id]: { ...building, children: [level.id, upper.id] },
        [level.id]: { ...level, children: [chair.id] },
        [upper.id]: { ...upper, children: [away.id] },
        [chair.id]: chair,
        [away.id]: away,
      },
    } as SceneSnapshot
    const scene = detached('effect_reads', from)
    const bridge = new SceneBridge({ runtime: scene })
    bridge.setActiveScene({ id: 'scene_reads', name: 'Reads' } as never)
    await write(bridge)
    const patch = scene.patch()
    const dependencies = scene.dependencies()
    scene.dispose()
    expect(patch.nodeUpdates).toEqual([
      expect.objectContaining({ id: chair.id, data: { name: 'North' } }),
    ])

    const edited = (nodes: Record<string, AnyNode>) => ({ ...from, nodes }) as SceneSnapshot
    const { [away.id]: _gone, ...withoutAway } = from.nodes as Record<string, AnyNode>
    const meanwhile = [
      edited({
        ...from.nodes,
        [upper.id]: { ...upper, children: [away.id, 'wall_c'] },
        wall_c: wall('wall_c'),
      } as Record<string, AnyNode>),
      edited({ ...withoutAway, [upper.id]: { ...upper, children: [] } } as Record<string, AnyNode>),
    ]
    for (const current of meanwhile)
      expect(applyPatchWithDependencies(current, patch, dependencies, from).ok).toBe(true)
    const renamed = edited({ ...from.nodes, [chair.id]: { ...chair, name: 'South' } } as Record<
      string,
      AnyNode
    >)
    expect(applyPatchWithDependencies(renamed, patch, dependencies, from).ok).toBe(false)
  }

  test('read what they touch: a create or delete elsewhere meanwhile merges, a rename of the same node conflicts', async () => {
    await readsOf((bridge) => {
      bridge.applyPatch([{ op: 'update', id: 'item_a' as AnyNodeId, data: { name: 'North' } }])
    })
  })

  test('so does an MCP tool call: recording what it made reads no more of the scene', async () => {
    await readsOf(async (bridge) => {
      const client = await connect(createPascalMcpServer({ bridge }))
      const result = await client.callTool({
        name: 'apply_patch',
        arguments: { patches: [{ op: 'update', id: 'item_a', data: { name: 'North' } }] },
      })
      expect(result.isError, JSON.stringify(result.content)).toBeFalsy()
    })
  })
})

describe('SceneBridge export', () => {
  test('reads materials and the plugin list as dependencies', () => {
    const base = {
      ...snapshot(),
      materials: { mat_red: { id: 'mat_red', name: 'Red', material: { color: '#ff0000' } } },
      installedPlugins: ['pascal:test'],
    } as unknown as SceneSnapshot
    const scene = detached('effect_export', base)
    const exported = new SceneBridge({ runtime: scene }).exportJSON() as Record<string, unknown>
    expect(Object.keys(exported.materials as object)).toEqual(['mat_red'])
    expect(scene.dependencies()).toEqual(
      expect.arrayContaining([{ kind: 'material', id: 'mat_red' }, { kind: 'plugins' }]),
    )
    scene.dispose()
  })
})

describe('store-only operations', () => {
  test('serve their tools: the scene scope needs no bridge', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pascal-store-only-'))
    const operations = createSceneOperations({
      store: new SqliteSceneStore({ databasePath: join(directory, 'pascal.db') }),
    })
    const client = await connect(createPascalMcpServer({ bridge: new SceneBridge(), operations }))
    const result = await client.callTool({ name: 'list_scenes', arguments: {} })
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy()
  })
})
