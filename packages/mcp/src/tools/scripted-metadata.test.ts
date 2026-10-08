import { expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  type AnyNodeId,
  GeometryArtifactManifest,
  LevelNode,
  WallNode,
} from '@pascal-app/core/schema'
import {
  createPascalMcpServer,
  createSceneOperations,
  type GeometryScriptHost,
  SceneBridge,
} from '@pascal-app/mcp'
import { InMemorySceneStore } from './scene-lifecycle/test-utils'

for (const kind of ['object', 'door', 'window', 'column'] as const) {
  test(`${kind} uploads both artifacts for the created node and retains reuse fields on edits`, async () => {
    const bridge = new SceneBridge()
    const level = LevelNode.parse({ id: 'level_script_meta' })
    const wall = WallNode.parse({
      id: 'wall_script_meta',
      parentId: level.id,
      start: [0, 0],
      end: [5, 0],
    })
    bridge.setScene({ [level.id]: level, [wall.id]: wall }, [level.id])
    const store = new InMemorySceneStore()
    const operations = createSceneOperations({ bridge, store })
    operations.setActiveScene(
      await store.save({ name: 'Script metadata', graph: operations.exportSceneGraph() }),
    )
    const uploads: Parameters<GeometryScriptHost['storeArtifact']>[0][] = []
    const wallMount = kind === 'door' || kind === 'window'
    const host: GeometryScriptHost = {
      compile: async ({ code }) => ({
        sha256: 'a'.repeat(64),
        script: (code === 'edit' ? 'c' : 'b').repeat(64),
        mount: wallMount ? 'wall' : 'floor',
        params: {},
        glb: new Uint8Array(),
        manifest: GeometryArtifactManifest.parse({
          bounds: { min: [-0.5, 0, -0.1], max: [0.5, 1, 0.1] },
          triangles: 12,
        }),
      }),
      storeArtifact: async (input) => {
        uploads.push(input)
        return input.mimeType === 'model/gltf-binary' ? 'd'.repeat(64) : input.sha256
      },
      readArtifact: async () => new TextEncoder().encode('original'),
    }
    const server = createPascalMcpServer({ bridge, operations, store, geometryScripts: host })
    const client = new Client({ name: 'metadata-test', version: '0.0.0' })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const input = {
        code: 'original',
        name: 'Carved oak',
        description: 'x'.repeat(220),
        category: 'carved',
        tags: Array(7).fill('OAK'),
        ...(kind === 'object' ? { reason: 'no carved panel type' } : {}),
        ...(wallMount
          ? { wallId: wall.id, t: 0.5 }
          : kind === 'column'
            ? { x: 0, z: 0 }
            : { parentId: level.id }),
      }
      const result = await client.callTool({ name: `add_${kind}`, arguments: input })
      expect(result.isError).toBeFalsy()
      const payload = JSON.parse((result.content as { text: string }[])[0]!.text)
      const nodeId = (payload.nodeId ?? payload.doorId ?? payload.windowId) as AnyNodeId
      const node = bridge.getNode(nodeId) as {
        source?: {
          artifact: string
          meta?: { description?: string; tags?: string[]; parent?: string }
        }
      }
      expect(node.source?.artifact).toBe('d'.repeat(64))
      expect(node.source?.meta?.description).toHaveLength(200)
      expect(node.source?.meta?.tags).toEqual(Array(5).fill('oak'))
      expect(uploads).toHaveLength(2)
      for (const upload of uploads) {
        expect(upload.nodeId).toBe(nodeId)
        expect(upload.metadata).toMatchObject({
          name: 'Carved oak',
          description: 'x'.repeat(200),
          kind: kind === 'object' ? 'item' : kind,
          mount: wallMount ? 'wall' : 'floor',
          tags: Array(5).fill('oak'),
        })
      }
      const edit = await client.callTool({
        name: `add_${kind}`,
        arguments: { nodeId, code: 'edit' },
      })
      expect(edit.isError).toBeFalsy()
      // The name lives on the node and an item's category on its asset.
      expect((bridge.getNode(nodeId) as typeof node).source?.meta).toEqual({
        description: 'x'.repeat(200),
        ...(kind === 'object' ? {} : { category: 'carved' }),
        parent: 'b'.repeat(64),
        tags: Array(5).fill('oak'),
      })
      expect(uploads).toHaveLength(4)
      expect(uploads[2]!.nodeId).toBe(nodeId)
      expect(uploads[2]!.metadata?.name).toBe('Carved oak')
      expect(uploads[2]!.metadata?.category).toBe('carved')
    } finally {
      await client.close()
      await server.close()
    }
  })
}
