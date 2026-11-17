import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { clearSceneHistory, useScene } from '@pascal-app/core'
import { SiteNode, TerrainBreakNode } from '@pascal-app/core/schema'
import { SceneBridge } from '@pascal-app/mcp/bridge'
import { registerApplyPatch } from '@pascal-app/mcp/tools/apply-patch'

const crossing: [number, number][] = [
  [3, 2],
  [5, 2],
  [5, 6],
  [3, 6],
  [3, 2],
]

function fixture() {
  const cliff = TerrainBreakNode.parse({
    id: 'terrain-break_cliff',
    parentId: 'site_mutations',
    line: [
      [4, 0],
      [4, 8],
    ],
    kind: 'cliff',
    left: 5,
    right: 2,
  })
  const pad = TerrainBreakNode.parse({
    id: 'terrain-break_pad',
    parentId: 'site_mutations',
    line: [
      [1, 2],
      [3, 2],
      [3, 6],
      [1, 6],
      [1, 2],
    ],
    kind: 'retaining',
    left: 7,
    right: 'ground',
  })
  const site = SiteNode.parse({
    id: 'site_mutations',
    children: [cliff.id, pad.id],
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
      ],
    },
  })
  return { site, pad, nodes: { [site.id]: site, [cliff.id]: cliff, [pad.id]: pad } }
}

let client: Client
let server: McpServer
let bridge: SceneBridge
let previous: ReturnType<typeof useScene.getState>
let previousRaf: typeof requestAnimationFrame
let previousCancelRaf: typeof cancelAnimationFrame

beforeEach(async () => {
  previous = useScene.getState()
  previousRaf = globalThis.requestAnimationFrame
  previousCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  useScene.setState({ readOnly: false })
  const { site, nodes } = fixture()
  bridge = new SceneBridge()
  bridge.setScene(nodes, [site.id])
  bridge.clearHistory()
  bridge.flushDirty()
  server = new McpServer({ name: 'terrain-break-test', version: '0.0.0' })
  registerApplyPatch(server, bridge)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'terrain-break-test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
})

afterEach(async () => {
  await client.close()
  await server.close()
  useScene.setState(previous)
  clearSceneHistory()
  globalThis.requestAnimationFrame = previousRaf
  globalThis.cancelAnimationFrame = previousCancelRaf
})

describe('MCP apply_patch terrain-break mutation safety', () => {
  for (const deleteSource of [false, true]) {
    test(`creating a Site then reparenting a break preserves both hierarchy directions, deleteSource=${deleteSource}`, async () => {
      const { site } = fixture()
      const before = JSON.stringify(bridge.exportJSON())
      const destination = SiteNode.parse({ ...site, id: 'site_destination', children: [] })
      const patches: Record<string, unknown>[] = [
        { op: 'create', node: destination },
        { op: 'update', id: 'terrain-break_cliff', data: { parentId: destination.id } },
      ]
      if (deleteSource) patches.push({ op: 'delete', id: site.id })
      const result = await client.callTool({
        name: 'apply_patch',
        arguments: { patches },
      })
      expect(result.isError).toBeFalsy()
      expect(bridge.getNode('terrain-break_cliff')).toMatchObject({ parentId: destination.id })
      expect(bridge.getNode(destination.id)).toMatchObject({
        children: expect.arrayContaining(['terrain-break_cliff']),
      })
      expect(bridge.getRootNodeIds()).toContain(destination.id)
      if (deleteSource) expect(bridge.getNode(site.id)).toBeNull()
      else {
        const source = bridge.getNode(site.id)
        if (!source || source.type !== 'site') throw new Error('Expected the retained source Site')
        expect(source.children).not.toContain('terrain-break_cliff')
      }
      expect(bridge.getHistory().pastCount).toBe(1)
      expect(bridge.undo()).toBe(1)
      expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    })
  }

  test('an invalid reparenting batch does not leave its newly created destination Site behind', async () => {
    const { site } = fixture()
    const destination = SiteNode.parse({ ...site, id: 'site_destination', children: [] })
    const before = JSON.stringify(bridge.exportJSON())
    const history = bridge.getHistory()
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'create', node: destination },
          {
            op: 'update',
            id: 'terrain-break_cliff',
            data: {
              parentId: destination.id,
              line: [
                [4, 0],
                [4, 0],
              ],
            },
          },
        ],
      },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory()).toEqual(history)
    expect(bridge.getNode(destination.id)).toBeNull()
  })

  for (const mode of ['update', 'create'] as const) {
    test(`a crossing ${mode} is refused over the wire and commits none of the batch`, async () => {
      const { site, pad } = fixture()
      const before = JSON.stringify(bridge.exportJSON())
      const history = bridge.getHistory()
      const mutation =
        mode === 'update'
          ? { op: 'update', id: pad.id, data: { line: crossing } }
          : {
              op: 'create',
              node: TerrainBreakNode.parse({
                ...pad,
                id: 'terrain-break_crossing',
                line: crossing,
              }),
              parentId: site.id,
            }
      const result = await client.callTool({
        name: 'apply_patch',
        arguments: {
          patches: [
            { op: 'update', id: site.id, data: { name: 'Must not be committed' } },
            mutation,
          ],
        },
      })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(bridge.exportJSON())).toBe(before)
      expect(bridge.getHistory()).toEqual(history)
      expect(bridge.flushDirty()).toEqual([])
    })
  }

  test('a collapsed-line refinement is an error, not a successful raw patch', async () => {
    const { pad } = fixture()
    const before = JSON.stringify(bridge.exportJSON())
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          {
            op: 'update',
            id: pad.id,
            data: {
              line: [
                [1, 2],
                [1, 2],
              ],
            },
          },
        ],
      },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
    expect(bridge.getHistory().pastCount).toBe(0)
  })
})
