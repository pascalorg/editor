import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { viewAssetsTool } from '../agent-tools'
import { ItemNode } from '../schema'
import {
  assetViewNeeds,
  assetViewsReadCatalog,
  createAssetViewLoader,
  createFetchAssetViewIO,
  readGlbSurfaces,
} from './asset-views'

// The editor's own items: real GLBs, whose surfaces are their `slot_<id>` materials.
const ITEMS = join(import.meta.dir, '../../../../apps/editor/public/items')
const glb = (id: string) => new Uint8Array(readFileSync(join(ITEMS, id, 'model.glb')))

/** A byte-range reader over a file, counting what it was asked for. */
function ranges(bytes: Uint8Array) {
  const asked: [number, number][] = []
  return {
    asked,
    read: async (start: number, end: number) => {
      asked.push([start, end])
      return bytes.slice(start, end)
    },
  }
}

describe('the surfaces of a GLB, from its JSON chunk', () => {
  test('a bed names its slot materials, in two small reads', async () => {
    const file = glb('single-bed')
    const source = ranges(file)
    expect(await readGlbSurfaces(source.read)).toEqual(['sheet', 'pillow', 'matress', 'frame'])
    expect(source.asked).toHaveLength(2)
    expect(source.asked[0]).toEqual([0, 20])
    const bytes = source.asked.reduce((sum, [start, end]) => sum + end - start, 0)
    expect(bytes).toBeLessThan(file.byteLength)
  })

  test('a model whose materials are not slot_ ones has no surfaces: an empty list, not a failure', async () => {
    // double-bed's one material is unnamed for painting.
    expect(await readGlbSurfaces(ranges(glb('double-bed')).read)).toEqual([])
  })

  test('a Blender numeric suffix is dropped, and a repeated slot is listed once', async () => {
    expect(await readGlbSurfaces(ranges(glb('barbell')).read)).toEqual(['weights', 'bar'])
  })

  test('a file that is not a GLB is refused, not guessed', async () => {
    const text = new TextEncoder().encode('<html>not a model at all, only a page</html>')
    await expect(readGlbSurfaces(ranges(text).read)).rejects.toThrow('Not a GLB')
    await expect(readGlbSurfaces(ranges(new Uint8Array(4)).read)).rejects.toThrow('shorter')
  })
})

/** A `fetch` that serves files by URL, honouring `Range` or not as asked. */
function library(files: Record<string, Uint8Array>, { honoursRange = true } = {}) {
  const calls: { url: string; range: string | null }[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range')
    calls.push({ url, range })
    const file = files[url]
    if (!file) return new Response('missing', { status: 404 })
    const type = url.endsWith('.glb')
      ? 'model/gltf-binary'
      : url.endsWith('.txt')
        ? 'text/plain'
        : 'image/png'
    const match = range && honoursRange ? /bytes=(\d+)-(\d+)/.exec(range) : null
    return match
      ? new Response(file.slice(Number(match[1]), Number(match[2]) + 1), {
          status: 206,
          headers: { 'content-type': type },
        })
      : new Response(file, { status: 200, headers: { 'content-type': type } })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe('the loader a host builds', () => {
  const files = {
    'https://lib.test/single-bed.glb': glb('single-bed'),
    'https://lib.test/single-bed.png': PNG,
    'https://lib.test/double-bed.glb': glb('double-bed'),
  }
  const bed = {
    id: 'single-bed',
    src: 'https://lib.test/single-bed.glb',
    thumbnail: 'https://lib.test/single-bed.png',
  }

  test('reads surfaces by range and the picture whole, and caches the surfaces per model', async () => {
    const { calls, fetchImpl } = library(files)
    const load = createAssetViewLoader(createFetchAssetViewIO({ fetchImpl }))
    const first = await load([bed])
    expect(first['single-bed']?.surfaces).toEqual(['sheet', 'pillow', 'matress', 'frame'])
    expect(first['single-bed']?.picture).toBe(
      `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`,
    )
    expect(first['single-bed']?.unavailable).toBeUndefined()
    expect(calls.filter((call) => call.range)).toHaveLength(2)
    await load([bed])
    expect(calls.filter((call) => call.range)).toHaveLength(2)
    expect(calls.filter((call) => !call.range)).toHaveLength(2)
  })

  test('surfaces only: no picture is fetched', async () => {
    const { calls, fetchImpl } = library(files)
    const load = createAssetViewLoader(createFetchAssetViewIO({ fetchImpl }))
    const facts = await load([bed], { pictures: false })
    expect(facts['single-bed']).toEqual({ surfaces: ['sheet', 'pillow', 'matress', 'frame'] })
    expect(calls.every((call) => call.range)).toBe(true)
  })

  test('a server that ignores Range still gives the same surfaces', async () => {
    const { fetchImpl } = library(files, { honoursRange: false })
    const load = createAssetViewLoader(createFetchAssetViewIO({ fetchImpl }))
    expect((await load([bed], { pictures: false }))['single-bed']?.surfaces).toEqual([
      'sheet',
      'pillow',
      'matress',
      'frame',
    ])
  })

  test('the picture goes through the host’s own resize', async () => {
    const { fetchImpl } = library(files)
    const sizes: number[] = []
    const load = createAssetViewLoader(
      createFetchAssetViewIO({
        fetchImpl,
        resizePicture: async (bytes) => {
          sizes.push(bytes.byteLength)
          return { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/webp' }
        },
      }),
    )
    expect((await load([bed]))['single-bed']?.picture).toBe('data:image/webp;base64,AQID')
    expect(sizes).toEqual([PNG.byteLength])
  })

  test('what cannot be read is named, and a failed read is tried again next time', async () => {
    const { calls, fetchImpl } = library({ 'https://lib.test/double-bed.glb': glb('double-bed') })
    const load = createAssetViewLoader(createFetchAssetViewIO({ fetchImpl }))
    const lost = {
      id: 'bunk',
      src: 'https://lib.test/bunk.glb',
      thumbnail: 'https://lib.test/bunk.png',
    }
    const facts = await load([lost])
    expect(facts.bunk?.surfaces).toBeUndefined()
    expect(facts.bunk?.picture).toBeUndefined()
    expect(facts.bunk?.unavailable).toContain(
      'its surfaces could not be read (the file answered 404)',
    )
    expect(facts.bunk?.unavailable).toContain(
      'its picture could not be fetched (the file answered 404)',
    )
    const before = calls.length
    await load([lost])
    expect(calls.length).toBeGreaterThan(before)
  })

  test('a model with no named surfaces is a known empty list, an item with no picture says so', async () => {
    const { fetchImpl } = library(files)
    const load = createAssetViewLoader(createFetchAssetViewIO({ fetchImpl }))
    const facts = await load([{ id: 'double-bed', src: 'https://lib.test/double-bed.glb' }])
    expect(facts['double-bed']?.surfaces).toEqual([])
    expect(facts['double-bed']?.unavailable).toBe(
      'its picture could not be fetched (it has no picture)',
    )
  })

  test('a path with no host (a standalone server’s list) is reported, not thrown', async () => {
    const load = createAssetViewLoader(
      createFetchAssetViewIO({
        fetchImpl: (async () => {
          throw new TypeError('Invalid URL')
        }) as unknown as typeof fetch,
      }),
    )
    const facts = await load([
      { id: 'sofa', src: '/items/sofa/model.glb', thumbnail: '/items/sofa/t.webp' },
    ])
    expect(facts.sofa?.picture).toBeUndefined()
    expect(facts.sofa?.unavailable).toContain('Invalid URL')
  })

  test('a url the host does not resolve is never fetched, and is reported unavailable', async () => {
    const asked: string[] = []
    const load = createAssetViewLoader(
      createFetchAssetViewIO({
        fetchImpl: (async (url: string) => {
          asked.push(url)
          return new Response('')
        }) as unknown as typeof fetch,
        resolveUrl: async () => null,
      }),
    )
    const facts = await load([
      { id: 'x', src: 'http://169.254.169.254/m.glb', thumbnail: 'http://localhost/t.png' },
    ])
    expect(asked).toEqual([])
    expect(facts.x?.unavailable).toContain('the file is not available')
  })

  test('a thumbnail that is not an image is refused', async () => {
    const { fetchImpl } = library({
      'https://lib.test/page.txt': new TextEncoder().encode('hello'),
    })
    const load = createAssetViewLoader(createFetchAssetViewIO({ fetchImpl }))
    const facts = await load([{ id: 'x', src: '', thumbnail: 'https://lib.test/page.txt' }])
    expect(facts.x?.unavailable).toContain('the file is not an image')
  })
})

describe('what a host reads before a call', () => {
  const catalog = [
    {
      id: 'sofa',
      src: 'https://lib.test/sofa.glb',
      thumbnail: 'https://lib.test/sofa.png',
      name: 'Sofa',
      category: 'furniture',
    },
    {
      id: 'lamp',
      src: 'https://lib.test/lamp.glb',
      thumbnail: '',
      name: 'Lamp',
      category: 'furniture',
    },
  ]
  const item = (id: string, assetId: string) =>
    ItemNode.parse({
      id,
      asset: {
        id: assetId,
        name: assetId,
        category: 'furniture',
        thumbnail: '',
        src: `https://lib.test/${assetId}.glb`,
      },
    })
  const nodes = {
    item_a: item('item_a', 'sofa'),
    item_b: item('item_b', 'lamp'),
    item_c: item('item_c', 'sofa'),
    wall_a: { id: 'wall_a', type: 'wall' },
  } as never

  test('view_assets reads the named catalog items with their pictures; unknown ids are the operation’s to refuse', () => {
    const needs = assetViewNeeds(nodes, 'view_assets', { ids: ['sofa', 'throne'] }, { catalog })
    expect(needs.pictures).toBe(true)
    expect(needs.subjects.map((subject) => subject.id)).toEqual(['sofa'])
  })

  test('paint with no role reads the surfaces of the items it targets, once each', () => {
    const needs = assetViewNeeds(
      nodes,
      'paint',
      { targets: ['item_a', 'item_c', 'wall_a', 'item_b'] },
      { catalog },
    )
    expect(needs.pictures).toBe(false)
    expect(needs.subjects.map((subject) => subject.id)).toEqual(['sofa', 'lamp'])
  })

  test('paint with a role reads nothing', () => {
    expect(
      assetViewNeeds(nodes, 'paint', { targets: ['item_a'], role: 'body' }, { catalog }).subjects,
    ).toEqual([])
  })

  test('a batch reads for the paint calls it holds, and only those', () => {
    const needs = assetViewNeeds(
      nodes,
      'run_batch',
      {
        calls: [
          { tool: 'paint', input: { targets: ['item_a'] } },
          { tool: 'paint', input: { targets: ['item_b'], role: 'shade' } },
          { tool: 'delete_node', input: { id: 'item_c' } },
        ],
      },
      { catalog },
    )
    expect(needs.subjects.map((subject) => subject.id)).toEqual(['sofa'])
  })

  /** A node as a person or a script can write it: its asset.src is whatever they chose. */
  const withSrc = (assetId: string, src: string) => {
    const node = item('item_a', assetId)
    return { item_a: { ...node, asset: { ...node.asset, src } } } as never
  }

  test('paint reads the catalog entry of an item, never the url its scene node carries', () => {
    const forged = withSrc('sofa', 'http://169.254.169.254/latest/meta-data/')
    const needs = assetViewNeeds(forged, 'paint', { targets: ['item_a'] }, { catalog })
    expect(needs.subjects).toEqual([{ id: 'sofa', src: 'https://lib.test/sofa.glb' }])
  })

  test('an item the catalog does not hold is not read, nor is any item on a host with no catalog', () => {
    const stranger = withSrc('not-in-the-library', 'http://localhost:8080/model.glb')
    expect(
      assetViewNeeds(stranger, 'paint', { targets: ['item_a'] }, { catalog }).subjects,
    ).toEqual([])
    expect(assetViewNeeds(nodes, 'paint', { targets: ['item_a'] }, {}).subjects).toEqual([])
  })

  test('only a paint with no role asks for the catalog', () => {
    expect(assetViewsReadCatalog('paint', { targets: ['item_a'] })).toBe(true)
    expect(assetViewsReadCatalog('paint', { targets: ['item_a'], role: 'body' })).toBe(false)
    expect(
      assetViewsReadCatalog('run_batch', {
        calls: [{ tool: 'paint', input: { targets: ['item_a'] } }],
      }),
    ).toBe(true)
    expect(assetViewsReadCatalog('view_assets', { ids: ['sofa'] })).toBe(true)
    expect(assetViewsReadCatalog('delete_node', { id: 'item_a' })).toBe(false)
  })

  test('any other tool reads nothing', () => {
    expect(assetViewNeeds(nodes, 'search_assets', { queries: [] }, { catalog }).subjects).toEqual(
      [],
    )
  })
})

describe('the contract', () => {
  const contract = z.object(viewAssetsTool.input)

  test('takes one to six ids', () => {
    expect(contract.safeParse({ ids: ['a'] }).success).toBe(true)
    expect(contract.safeParse({ ids: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(true)
    expect(contract.safeParse({ ids: [] }).success).toBe(false)
    expect(contract.safeParse({ ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).success).toBe(false)
    expect(contract.safeParse({ ids: [''] }).success).toBe(false)
  })
})
