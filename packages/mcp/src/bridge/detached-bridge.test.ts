import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  captureRegistryVersions,
  effectIds,
  openDetachedScene,
  SceneEnvironmentDisposedError,
  type SceneSnapshot,
} from '@pascal-app/core/runtime'
import { type AnyNode, BuildingNode, LevelNode } from '@pascal-app/core/schema'
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
