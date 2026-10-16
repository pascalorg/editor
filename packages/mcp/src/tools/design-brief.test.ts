import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  type AnyNode,
  type AssetInput,
  type CompiledGeometryScript,
  GeometryArtifactManifest,
} from '@pascal-app/core/schema'
import { DESIGN_EXAMPLE } from '@pascal-app/core/procedural-items'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'
import type { GeometryScriptHost } from './add-object'
import type { AssetCatalog } from './asset-catalog'

/**
 * The owner's bedroom prompt, over MCP (16 Oct): a 4 by 5 m bedroom with a double bed, two
 * nightstands, a wardrobe, one window, one door. furnish_room answered it in one call, no brief and
 * no view. The session's brief now decides what places and what makes.
 */
type Result = {
  isError?: boolean
  content: Array<{ type: string; text: string }>
  structuredContent?: Record<string, unknown>
}

const asset = (id: string): AssetInput => ({
  id,
  name: id,
  category: 'furniture',
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions: [0.5, 0.5, 0.4],
})
const CATALOG = ['double-bed', 'bedside-table', 'dresser', 'closet', 'toilet'].map(asset)

const compiledBox = (): CompiledGeometryScript => ({
  sha256: 'a'.repeat(64),
  script: 'b'.repeat(64),
  language: 'three',
  mount: 'floor',
  params: {},
  manifest: GeometryArtifactManifest.parse({
    bounds: { min: [-0.5, 0, -0.5], max: [0.5, 0.7, 0.5] },
    triangles: 12,
  }),
})

const brief = (source: 'open' | 'catalog' | 'brand', extra: Record<string, unknown> = {}) => ({
  fixed: ['a 4 by 5 m bedroom', 'a double bed', 'two nightstands', 'a wardrobe'],
  open: ['style', 'the form and finish of each piece'],
  source,
  vision: 'A calm room of oak and linen.',
  ...extra,
})

describe('the design brief over MCP', () => {
  let directory: string
  let bridge: SceneBridge
  let client: Client
  let compiles: number
  let levelId: string
  let zoneId: string

  const host: GeometryScriptHost = {
    compile: async () => {
      compiles++
      return { ...compiledBox(), glb: new Uint8Array() }
    },
    storeArtifact: async ({ sha256 }) => sha256,
    readArtifact: async () => null,
  }
  const catalog: AssetCatalog = async () => CATALOG

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as Result
    const payload =
      result.structuredContent ?? (JSON.parse(result.content[0]!.text) as Record<string, unknown>)
    return { result, payload }
  }
  const room = async () => {
    const created = await call('create_room', {
      name: 'Bedroom',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 5],
        [0, 5],
      ],
    })
    expect(created.result.isError).toBeFalsy()
  }
  const sofa = () => ({ design: DESIGN_EXAMPLE, hostId: levelId, position: [2, 0, 2] })
  const object = {
    code: 'export default () => null',
    name: 'Oak bed',
    category: 'bed',
    reason: 'a bed of the brief’s own',
  }

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pascal-mcp-brief-'))
    compiles = 0
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    bridge.setActiveScene({ id: 'scene_brief', name: 'Brief' } as never)
    const server = createPascalMcpServer({
      bridge,
      store: new SqliteSceneStore({ databasePath: join(directory, 'pascal.db') }),
      geometryScripts: host,
      catalog,
    })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    await room()
    const nodes = Object.values(bridge.getNodes()) as AnyNode[]
    levelId = nodes.find((node) => node.type === 'level')!.id
    zoneId = nodes.find((node) => node.type === 'zone')!.id
  })

  afterEach(async () => {
    await client.close()
    rmSync(directory, { recursive: true, force: true })
  })

  test('before a brief nothing is placed or made, and the room, its finishes and the catalog’s reads are open', async () => {
    const refused = [
      await call('place_items', { items: [{ assetId: 'double-bed', x: 1, z: 1 }], levelId }),
      await call('furnish_room', { zoneId, roomType: 'bedroom' }),
      await call('place_in_room', { assetId: 'double-bed', zoneId }),
      await call('place_design', sofa()),
      await call('add_object', object),
      await call('place_design', { design: {}, hostId: levelId, position: [1, 0, 1] }),
    ]
    for (const { result, payload } of refused) {
      expect(result.isError).toBe(true)
      expect(payload.code).toBe('design_brief_required')
      expect(String(payload.error)).toContain('design_brief records what the request fixes')
    }
    expect(compiles).toBe(0)
    expect(
      Object.values(bridge.getNodes()).filter((node) => ['item', 'procedural-item'].includes(node.type)),
    ).toEqual([])
    for (const [name, args] of [
      ['search_assets', { queries: [{ query: 'bed' }] }],
      ['verify_scene', {}],
      ['search_materials', { queries: [{ query: 'oak' }] }],
    ] as const)
      expect((await call(name, args)).result.isError).toBeFalsy()
  })

  test('an open brief: place_design and add_object make the pieces; a bed from the catalog is refused with the fact', async () => {
    const { result, payload } = await call('design_brief', brief('open'))
    expect(result.isError).toBeFalsy()
    expect(payload.status).toBe('recorded')
    expect(bridge.agentSession.read().designBrief?.source).toBe('open')

    expect((await call('place_design', sofa())).result.isError).toBeFalsy()
    expect((await call('add_object', object)).result.isError).toBeFalsy()
    expect(compiles).toBe(1)

    const placed = await call('place_items', {
      items: [{ assetId: 'double-bed', x: 1, z: 1 }],
      levelId,
    })
    expect(placed.payload.code).toBe('brief_source_open')
    expect(placed.payload.error).toBe(
      "The brief left the source open: double-bed can be made with add_object or place_design (view_assets shows the catalog's for reference), or named in the brief's asIs with a reason.",
    )
    const set = await call('furnish_room', { zoneId, roomType: 'bedroom' })
    expect(set.payload.code).toBe('brief_source_open')
  })

  test('an open brief: a WC named in asIs with its reason is placed as it is', async () => {
    await call(
      'design_brief',
      brief('open', { asIs: [{ assetId: 'toilet', reason: 'technical equipment' }] }),
    )
    const wc = await call('place_items', { items: [{ assetId: 'toilet', x: 1, z: 1 }], levelId })
    expect(wc.result.isError).toBeFalsy()
    expect(Object.values(bridge.getNodes()).some((node) => node.type === 'item')).toBe(true)
  })

  test('a catalog brief (“IKEA only”): furnish_room and place_items answer', async () => {
    const written = await call('design_brief', brief('brand', { brand: 'IKEA' }))
    expect(written.payload.brief).toMatchObject({ source: 'brand', brand: 'IKEA' })
    expect((await call('furnish_room', { zoneId, roomType: 'bedroom' })).result.isError).toBeFalsy()
    expect(
      (await call('place_items', { items: [{ assetId: 'dresser', x: 3, z: 4 }], levelId })).result
        .isError,
    ).toBeFalsy()
  })

  test('run_batch holding a gated call is refused as a whole, whatever onRefusal says, and nothing is applied', async () => {
    const before = Object.keys(bridge.getNodes()).length
    const calls = [
      { tool: 'delete_node', input: { id: 'wall_missing' } },
      { tool: 'place_design', input: sofa() },
    ]
    for (const onRefusal of ['stop', 'skip'] as const) {
      const { result, payload } = await call('run_batch', { calls, onRefusal })
      expect(result.isError).toBe(true)
      expect(payload.code).toBe('design_brief_required')
      expect(String(payload.error)).toContain("The batch's call 2 (place_design) is refused")
    }
    expect(Object.keys(bridge.getNodes()).length).toBe(before)
    await call('design_brief', brief('open'))
    const batch = await call('run_batch', {
      calls: [calls[1]!, { tool: 'add_object', input: object }],
    })
    expect(batch.result.isError).toBeFalsy()
    expect(batch.payload).toMatchObject({ status: 'applied', applied: 2, refused: 0 })
    const refused = await call('run_batch', {
      calls: [{ tool: 'place_in_room', input: { assetId: 'double-bed', zoneId } }],
    })
    expect(refused.payload.code).toBe('brief_source_open')
  })

  test('the brief is the session’s: the next brief replaces it, a scene load starts the session anew', async () => {
    await call('design_brief', brief('open'))
    expect(
      (await call('place_items', { items: [{ assetId: 'double-bed', x: 1, z: 1 }], levelId }))
        .result.isError,
    ).toBe(true)
    await call('design_brief', brief('catalog'))
    expect(bridge.agentSession.read().designBrief?.source).toBe('catalog')
    expect(
      (await call('place_items', { items: [{ assetId: 'double-bed', x: 1, z: 1 }], levelId }))
        .result.isError,
    ).toBeFalsy()
    bridge.setScene({}, [])
    expect(bridge.agentSession.read().designBrief).toBeUndefined()
    bridge.loadDefault()
    const level = (Object.values(bridge.getNodes()) as AnyNode[]).find(
      (node) => node.type === 'level',
    )!
    const after = await call('place_design', { ...sofa(), hostId: level.id })
    expect(after.payload.code).toBe('design_brief_required')
  })

  test('a brand with no name is refused and records nothing', async () => {
    const { result, payload } = await call('design_brief', brief('brand'))
    expect(result.isError).toBe(true)
    expect(payload.code).toBe('brand_required')
    expect(bridge.agentSession.read().designBrief).toBeUndefined()
  })

  test('editing an object that stands is not placing one: it needs no brief', async () => {
    await call('design_brief', brief('open'))
    const made = await call('add_object', object)
    const nodeId = made.payload.nodeId as string
    // A scene load starts another session: no brief any more, the object stands.
    bridge.setScene(bridge.getNodes() as never, bridge.getRootNodeIds() as never)
    expect(bridge.agentSession.read().designBrief).toBeUndefined()
    const edit = await call('add_object', { nodeId, code: object.code, reason: 'wider' })
    expect(edit.result.isError).toBeFalsy()
    expect((await call('add_object', object)).payload.code).toBe('design_brief_required')
  })
})
