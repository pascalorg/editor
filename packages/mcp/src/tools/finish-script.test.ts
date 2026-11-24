import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { GeometryArtifactManifest, type WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import type { GeometryScriptHost } from './add-object'
import { hostFinishCompiler, registerSetFinishScript } from './finish-script'
import { registerSharedTools } from './shared-tools'

describe('set_finish_script', () => {
  let client: Client
  let bridge: SceneBridge
  const compiledFor: Record<string, unknown>[] = []
  const host: GeometryScriptHost = {
    compile: async ({ inputs }) => {
      compiledFor.push(inputs ?? {})
      return {
        sha256: 'a'.repeat(64),
        script: 'b'.repeat(64),
        language: 'three',
        mount: 'wall-side',
        params: {},
        manifest: GeometryArtifactManifest.parse({
          bounds: { min: [0, 0, 0], max: [1, 1, 0.01] },
          slots: [{ id: 'tile' }],
          triangles: 12,
        }),
        glb: new Uint8Array(),
      }
    },
    storeArtifact: async ({ sha256 }) => sha256,
    readArtifact: async () => null,
  }

  beforeEach(async () => {
    compiledFor.length = 0
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    bridge.setActiveScene({ id: 'scene_finish', name: 'Finish' } as never)
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSharedTools(server, bridge)
    registerSetFinishScript(server, bridge, hostFinishCompiler(host))
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    return {
      isError: result.isError,
      body: JSON.parse((result.content as { text: string }[])[0]!.text),
    }
  }

  test("tiles a room's walls to a height, one compile per face, and takes them off", async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const room = await call('create_room', {
      levelId: level.id,
      name: 'Bathroom',
      polygon: [
        [0, 0],
        [3, 0],
        [3, 2],
        [0, 2],
      ],
    })
    const tiled = await call('set_finish_script', {
      targetId: room.body.zoneId,
      surface: 'walls',
      code: 'export default () => null',
      toHeight: '2.1 m',
    })
    expect(tiled.isError).toBeFalsy()
    expect(tiled.body.built).toHaveLength(4)
    expect(compiledFor).toHaveLength(4)
    const walls = Object.values(bridge.getNodes()).filter(
      (node): node is WallNode => node.type === 'wall' && Boolean(node.finishScripts),
    )
    expect(walls).toHaveLength(4)
    expect(walls.every((wall) => Object.values(wall.finishScripts!)[0]?.toHeight === 2.1)).toBe(
      true,
    )

    const removed = await call('set_finish_script', {
      targetId: room.body.zoneId,
      surface: 'walls',
      remove: true,
    })
    expect(removed.body.removed).toBe(4)
    expect(
      Object.values(bridge.getNodes()).some((node) => node.type === 'wall' && node.finishScripts),
    ).toBe(false)
  })

  test('a room without a surface is refused before anything compiles', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const room = await call('create_room', {
      levelId: level.id,
      name: 'Bathroom',
      polygon: [
        [0, 0],
        [3, 0],
        [3, 2],
        [0, 2],
      ],
    })
    const refused = await call('set_finish_script', { targetId: room.body.zoneId, code: 'x' })
    expect(refused.isError).toBe(true)
    expect(refused.body.code).toBe('surface_required')
    expect(compiledFor).toHaveLength(0)
  })
})
