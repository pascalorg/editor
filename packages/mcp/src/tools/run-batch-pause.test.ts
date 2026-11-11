import { describe, expect, test } from 'bun:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { BuildingNode, LevelNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

type Result = {
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: {
    status: string
    applied: number
    refused: number
    calls: { index: number; tool: string; status: string; code?: string }[]
  }
}

const wall = (x: number) => ({ tool: 'add_wall', input: { start: [x, 0], end: [x, 3] } })
const missing = { tool: 'delete_node', input: { id: 'wall_that_is_not_there' } }

/** A one-level building served by its own server; `pause` is the host's, when it gives one. */
async function served(pause?: (bridge: SceneBridge) => Promise<void>) {
  const level = LevelNode.parse({ id: 'level_0', parentId: 'building_main', level: 0 })
  const building = BuildingNode.parse({ id: 'building_main', children: [level.id] })
  const bridge = new SceneBridge()
  bridge.setScene({ [building.id]: building, [level.id]: level }, [building.id] as never)
  const server = createPascalMcpServer({
    bridge,
    ...(pause && { betweenBatchCalls: () => pause(bridge) }),
  })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'run-batch-pause-test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const walls = () => Object.values(bridge.getNodes()).filter((node) => node.type === 'wall').length
  const batch = async (calls: unknown[], onRefusal?: 'stop' | 'skip') =>
    (await client.callTool({
      name: 'run_batch',
      arguments: { calls, ...(onRefusal && { onRefusal }) },
    })) as Result
  return { batch, bridge, walls }
}

/** A result without the ids its calls minted. */
const shape = (result: Result) => ({
  isError: result.isError === true,
  status: result.structuredContent?.status,
  applied: result.structuredContent?.applied,
  refused: result.structuredContent?.refused,
  calls: result.structuredContent?.calls.map(({ index, tool, status, code }) => ({
    index,
    tool,
    status,
    code,
  })),
})

describe("run_batch on a host that pauses between a batch's calls", () => {
  test('pauses after each call, with the scene as the batch found it, then applies the batch whole', async () => {
    const seen: number[] = []
    const host = await served(async () => {
      // Other work of the host runs here: a timer, a request's I/O.
      await new Promise((resolve) => setTimeout(resolve, 0))
      seen.push(host.walls())
    })
    const result = await host.batch([wall(0), wall(2), { tool: 'get_walls' }, wall(4)])
    expect(seen).toEqual([0, 0, 0, 0])
    expect(host.walls()).toBe(3)
    expect(host.bridge.undo()).toBe(1)
    expect(host.walls()).toBe(0)
    expect(result.structuredContent).toMatchObject({ status: 'applied', applied: 4, refused: 0 })
  })

  test('answers as a batch run in one go does: in order, stopped by a refusal, or past it', async () => {
    const batches: [unknown[], ('stop' | 'skip')?][] = [
      [[wall(0), { tool: 'get_walls' }, wall(2)]],
      [[wall(0), missing, wall(2)]],
      [[wall(0), missing, wall(2)], 'skip'],
      [[wall(0), { tool: 'not_a_batch_tool' }]],
    ]
    for (const [calls, onRefusal] of batches) {
      const paused = await served(() => new Promise((resolve) => setTimeout(resolve, 0)))
      const direct = await served()
      const [a, b] = [await paused.batch(calls, onRefusal), await direct.batch(calls, onRefusal)]
      expect(shape(a)).toEqual(shape(b))
      expect(paused.walls()).toBe(direct.walls())
    }
  })
})
