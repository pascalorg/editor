import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { createAssetViewLoader, createFetchAssetViewIO } from '@pascal-app/core/agent-operations'
import { viewAssetsTool } from '@pascal-app/core/agent-tools'
import { type AssetInput, ItemNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { type PlanReadingHosts, registerSharedTools } from './shared-tools'

// view_assets over the MCP: the pictures come back as image content, the surfaces by name.
type Content = { type: string; text?: string; data?: string; mimeType?: string }
type Result = { isError?: boolean; content: Content[]; structuredContent?: Record<string, unknown> }

const ITEMS = join(import.meta.dir, '../../../../apps/editor/public/items')
const glb = (id: string) => new Uint8Array(readFileSync(join(ITEMS, id, 'model.glb')))
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

/** The library's files over `fetch`, with Range: the editor's own GLBs and a stand-in thumbnail. */
const files: Record<string, Uint8Array> = {
  'https://lib.test/single-bed.glb': glb('single-bed'),
  'https://lib.test/double-bed.glb': glb('double-bed'),
  'https://lib.test/sofa.glb': glb('sofa'),
}
for (const id of ['single-bed', 'double-bed', 'sofa']) files[`https://lib.test/${id}.png`] = PNG
const fetchImpl = (async (url: string, init?: RequestInit) => {
  const file = files[url]
  if (!file) return new Response('missing', { status: 404 })
  const type = url.endsWith('.glb') ? 'model/gltf-binary' : 'image/png'
  const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get('range') ?? '')
  return range
    ? new Response(file.slice(Number(range[1]), Number(range[2]) + 1), {
        status: 206,
        headers: { 'content-type': type },
      })
    : new Response(file, { headers: { 'content-type': type } })
}) as unknown as typeof fetch

const item = (id: string, name: string, dimensions: [number, number, number]): AssetInput => ({
  id,
  name,
  category: 'furniture',
  tags: [],
  thumbnail: `https://lib.test/${id}.png`,
  src: `https://lib.test/${id}.glb`,
  dimensions,
})
const LIBRARY = [
  item('single-bed', 'Single Bed', [1.5, 0.7, 2.5]),
  item('double-bed', 'Double Bed', [2, 0.8, 2.5]),
  item('sofa', 'Sofa', [2.5, 0.8, 1.5]),
]

async function connect(catalog?: AssetInput[], hosts: PlanReadingHosts = {}) {
  const bridge = new SceneBridge()
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerSharedTools(
    server,
    createSceneOperations({ bridge }),
    catalog ? async () => catalog : undefined,
    hosts,
  )
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as Result
  return { bridge, client, call }
}

const fetched = (): PlanReadingHosts => ({
  assetViews: createAssetViewLoader(createFetchAssetViewIO({ fetchImpl })),
})

describe('view_assets over the MCP', () => {
  test('is listed with core’s description, read-only', async () => {
    const { client } = await connect(LIBRARY, fetched())
    const tool = (await client.listTools()).tools.find((entry) => entry.name === 'view_assets')
    expect(tool?.description).toBe(viewAssetsTool.description)
    expect(tool?.annotations?.readOnlyHint).toBe(true)
  })

  test('one item: a label and its picture as image content, the surfaces named', async () => {
    const { call } = await connect(LIBRARY, fetched())
    const result = await call('view_assets', { ids: ['single-bed'] })
    expect(result.isError).toBeFalsy()
    expect(result.content.map((part) => part.type)).toEqual(['text', 'text', 'image'])
    const [summary, label, image] = result.content
    expect(JSON.parse(summary!.text!)).toMatchObject({
      shown: 1,
      items: [
        { id: 'single-bed', surfaces: ['sheet', 'pillow', 'matress', 'frame'], picture: true },
      ],
    })
    expect(label!.text).toBe(
      'Single Bed (single-bed): furniture, 1.5 × 0.7 × 2.5 m; surfaces: sheet, pillow, matress, frame.',
    )
    expect(image!.mimeType).toBe('image/png')
    expect(Buffer.from(image!.data!, 'base64')).toEqual(Buffer.from(PNG))
    // The bytes ride in the image part only, not twice in the structured result.
    expect(JSON.stringify(result.structuredContent)).not.toContain(image!.data!)
    expect(result.structuredContent).not.toHaveProperty('previews')
  })

  test('six items: six labelled pictures in the order asked', async () => {
    const six = Array.from({ length: 6 }, (_, i) => item(`sofa-${i}`, `Sofa ${i}`, [1, 1, 1]))
    const host: PlanReadingHosts = {
      assetViews: async (subjects) =>
        Object.fromEntries(
          subjects.map((subject) => [
            subject.id,
            { picture: 'data:image/webp;base64,AAAA', surfaces: ['body'] },
          ]),
        ),
    }
    const { call } = await connect(six, host)
    const result = await call('view_assets', { ids: six.map((entry) => entry.id).reverse() })
    expect(result.content.filter((part) => part.type === 'image')).toHaveLength(6)
    const labels = result.content.filter((part) => part.type === 'text').slice(1)
    expect(labels.map((part) => part.text!.split(' (')[0])).toEqual([
      'Sofa 5',
      'Sofa 4',
      'Sofa 3',
      'Sofa 2',
      'Sofa 1',
      'Sofa 0',
    ])
  })

  test('seven ids are refused by the contract', async () => {
    const { call } = await connect(LIBRARY, fetched())
    const result = await call('view_assets', { ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })
    expect(result.isError).toBe(true)
  })

  test('an unknown id is refused with the fact, nothing is shown', async () => {
    const { call } = await connect(LIBRARY, fetched())
    const result = await call('view_assets', { ids: ['sofa', 'throne'] })
    expect(result.isError).toBe(true)
    expect(result.content.every((part) => part.type === 'text')).toBe(true)
    const payload = JSON.parse(result.content[0]!.text!)
    expect(payload.code).toBe('unknown_asset')
    expect(payload.error).toContain('"throne" is not in the item library')
  })

  test('an item whose model names no surface says so', async () => {
    const { call } = await connect(LIBRARY, fetched())
    const result = await call('view_assets', { ids: ['double-bed'] })
    expect(result.content[1]!.text).toContain('no named surfaces')
    expect(JSON.parse(result.content[0]!.text!).items[0].surfaces).toEqual([])
  })

  test('a picture that cannot be fetched leaves the text, and says why', async () => {
    const lost = { ...LIBRARY[2]!, id: 'lost', thumbnail: 'https://lib.test/lost.png' }
    const { call } = await connect([lost], fetched())
    const result = await call('view_assets', { ids: ['lost'] })
    expect(result.content.map((part) => part.type)).toEqual(['text'])
    const payload = JSON.parse(result.content[0]!.text!)
    expect(payload.shown).toBe(0)
    expect(payload.note).toContain('1 of 1 items show no picture here')
    expect(payload.items[0].unavailable).toContain(
      'its picture could not be fetched (the file answered 404)',
    )
  })

  test('a standalone server’s built-in list has no host to fetch from: text only, and it says so', async () => {
    const { call } = await connect()
    const result = await call('view_assets', { ids: ['double-bed'] })
    expect(result.isError).toBeFalsy()
    expect(result.content.map((part) => part.type)).toEqual(['text'])
    const payload = JSON.parse(result.content[0]!.text!)
    expect(payload).toMatchObject({
      shown: 0,
      items: [{ id: 'double-bed', dimensions: [2, 0.8, 2.5], surfaces: null, picture: false }],
    })
    expect(payload.note).toContain('show no picture here')
  })
})

describe('paint on a catalog item without a role, over the MCP', () => {
  const placed = (assetId: string) =>
    ItemNode.parse({
      id: 'item_bed',
      asset: { ...LIBRARY.find((entry) => entry.id === assetId)!, tags: undefined },
    })

  test('lists the surfaces its model has', async () => {
    const { bridge, call } = await connect(LIBRARY, fetched())
    bridge.setScene({ item_bed: placed('single-bed') } as never, ['item_bed'] as never)
    const result = await call('paint', {
      targets: ['item_bed'],
      material: 'library:preset-softwhite',
    })
    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0]!.text!)
    expect(payload.code).toBe('unknown_role')
    expect(payload.error).toContain('its surfaces: sheet, pillow, matress, frame')
  })

  test('with a role it paints and reads nothing', async () => {
    let reads = 0
    const { bridge, call } = await connect(LIBRARY, {
      assetViews: async () => {
        reads += 1
        return {}
      },
    })
    bridge.setScene({ item_bed: placed('single-bed') } as never, ['item_bed'] as never)
    const result = await call('paint', {
      targets: ['item_bed'],
      role: 'sheet',
      material: 'library:preset-softwhite',
    })
    expect(result.isError).toBeFalsy()
    expect(reads).toBe(0)
  })

  test('inside a batch the refusal lists them too', async () => {
    const { bridge, call } = await connect(LIBRARY, fetched())
    bridge.setScene({ item_bed: placed('single-bed') } as never, ['item_bed'] as never)
    const result = await call('run_batch', {
      calls: [
        { tool: 'paint', input: { targets: ['item_bed'], material: 'library:preset-softwhite' } },
      ],
    })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0]!.text!).error).toContain(
      'its surfaces: sheet, pillow, matress, frame',
    )
  })

  test('on a host that cannot read the model, the refusal is as it was', async () => {
    const { bridge, call } = await connect(LIBRARY, { assetViews: async () => ({}) })
    bridge.setScene({ item_bed: placed('single-bed') } as never, ['item_bed'] as never)
    const result = await call('paint', {
      targets: ['item_bed'],
      material: 'library:preset-softwhite',
    })
    expect(JSON.parse(result.content[0]!.text!).error).toBe(
      "Item item_bed's surfaces are its model's: name one as role.",
    )
  })
})
