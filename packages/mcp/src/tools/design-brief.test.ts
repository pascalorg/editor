import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { assetCatalogSource } from '@pascal-app/core/agent-operations'
import { DESIGN_EXAMPLE } from '@pascal-app/core/procedural-items'
import {
  type AnyNode,
  type AssetInput,
  type CompiledGeometryScript,
  GeometryArtifactManifest,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'
import type { GeometryScriptHost } from './add-object'

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

const asset = (
  id: string,
  category = 'furniture',
  extra: Partial<AssetInput> = {},
): AssetInput => ({
  id,
  name: id,
  category,
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions: [0.5, 0.5, 0.4],
  ...extra,
})
const CATALOG = [
  ...['double-bed', 'bedside-table', 'dresser', 'closet', 'sofa'].map((id) => asset(id)),
  asset('toilet', 'toilets'),
  asset('fridge', 'kitchen-appliances'),
  asset('palm', 'outdoor', { tags: ['tree', 'plant', 'garden'] }),
]

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

const dressed = {
  textiles: ['linen bedding', 'two cushions'],
  light: ['two bedside lamps'],
  windows: ['linen curtains'],
  walls: ['framed art above the bed'],
  floor: ['a wool rug'],
  plants: ['a plant by the window'],
  objects: ['books on the nightstands'],
  smallFurniture: { none: 'the room is small' },
}
const nothing = Object.fromEntries(
  ['textiles', 'light', 'windows', 'walls', 'floor', 'plants', 'objects', 'smallFurniture'].map(
    (layer) => [layer, { none: 'the request limits the pieces' }],
  ),
)

const openAxis = (design: string) => ({ kind: 'open' as const, design })
const axes = {
  action: openAxis('the work the request calls for, designed as a whole'),
  size: openAxis('sizes chosen to fit the rooms they serve'),
  form: {
    ...openAxis('a single block composed to fit the rooms it holds'),
    massing: { plan: 'rectangle' as const, volumes: 1, heights: 'one' as const },
  },
  facade: {
    ...openAxis('a plain render facade with a free rhythm of windows'),
    treatment: { cladding: ['render' as const], rhythm: 'free' as const },
  },
  pieces: openAxis('the pieces each room needs, designed one by one'),
  openings: openAxis('openings placed for light and passage room by room'),
  style: openAxis('each piece designed in one calm character throughout'),
  materials: openAxis('materials and finishes chosen surface by surface'),
  dressing: openAxis('the rooms dressed lived-in, stated in beyond'),
}

const rooms = [
  {
    name: 'Bedroom',
    use: 'bedroom' as const,
    distinct: 'the parents’ room, calm and oak, with its own bathroom',
    finishes: { floor: 'oak parquet', walls: 'limewashed white', tiled: false, skirting: true },
    pieces: ['a king bed', 'two nightstands'],
  },
]

const brief = (source: 'open' | 'catalog' | 'brand', extra: Record<string, unknown> = {}) => ({
  axes,
  rooms,
  source,
  ...(source === 'open'
    ? {}
    : { sourceQuote: source === 'catalog' ? 'the catalog only' : 'IKEA furniture only' }),
  vision: 'A calm room of oak and linen.',
  beyond: dressed,
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
  // A library searched where it is kept: the gate reads the tags of the pieces a call names.
  const catalog = assetCatalogSource(CATALOG)

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
      Object.values(bridge.getNodes()).filter((node) =>
        ['item', 'procedural-item'].includes(node.type),
      ),
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
    expect(placed.payload.error).toContain(
      'The brief left the source open: double-bed cannot be placed from the catalog, pieces are made. Technical equipment (sanitaryware, appliances) and plants are placed from the catalog under an open source;',
    )
    // The refusal is kept with the session: a retry, by any placing tool, is answered briefly.
    const again = await call('place_items', {
      items: [{ assetId: 'double-bed', x: 2, z: 2 }],
      levelId,
    })
    expect(again.payload.error).toBe(
      "Already refused, the brief's source is open: double-bed. Technical equipment and plants are placed from the catalog; add_object and place_design make the other pieces.",
    )
    const set = await call('furnish_room', { zoneId, roomType: 'bedroom' })
    expect(set.payload.code).toBe('brief_source_open')
  })

  test('an open brief: a toilet and a fridge are placed from the catalog', async () => {
    await call('design_brief', brief('open'))
    const placed = await call('place_items', {
      items: [
        { assetId: 'toilet', x: 1, z: 1 },
        { assetId: 'fridge', x: 3, z: 1 },
      ],
      levelId,
    })
    expect(placed.result.isError).toBeFalsy()
    expect(Object.values(bridge.getNodes()).filter((node) => node.type === 'item')).toHaveLength(2)
  })

  test('an open brief: a palm is placed from the catalog', async () => {
    await call('design_brief', brief('open'))
    const placed = await call('place_items', {
      items: [{ assetId: 'palm', x: 3, z: 4 }],
      levelId,
    })
    expect(placed.result.isError).toBeFalsy()
    expect(Object.values(bridge.getNodes()).some((node) => node.type === 'item')).toBe(true)
  })

  test('an open brief: a sofa is still refused', async () => {
    await call('design_brief', brief('open'))
    const refused = await call('place_items', {
      items: [{ assetId: 'sofa', x: 1, z: 1 }],
      levelId,
    })
    expect(refused.payload.code).toBe('brief_source_open')
    expect(Object.values(bridge.getNodes()).some((node) => node.type === 'item')).toBe(false)
  })

  test('an open brief: a batch places the fridge and refuses the sofa', async () => {
    await call('design_brief', brief('open'))
    const batch = await call('run_batch', {
      calls: [
        { tool: 'place_in_room', input: { assetId: 'fridge', zoneId } },
        { tool: 'place_in_room', input: { assetId: 'sofa', zoneId } },
      ],
      onRefusal: 'skip',
    })
    expect(batch.result.isError).toBeFalsy()
    expect(batch.payload).toMatchObject({
      applied: 1,
      refused: 1,
      calls: [
        { index: 0, status: 'ok' },
        { index: 1, status: 'refused', code: 'brief_source_open' },
      ],
    })
  })

  test('a catalog source places the toilet, and an asIs a model still sends is not kept', async () => {
    const sent = await call('design_brief', {
      ...brief('open'),
      asIs: [{ assetId: 'toilet', reason: 'technical equipment' }],
    })
    expect(sent.payload.status).toBe('recorded')
    expect(bridge.agentSession.read().designBrief).not.toHaveProperty('asIs')
    await call('design_brief', brief('catalog'))
    const wc = await call('place_items', { items: [{ assetId: 'toilet', x: 1, z: 1 }], levelId })
    expect(wc.result.isError).toBeFalsy()
    expect(Object.values(bridge.getNodes()).some((node) => node.type === 'item')).toBe(true)
  })

  test('a source other than open must quote the request; the quote is required here and not checked', async () => {
    const bare = await call('design_brief', { ...brief('catalog'), sourceQuote: undefined })
    expect(bare.payload.code).toBe('source_quote_required')
    expect(bridge.agentSession.read().designBrief).toBeUndefined()
    const unnamed = await call('design_brief', brief('catalog', { sourceQuote: 'a house' }))
    expect(unnamed.payload.code).toBe('source_not_named')
    expect(bridge.agentSession.read().designBrief).toBeUndefined()
    const quoted = await call('design_brief', brief('catalog', { sourceQuote: 'que du catalogue' }))
    expect(quoted.payload.brief).toMatchObject({
      source: 'catalog',
      sourceQuote: 'que du catalogue',
    })
  })

  test('a dressing left open owes the layers: a two-piece beyond is refused, naming the empty layers; a bounded dressing accepts none', async () => {
    const thin = await call('design_brief', {
      ...brief('open'),
      beyond: { ...nothing, floor: ['a wool rug'], light: ['a soft ceiling pendant'] },
    })
    expect(thin.result.isError).toBe(true)
    expect(thin.payload.code).toBe('beyond_too_thin')
    expect(String(thin.payload.error)).toContain(
      'textiles, windows, walls, plants, objects, small furniture say none.',
    )
    expect(bridge.agentSession.read().designBrief).toBeUndefined()
    const full = await call('design_brief', brief('open'))
    expect(full.payload.status).toBe('recorded')
    expect(full.payload.dressing).toHaveLength(8)
    const limited = await call('design_brief', {
      ...brief('open'),
      axes: {
        ...axes,
        pieces: {
          kind: 'bounded',
          quote: 'only a bed',
          reading: 'a bed, and nothing else',
          extent: 'exact',
        },
        dressing: {
          kind: 'bounded',
          quote: 'only a bed',
          reading: 'the request limits the pieces to the bed',
        },
      },
      beyond: nothing,
    })
    expect(limited.payload.status).toBe('recorded')
    expect(limited.payload.dressing).toEqual([])
  })

  test('beyond is required: a brief without it is not accepted', async () => {
    const { result } = await call('design_brief', { ...brief('open'), beyond: undefined })
    expect(result.isError).toBe(true)
    expect(bridge.agentSession.read().designBrief).toBeUndefined()
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

  test('run_batch keeps the brief gate: stop applies nothing, skip applies the other calls, and furnishing runs only after a brief', async () => {
    const before = structuredClone(bridge.getNodes())
    const [firstWall, secondWall] = Object.values(before).filter((node) => node.type === 'wall')
    if (!(firstWall && secondWall)) throw new Error('The room needs two walls to delete')
    const gatedCall = { tool: 'place_design', input: sofa() }
    const calls = [
      { tool: 'delete_node', input: { id: firstWall.id } },
      gatedCall,
      { tool: 'delete_node', input: { id: secondWall.id } },
    ]
    for (const policy of [{}, { onRefusal: 'stop' }]) {
      const { result, payload } = await call('run_batch', { calls, ...policy })
      expect(result.isError).toBe(true)
      expect(payload).toMatchObject({
        code: 'batch_call_refused',
        index: 1,
        tool: 'place_design',
        refusal: 'design_brief_required',
      })
      expect(bridge.getNodes()).toEqual(before)
    }
    const skipped = await call('run_batch', { calls, onRefusal: 'skip' })
    expect(skipped.result.isError).toBeFalsy()
    expect(skipped.payload).toMatchObject({
      status: 'applied',
      applied: 2,
      refused: 1,
      calls: [
        { index: 0, tool: 'delete_node', status: 'ok' },
        {
          index: 1,
          tool: 'place_design',
          status: 'refused',
          code: 'design_brief_required',
          error: expect.stringContaining('design_brief records what the request fixes'),
        },
        { index: 2, tool: 'delete_node', status: 'ok' },
      ],
    })
    expect(bridge.getNodes()[firstWall.id]).toBeUndefined()
    expect(bridge.getNodes()[secondWall.id]).toBeUndefined()
    expect(
      Object.values(bridge.getNodes()).filter((node) =>
        ['item', 'procedural-item'].includes(node.type),
      ),
    ).toEqual([])
    expect(compiles).toBe(0)
    expect(bridge.agentSession.read().designBrief).toBeUndefined()

    await call('design_brief', brief('open'))
    const batch = await call('run_batch', {
      calls: [gatedCall, { tool: 'add_object', input: object }],
    })
    expect(batch.result.isError).toBeFalsy()
    expect(batch.payload).toMatchObject({ status: 'applied', applied: 2, refused: 0 })
    expect(compiles).toBe(1)
    expect(Object.values(bridge.getNodes()).some((node) => node.type === 'procedural-item')).toBe(
      true,
    )
    const refused = await call('run_batch', {
      calls: [{ tool: 'place_in_room', input: { assetId: 'double-bed', zoneId } }],
    })
    expect(refused.result.isError).toBe(true)
    expect(refused.payload).toMatchObject({
      code: 'batch_call_refused',
      refusal: 'brief_source_open',
    })
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
