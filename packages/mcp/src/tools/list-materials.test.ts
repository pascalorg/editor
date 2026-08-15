import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getCatalogMaterialById, parseMaterialRef } from '@pascal-app/core'
import useScene from '@pascal-app/core/store'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerListMaterials } from './list-materials'

type Payload = {
  materials: Array<{ ref: string; label: string; category: string; surfaces?: string[] }>
  categories: Array<{ category: string; count: number }>
  total: number
  sceneMaterials: Array<{ ref: string; name: string }>
}

describe('list_materials', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerListMaterials(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  async function call(args: Record<string, unknown> = {}): Promise<Payload> {
    const result = await client.callTool({ name: 'list_materials', arguments: args })
    return JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text) as Payload
  }

  // The whole point of the tool: every ref it hands out must resolve, or the
  // agent paints with an id that silently renders as nothing.
  test('every ref returned is a real catalog entry', async () => {
    const payload = await call({ limit: 200 })

    expect(payload.materials.length).toBeGreaterThan(0)
    for (const material of payload.materials) {
      const parsed = parseMaterialRef(material.ref)
      expect(parsed?.kind).toBe('library')
      expect(getCatalogMaterialById(parsed?.id)).toBeDefined()
    }
  })

  test('caps the page but reports the true match count', async () => {
    const payload = await call({ limit: 5 })

    expect(payload.materials).toHaveLength(5)
    expect(payload.total).toBeGreaterThan(5)
  })

  test('filters to one category', async () => {
    const payload = await call({ category: 'wood', limit: 200 })

    expect(payload.materials.length).toBeGreaterThan(0)
    expect(payload.materials.every((m) => m.category === 'wood')).toBe(true)
  })

  // Flat colours declare no surfaces; treating that as "matches nothing" would
  // hide them from every filtered ask.
  test('a surface filter keeps universal finishes as well as declared ones', async () => {
    const payload = await call({ surface: 'floor', limit: 200 })

    expect(payload.materials.length).toBeGreaterThan(0)
    for (const material of payload.materials) {
      if (material.surfaces) expect(material.surfaces).toContain('floor')
    }
    expect(payload.materials.some((m) => m.surfaces === undefined)).toBe(true)
  })

  test('matches a text query against the label', async () => {
    const payload = await call({ query: 'chrome', limit: 200 })

    expect(payload.materials.length).toBeGreaterThan(0)
    expect(
      payload.materials.every((m) => `${m.label} ${m.ref}`.toLowerCase().includes('chrome')),
    ).toBe(true)
  })

  test('rejects a category that is not in the catalog', async () => {
    await expect(call({ category: 'not_a_category' })).rejects.toThrow()
  })

  // The scene's own palette is the half no catalog filter can reach, and the
  // one the user made deliberately.
  test('reports the scene palette alongside the catalog', async () => {
    useScene.getState().addSceneMaterial({
      id: 'mat_brand',
      name: 'Brand red',
      material: { color: '#cc0000' } as never,
    })

    const payload = await call({ category: 'wood', limit: 1 })

    expect(payload.sceneMaterials).toEqual([{ ref: 'scene:mat_brand', name: 'Brand red' }])
  })
})
