import '../bridge/node-shims'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneMaterial } from '@pascal-app/core/schema'
import { SceneBridge } from '@pascal-app/mcp/bridge'
import { createSceneOperations } from '@pascal-app/mcp/operations'
import { registerSharedTools } from '@pascal-app/mcp/tools/shared-tools'
import {
  EXPECTED_MOUNTAIN_MATERIAL,
  expectPreserved,
  MOUNTAIN_NAME,
  mountainPaint,
  nativeMaterialScene,
  nativePaintReadback,
} from '../../../core/src/agent-operations/__fixtures__/native-materials'

// Actual MCP client transport -> shared operation -> facade -> native bridge/store.
// This rejects dropping SceneChanges.materials in toPatches, and dropping context registry.
// Contract v1.1, not evidence of a paid model using this tool.
type Result = { isError?: boolean; content: Array<{ type: string; text?: string }> }
let bridge: SceneBridge
let client: Client
let server: McpServer
const registry = () => bridge.exportJSON().materials as Record<string, SceneMaterial>
async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as Result
  const text = result.content.find((entry) => entry.type === 'text')?.text
  // SDK schema refusals are plain text; successful tool payloads must remain JSON.
  return {
    error: result.isError,
    payload: result.isError ? { error: text } : text ? JSON.parse(text) : undefined,
  }
}
beforeEach(async () => {
  bridge = new SceneBridge()
  const fixture = nativeMaterialScene()
  bridge.setScene(fixture.nodes, fixture.rootNodeIds, { materials: {} })
  bridge.clearHistory()
  server = new McpServer({ name: 'native-materials-acceptance', version: '1.1' })
  registerSharedTools(server, createSceneOperations({ bridge }))
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'native-materials-client', version: '1.1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
})
afterEach(async () => {
  await client.close()
  await server.close()
  bridge.setScene({}, [], { materials: {} })
  bridge.clearHistory()
})

describe('native custom materials over actual MCP transport', () => {
  test('paint carries native upsert, readback and saved JSON survive one undo/redo', async () => {
    const before = bridge.exportJSON()
    const result = await call('paint', mountainPaint())
    expect(result.error).toBeFalsy()
    expect(result.payload).toMatchObject({ ok: true })
    const after = bridge.exportJSON()
    const { ref, datablock } = nativePaintReadback(bridge.getNodes(), registry())
    expect(datablock.name).toBe(MOUNTAIN_NAME)
    expect(result.payload.finish).toBe(ref)
    const readback = await call('get_node', { id: 'wall_material_south' })
    expect(readback.error).toBeFalsy()
    expect(readback.payload).toMatchObject({
      node: { slots: { b: ref } },
      materials: { [datablock.id]: { material: EXPECTED_MOUNTAIN_MATERIAL } },
    })
    expect(Object.keys(registry())).toHaveLength(1)
    expectPreserved(before.nodes, bridge.getNodes())
    expect(bridge.getHistory()).toEqual({ pastCount: 1, futureCount: 0 })
    expect(bridge.undo()).toBe(1)
    expect(bridge.exportJSON()).toEqual(before)
    expect(bridge.redo()).toBe(1)
    expect(bridge.exportJSON()).toEqual(after)
    const serialized = JSON.stringify(after)
    bridge.setScene({}, [], { materials: {} })
    bridge.loadJSON(serialized)
    expect(nativePaintReadback(bridge.getNodes(), registry()).ref).toBe(ref)
    expectPreserved(before.nodes, bridge.getNodes())
  })

  test('next transported call sees existing registry and deduplicates rather than creating another datablock', async () => {
    expect((await call('paint', mountainPaint())).error).toBeFalsy()
    const first = nativePaintReadback(bridge.getNodes(), registry()).ref
    expect((await call('paint', mountainPaint(['wall_material_east']))).error).toBeFalsy()
    expect(nativePaintReadback(bridge.getNodes(), registry(), 'wall_material_east').ref).toBe(first)
    expect(Object.keys(registry())).toHaveLength(1)
    expect(
      (await call('paint', { targets: ['wall_material_north'], role: 'exterior', material: first }))
        .error,
    ).toBeFalsy()
    expect(nativePaintReadback(bridge.getNodes(), registry(), 'wall_material_north').ref).toBe(
      first,
    )
  })

  test('run_batch propagates upserts and same-batch registry with one history step', async () => {
    const before = bridge.exportJSON()
    const result = await call('run_batch', {
      calls: [
        { tool: 'paint', input: mountainPaint() },
        { tool: 'paint', input: mountainPaint(['wall_material_east']) },
      ],
    })
    expect(result.error).toBeFalsy()
    expect(result.payload).toMatchObject({ applied: 2, refused: 0 })
    expect(nativePaintReadback(bridge.getNodes(), registry()).ref).toBe(
      nativePaintReadback(bridge.getNodes(), registry(), 'wall_material_east').ref,
    )
    expect(Object.keys(registry())).toHaveLength(1)
    expect(bridge.getHistory()).toEqual({ pastCount: 1, futureCount: 0 })
    const after = bridge.exportJSON()
    bridge.undo()
    expect(bridge.exportJSON()).toEqual(before)
    bridge.redo()
    expect(bridge.exportJSON()).toEqual(after)
  })

  for (const [label, input] of [
    ['missing later target', mountainPaint(['wall_material_south', 'wall_missing'])],
    [
      'invalid later role',
      { ...mountainPaint(['wall_material_south', 'door_materials']), role: 'a' },
    ],
    [
      'dangling material',
      { targets: ['wall_material_south'], role: 'exterior', material: 'scene:mat_missing' },
    ],
    ['invalid PBR', { ...mountainPaint(), material: { properties: { roughness: 2 } } }],
    ['oversized name', { ...mountainPaint(), materialName: 'x'.repeat(121) }],
  ] as const) {
    test(`${label} is refused without transport-side partial edits or orphan data`, async () => {
      const before = bridge.exportJSON()
      expect((await call('paint', input)).error).toBe(true)
      expect(bridge.exportJSON()).toEqual(before)
      expect(bridge.getHistory()).toEqual({ pastCount: 0, futureCount: 0 })
    })
  }

  test('a later batch refusal leaves native registry and nodes untouched', async () => {
    const before = bridge.exportJSON()
    expect(
      (
        await call('run_batch', {
          calls: [
            { tool: 'paint', input: mountainPaint() },
            { tool: 'paint', input: mountainPaint(['wall_missing']) },
          ],
        })
      ).error,
    ).toBe(true)
    expect(bridge.exportJSON()).toEqual(before)
    expect(bridge.getHistory()).toEqual({ pastCount: 0, futureCount: 0 })
  })

  test('legacy catalog, nearest color and erase are still transported', async () => {
    const before = bridge.exportJSON()
    const target = { targets: ['wall_material_south'], role: 'b' }
    const catalog = await call('paint', { ...target, material: 'library:concrete-raw' })
    expect(catalog.error).toBeFalsy()
    expect(catalog.payload.finish).toBe('library:concrete-raw')
    const color = await call('paint', { ...target, color: '#71503a' })
    expect(color.error).toBeFalsy()
    expect(color.payload.finish).toMatch(/^library:/)
    expect(color.payload.note).toMatch(/nearest/i)
    const erase = await call('paint', { ...target, erase: true })
    expect(erase.error).toBeFalsy()
    expect(erase.payload.finish).toBe('default')
    const wall = bridge.getNodes().wall_material_south
    if (wall?.type !== 'wall') throw new Error('Wall lost')
    expect(wall.slots?.b).toBeUndefined()
    expect(Object.keys(registry())).toHaveLength(0)
    expectPreserved(before.nodes, bridge.getNodes())
  })
})
