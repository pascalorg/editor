import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import {
  applySceneChanges,
  type DressRoomInput,
  dressRoom,
} from '@pascal-app/core/agent-operations'
import type { AnyNode, AnyNodeId, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { twoRooms } from './__fixtures__/dressing-scene'
import { registerSharedTools } from './shared-tools'

type Result = { isError?: boolean; content: Array<{ type: string; text?: string }> }
let bridge: SceneBridge
let client: Client
let server: McpServer
const hand = { id: 'hand_paint', face: 'a', v1: 0.2, finish: '#123456' }
const input: DressRoomInput = {
  zoneIds: ['zone_salon'],
  layers: [
    { kind: 'wainscot', finish: '#abcdef', to: 0.9 },
    { kind: 'chairRail', offsetY: 0, finish: 'library:preset-white' },
  ],
}

beforeEach(async () => {
  const fixture = twoRooms({ walls: { wall_s: { faceRegions: [hand] } } })
  bridge = new SceneBridge()
  bridge.setScene(fixture.nodes as Record<AnyNodeId, AnyNode>, fixture.rootNodeIds as AnyNodeId[])
  bridge.clearHistory()
  server = new McpServer({ name: 'dress-room', version: '1' })
  registerSharedTools(server, createSceneOperations({ bridge }))
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'dress-room', version: '1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
})

afterEach(async () => {
  await client.close()
  await server.close()
})

async function call(args: DressRoomInput) {
  const result = (await client.callTool({ name: 'dress_room', arguments: args })) as Result
  const text = result.content.find((entry) => entry.type === 'text')?.text ?? ''
  return { error: !!result.isError, text }
}
const wall = (id: string) => bridge.getNodes()[id as AnyNodeId] as WallNode

describe('room dressing over the public MCP', () => {
  test('dry run has no history or scene effect; live application matches core and is one undo', async () => {
    const before = bridge.exportJSON()
    const dry = await call({ ...input, dryRun: true })
    expect(dry.error).toBe(false)
    expect(JSON.parse(dry.text)).toMatchObject({ written: false })
    expect(bridge.exportJSON()).toEqual(before)
    expect(bridge.getHistory()).toEqual({ pastCount: 0, futureCount: 0 })
    const outcome = dressRoom(bridge.getNodes(), input, { activeLevelId: 'level_0' })
    const expected = applySceneChanges(bridge.getNodes(), outcome.changes)
    const live = await call(input)
    expect(live.error).toBe(false)
    for (const id of ['wall_s', 'wall_p', 'wall_an', 'wall_w'])
      expect(wall(id)).toEqual(expected[id])
    // Independent geometric/ownership checks prevent transport parity from merely
    // agreeing with a wrong core implementation.
    expect(wall('wall_s').faceRegions).toEqual([
      hand,
      expect.objectContaining({ face: 'a', u0: 0, u1: 4, v1: 0.9, finish: '#abcdef' }),
    ])
    expect(wall('wall_s').chairRail?.spans).toEqual([{ face: 'a', u0: 0, u1: 4 }])
    expect(wall('wall_s').chairRail?.offsetY).toBe(0)
    expect(bridge.getHistory()).toEqual({ pastCount: 1, futureCount: 0 })
    const after = bridge.exportJSON()
    expect(bridge.undo()).toBe(1)
    expect(bridge.exportJSON()).toEqual(before)
    expect(bridge.redo()).toBe(1)
    expect(bridge.exportJSON()).toEqual(after)
    bridge.setScene({}, [])
    bridge.loadJSON(JSON.stringify(after))
    expect(wall('wall_s').chairRail?.spans).toEqual([{ face: 'a', u0: 0, u1: 4 }])
    expect(wall('wall_s').faceRegions?.[0]).toEqual(hand)
  })

  test('replacement and empty layers preserve hand paint and existing trims', async () => {
    expect((await call(input)).error).toBe(false)
    expect(
      (
        await call({
          zoneIds: ['zone_salon'],
          layers: [{ kind: 'tiles', finish: '#ffffff', to: 1.2 }],
        })
      ).error,
    ).toBe(false)
    expect(wall('wall_s').faceRegions).toHaveLength(2)
    expect(wall('wall_s').faceRegions?.[1]).toMatchObject({ v1: 1.2, finish: '#ffffff' })
    const trim = structuredClone(wall('wall_s').chairRail)
    expect((await call({ zoneIds: ['zone_salon'], layers: [] })).error).toBe(false)
    expect(wall('wall_s').faceRegions).toEqual([hand])
    expect(wall('wall_s').chairRail).toEqual(trim)
  })

  test('shared-face trim conflict refuses atomically with facts and no history entry', async () => {
    expect((await call(input)).error).toBe(false)
    bridge.clearHistory()
    const before = bridge.exportJSON()
    const result = await call({
      zoneIds: ['zone_bath'],
      layers: [
        { kind: 'tiles', finish: '#eeeeee' },
        { kind: 'chairRail', offsetY: 0, finish: 'library:preset-cream' },
      ],
    })
    expect(result.error).toBe(true)
    expect(result.text).toContain('trim_conflict')
    expect(result.text).toContain('wall_s')
    expect(bridge.exportJSON()).toEqual(before)
    expect(bridge.getHistory()).toEqual({ pastCount: 0, futureCount: 0 })
  })

  test('a ninth face region refuses without a partial multi-wall write', async () => {
    const fixture = twoRooms({
      walls: {
        wall_w: {
          faceRegions: Array.from({ length: 8 }, (_, i) => ({
            ...hand,
            id: `hand_${i}`,
            v1: 0.1 + i / 10,
          })),
        },
      },
    })
    bridge.setScene(fixture.nodes as Record<AnyNodeId, AnyNode>, fixture.rootNodeIds as AnyNodeId[])
    bridge.clearHistory()
    const before = bridge.exportJSON()
    const result = await call(input)
    expect(result.error).toBe(true)
    expect(result.text).toContain('region_limit')
    expect(bridge.exportJSON()).toEqual(before)
    expect(bridge.getHistory()).toEqual({ pastCount: 0, futureCount: 0 })
  })
})
