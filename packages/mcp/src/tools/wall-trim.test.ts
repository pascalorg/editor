import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { applySceneChanges, setWallTrim } from '@pascal-app/core/agent-operations'
import type { AnyNode, AnyNodeId, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { twoRooms } from './__fixtures__/dressing-scene'
import { registerSharedTools } from './shared-tools'

type Result = { isError?: boolean; content: Array<{ type: string; text?: string }> }
let bridge: SceneBridge
let client: Client
let server: McpServer

beforeEach(async () => {
  const fixture = twoRooms()
  bridge = new SceneBridge()
  bridge.setScene(fixture.nodes as Record<AnyNodeId, AnyNode>, fixture.rootNodeIds as AnyNodeId[])
  bridge.clearHistory()
  server = new McpServer({ name: 'wall-trim', version: '1' })
  registerSharedTools(server, createSceneOperations({ bridge }))
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'wall-trim', version: '1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
})

afterEach(async () => {
  await client.close()
  await server.close()
})

async function call(input: Record<string, unknown>) {
  const result = (await client.callTool({ name: 'set_wall_trim', arguments: input })) as Result
  const text = result.content.find((entry) => entry.type === 'text')?.text ?? ''
  return { error: !!result.isError, text }
}

// Transport parity is supplemental to the analytic assertion: the salon's stretch
// is 0..4 on the 8 m wall, never the neighboring room's 4..8 stretch.
describe('wall trim over the public MCP', () => {
  test('zero-offset room trim matches core, persists, and has exactly one undo step', async () => {
    const before = bridge.exportJSON()
    const input = {
      kind: 'chairRail' as const,
      zoneIds: ['zone_salon'],
      offsetY: 0,
      finish: 'library:preset-white',
    }
    const expected = applySceneChanges(
      bridge.getNodes(),
      setWallTrim(bridge.getNodes(), input, { activeLevelId: 'level_0' }).changes,
    )
    expect((await call(input)).error).toBe(false)
    for (const id of ['wall_s', 'wall_p', 'wall_an', 'wall_w'])
      expect(bridge.getNodes()[id as AnyNodeId]).toEqual(expected[id])
    const shared = bridge.getNodes().wall_s as WallNode
    expect(shared.chairRail).toMatchObject({
      enabled: true,
      offsetY: 0,
      spans: [{ face: 'a', u0: 0, u1: 4 }],
    })
    expect(shared.slots).toMatchObject({ aChairRail: 'library:preset-white' })
    const after = bridge.exportJSON()
    expect(bridge.getHistory()).toEqual({ pastCount: 1, futureCount: 0 })
    expect(bridge.undo()).toBe(1)
    expect(bridge.exportJSON()).toEqual(before)
    expect(bridge.redo()).toBe(1)
    expect(bridge.exportJSON()).toEqual(after)
    bridge.setScene({}, [])
    bridge.loadJSON(JSON.stringify(after))
    expect((bridge.getNodes().wall_s as WallNode).chairRail).toEqual(shared.chairRail)
  })

  test('a mixed unsupported target refuses without changing history or scene', async () => {
    const fixture = twoRooms({ walls: { wall_e: { wallType: 'railing' } } })
    bridge.setScene(fixture.nodes as Record<AnyNodeId, AnyNode>, fixture.rootNodeIds as AnyNodeId[])
    bridge.clearHistory()
    const before = bridge.exportJSON()
    const result = await call({ kind: 'crown', wallIds: ['wall_w', 'wall_e'], faces: 'both' })
    expect(result.error).toBe(true)
    expect(result.text).toContain('railing_wall')
    expect(bridge.exportJSON()).toEqual(before)
    expect(bridge.getHistory()).toEqual({ pastCount: 0, futureCount: 0 })
  })
})
