import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerApplyPatch } from './apply-patch'

// apply_patch accepted parentId moves that closed a loop in the hierarchy
// (pascalorg/editor#975). The result passed per-node schema validation, was
// mirrored into both `children` arrays and went on to draft persistence; on
// reload initSpatialGridSync walks every node's parent chain, so the scene
// hung the tab.
describe('apply_patch refuses a reparent that would create a hierarchy cycle', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerApplyPatch(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  const patch = (patches: unknown[]) =>
    client.callTool({ name: 'apply_patch', arguments: { patches } })

  const refusal = (result: Awaited<ReturnType<typeof patch>>) => {
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    return JSON.parse(text) as { code: string; patchIndex: number; id: string; message: string }
  }

  const nodeOf = (id: string) =>
    bridge.getNodes()[id] as (AnyNode & { children?: string[] }) | undefined

  const firstOfType = (type: string) =>
    Object.values(bridge.getNodes()).find((n) => n.type === type) as AnyNode & {
      children?: string[]
    }

  test('two sites cannot be made each other\u2019s parent, and nothing is half-applied', async () => {
    const siteA = firstOfType('site')
    const before = nodeOf(siteA.id)!

    const created = await patch([
      {
        node: { children: [], id: 'site_b', object: 'node', parentId: null, type: 'site' },
        op: 'create',
      },
    ])
    expect(created.isError).toBeFalsy()

    const moved = await patch([{ data: { parentId: 'site_b' }, id: siteA.id, op: 'update' }])
    expect(moved.isError).toBeFalsy()

    const cycle = await patch([{ data: { parentId: siteA.id }, id: 'site_b', op: 'update' }])
    expect(cycle.isError).toBe(true)
    const refused = refusal(cycle)
    expect(refused.code).toBe('invalid_parent')
    expect(refused.id).toBe('site_b')
    expect(refused.message).toContain('cycle')

    await new Promise((r) => setTimeout(r, 10))
    // The refused op leaves the graph exactly as the accepted move left it:
    // A under B, and no back-edge from A to B.
    expect(nodeOf('site_b')!.parentId).toBe(null)
    expect(nodeOf('site_b')!.children ?? []).toContain(siteA.id)
    expect(nodeOf(siteA.id)!.parentId).toBe('site_b')
    expect(nodeOf(siteA.id)!.children ?? []).not.toContain('site_b')
    expect(nodeOf(siteA.id)!.children).toEqual(before.children ?? [])
  })

  test('a node cannot be reparented under a deeper descendant', async () => {
    const building = firstOfType('building')
    const level = firstOfType('level')
    expect(level.parentId).toBe(building.id)

    const result = await patch([{ data: { parentId: level.id }, id: building.id, op: 'update' }])
    expect(result.isError).toBe(true)
    expect(refusal(result).code).toBe('invalid_parent')

    await new Promise((r) => setTimeout(r, 10))
    expect(nodeOf(building.id)!.parentId).not.toBe(level.id)
    expect(nodeOf(level.id)!.children ?? []).not.toContain(building.id)
  })

  test('a node cannot be updated to be its own parent', async () => {
    const site = firstOfType('site')
    const result = await patch([{ data: { parentId: site.id }, id: site.id, op: 'update' }])
    expect(result.isError).toBe(true)
    expect(refusal(result).code).toBe('invalid_parent')

    await new Promise((r) => setTimeout(r, 10))
    expect(nodeOf(site.id)!.parentId).toBe(null)
    expect(nodeOf(site.id)!.children ?? []).not.toContain(site.id)
  })

  test('a node cannot be created already pointing at itself', async () => {
    const result = await patch([
      {
        node: { children: [], id: 'site_s', object: 'node', parentId: 'site_s', type: 'site' },
        op: 'create',
      },
    ])
    expect(result.isError).toBe(true)
    expect(refusal(result).code).toBe('invalid_parent')

    await new Promise((r) => setTimeout(r, 10))
    expect(nodeOf('site_s')).toBeUndefined()
  })

  test('a legitimate reparent still applies', async () => {
    const siteA = firstOfType('site')
    const building = firstOfType('building')

    const created = await patch([
      {
        node: { children: [], id: 'site_other', object: 'node', parentId: null, type: 'site' },
        op: 'create',
      },
    ])
    expect(created.isError).toBeFalsy()

    const moved = await patch([{ data: { parentId: 'site_other' }, id: building.id, op: 'update' }])
    expect(moved.isError).toBeFalsy()

    await new Promise((r) => setTimeout(r, 10))
    expect(nodeOf(building.id)!.parentId).toBe('site_other')
    expect(nodeOf('site_other')!.children).toContain(building.id)
    expect(nodeOf(siteA.id)!.children ?? []).not.toContain(building.id)
  })
})
