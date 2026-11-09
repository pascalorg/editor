import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { BuildingNode, LevelNode, type AnyNode as SceneNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { registerSharedTools } from './shared-tools'

/** A plugin's node kind a host validates at its own write boundary, as the hosted MCP does. */
const Gadget = z.object({
  object: z.literal('node'),
  id: z.string(),
  type: z.literal('gadget:lamp'),
  parentId: z.string().nullable(),
  visible: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  watts: z.number().positive(),
})

class PluginHostBridge extends SceneBridge {
  nodeSchema(kind: string) {
    return kind === Gadget.shape.type.value ? Gadget : undefined
  }
}

async function verify(bridge: SceneBridge, gadget: Record<string, unknown>) {
  const level = LevelNode.parse({ id: 'level_0', parentId: 'building_main', children: ['g'] })
  const building = BuildingNode.parse({ id: 'building_main', children: [level.id] })
  bridge.setScene(
    {
      [building.id]: building,
      [level.id]: level,
      g: { object: 'node', id: 'g', parentId: level.id, visible: true, metadata: {}, ...gadget },
    } as Record<string, SceneNode>,
    [building.id] as never,
  )
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerSharedTools(server, createSceneOperations({ bridge }))
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'verify-scene-test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const result = await client.callTool({ name: 'verify_scene', arguments: {} })
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as {
    valid: boolean
    issues: { type: string; nodeId?: string; path?: string; kind?: string }[]
  }
}

// validate_scene checked nodes by the bridge's own schema; verify_scene, which took it over, does
// too when the bridge lends one. Without it, a plugin's kind is no error: no schema here reads it.
describe('verify_scene checks nodes by the schema the bridge lends', () => {
  test("a kind the host's schema accepts is valid there, and named once as unknown elsewhere", async () => {
    const lamp = { type: 'gadget:lamp', watts: 40 }
    const hosted = await verify(new PluginHostBridge(), lamp)
    expect(hosted.valid).toBe(true)
    expect(hosted.issues.map((issue) => issue.type)).not.toContain('schema_unknown_kind')
    const plain = await verify(new SceneBridge(), lamp)
    expect(plain.valid).toBe(true)
    expect(plain.issues).toContainEqual(
      expect.objectContaining({ type: 'schema_unknown_kind', kind: 'gadget:lamp', nodeIds: ['g'] }),
    )
  })

  test("a field the host's schema rejects is reported by node and path", async () => {
    const result = await verify(new PluginHostBridge(), { type: 'gadget:lamp', watts: -1 })
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ type: 'schema_invalid', nodeId: 'g' }),
    )
  })
})
