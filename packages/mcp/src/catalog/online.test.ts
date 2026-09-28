import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bundledCatalog } from './bundled'
import { createPascalOnlineCatalog, PASCAL_PUBLIC_CATALOG_URL } from './online'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
async function home() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pascal-online-catalog-test-'))
  directories.push(directory)
  return directory
}
async function enable(dataDir: string, online = true) {
  const temporary = path.join(dataDir, 'catalog-next.json')
  await writeFile(temporary, JSON.stringify({ schemaVersion: 1, online }))
  await rename(temporary, path.join(dataDir, 'catalog.json'))
}
function asset(id = 'public-chair') {
  return {
    id,
    name: 'Public chair',
    category: 'furniture',
    source: 'community',
    src: 'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/chair/model.glb',
    thumbnail: '',
    dimensions: [0.5, 1, 0.5],
    scale: [1, 1, 1],
  }
}
function response(items: unknown[] = [asset()]) {
  return Response.json({ items })
}
function fetcher(
  callback: (input: unknown, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(callback, { preconnect() {} }) as typeof fetch
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('missing and declined preference never fetch, and offer an optional public connection', async () => {
  const dataDir = await home()
  let calls = 0
  const catalog = createPascalOnlineCatalog({
    dataDir,
    fetch: fetcher(async () => {
      calls++
      throw new Error('Unexpected network')
    }),
  })
  expect(catalog.usesNetwork).toBe(true)
  expect((await catalog.snapshot()).status).toMatchObject({
    mode: 'bundled',
    onlineCount: 0,
    accountRequired: false,
    connectCommand: 'pascal catalog connect',
  })
  await enable(dataDir, false)
  expect((await catalog.snapshot()).items).toEqual((await bundledCatalog.snapshot()).items)
  expect(calls).toBe(0)
})

test.each([
  'not json',
  'null',
  '{"schemaVersion":2,"online":true}',
  '{"schemaVersion":1,"online":true,"token":"secret"}',
])('invalid preference fails closed without network: %s', async (raw) => {
  const dataDir = await home()
  await writeFile(path.join(dataDir, 'catalog.json'), raw)
  let calls = 0
  const catalog = createPascalOnlineCatalog({
    dataDir,
    fetch: fetcher(async () => {
      calls++
      return response()
    }),
  })
  expect((await catalog.snapshot()).status.mode).toBe('unavailable')
  expect(calls).toBe(0)
})

test('merges validated public assets with bundled precedence and mutation isolation', async () => {
  const dataDir = await home()
  await enable(dataDir)
  const seed = (await bundledCatalog.snapshot()).items[0]!
  let calls = 0
  const catalog = createPascalOnlineCatalog({
    dataDir,
    fetch: fetcher(async (input, init) => {
      calls++
      expect(input).toBe(PASCAL_PUBLIC_CATALOG_URL)
      expect(init?.credentials).toBe('omit')
      expect(init?.redirect).toBe('error')
      expect(new Headers(init?.headers).has('authorization')).toBe(false)
      expect(new Headers(init?.headers).has('cookie')).toBe(false)
      return response([asset(), asset(seed.id), asset()])
    }),
  })
  const first = await catalog.snapshot()
  expect(first.status).toMatchObject({
    mode: 'online',
    onlineCount: 1,
    excludedCount: 2,
    accountLinked: false,
    accountRequired: false,
  })
  expect(first.items.find((item) => item.id === seed.id)).toEqual(seed)
  first.items.find((item) => item.id === 'public-chair')!.name = 'Mutated by consumer'
  expect((await catalog.snapshot()).items.find((item) => item.id === 'public-chair')!.name).toBe(
    'Public chair',
  )
  expect(calls).toBe(1)
})

test('excludes missing dimensions, private drafts, unsafe URLs, and nonpositive geometry', async () => {
  const dataDir = await home()
  await enable(dataDir)
  const rows = [
    asset(),
    { ...asset('missing'), dimensions: undefined },
    { ...asset('negative'), dimensions: [-1, 1, 1] },
    { ...asset('flat'), dimensions: [1, 0, 1] },
    { ...asset('scale'), scale: [1, -1, 1] },
    { ...asset('draft'), isDraft: true },
    { ...asset('private'), source: 'mine' },
    { ...asset('remote'), src: 'https://untrusted.example/model.glb' },
    { ...asset('thumbnail'), thumbnail: 'javascript:alert(1)' },
    { ...asset('floorplan'), floorPlanUrl: '//untrusted.example/x.png' },
    {
      ...asset('credentials'),
      src: 'https://secret@byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/x.glb',
    },
    asset('__proto__'),
  ]
  const catalog = createPascalOnlineCatalog({ dataDir, fetch: fetcher(async () => response(rows)) })
  const snapshot = await catalog.snapshot()
  expect(snapshot.status).toMatchObject({
    mode: 'online',
    onlineCount: 1,
    excludedCount: rows.length - 1,
  })
  expect(snapshot.items.filter((item) => !item.src.startsWith('/')).map((item) => item.id)).toEqual(
    ['public-chair'],
  )
})

test.each([
  'http error',
  'bad json',
  'bad shape',
  'empty',
  'no usable rows',
])('server failure keeps bundled items and reports unavailable: %s', async (mode) => {
  const dataDir = await home()
  await enable(dataDir)
  const catalog = createPascalOnlineCatalog({
    dataDir,
    fetch: fetcher(async () => {
      if (mode === 'http error') return new Response('private server error', { status: 503 })
      if (mode === 'bad json') return new Response('not JSON')
      if (mode === 'bad shape') return Response.json({ items: {} })
      return response(mode === 'empty' ? [] : [{ ...asset(), dimensions: undefined }])
    }),
  })
  const snapshot = await catalog.snapshot()
  expect(snapshot.status.mode).toBe('unavailable')
  expect(snapshot.items).toEqual((await bundledCatalog.snapshot()).items)
  expect(snapshot.status.message).not.toContain('private server error')
})

test.each([
  true,
  false,
])('bounds declared and streamed response bytes (header %s)', async (declared) => {
  const dataDir = await home()
  await enable(dataDir)
  const catalog = createPascalOnlineCatalog({
    dataDir,
    maxResponseBytes: 30,
    fetch: fetcher(
      async () =>
        new Response('x'.repeat(100), { headers: declared ? { 'content-length': '100' } : {} }),
    ),
  })
  expect((await catalog.snapshot()).status.mode).toBe('unavailable')
})

test('coalesces concurrent fetches and disconnect wins before their responses return', async () => {
  const dataDir = await home()
  await enable(dataDir)
  const started = deferred<void>()
  const reply = deferred<Response>()
  let calls = 0
  const catalog = createPascalOnlineCatalog({
    dataDir,
    fetch: fetcher(async () => {
      calls++
      started.resolve()
      return reply.promise
    }),
  })
  const first = catalog.snapshot()
  const second = catalog.snapshot()
  await started.promise
  await enable(dataDir, false)
  reply.resolve(response())
  expect((await first).status.mode).toBe('bundled')
  expect((await second).status.mode).toBe('bundled')
  expect((await catalog.snapshot()).status.mode).toBe('bundled')
  expect(calls).toBe(1)
})

test('disconnect and reconnect invalidate the previous enabled generation', async () => {
  const dataDir = await home()
  await enable(dataDir)
  const started = deferred<void>()
  const reply = deferred<Response>()
  let calls = 0
  const catalog = createPascalOnlineCatalog({
    dataDir,
    fetch: fetcher(async () => {
      calls++
      if (calls === 1) {
        started.resolve()
        return reply.promise
      }
      return response([asset('new-generation')])
    }),
  })
  const old = catalog.snapshot()
  await started.promise
  await enable(dataDir, false)
  await enable(dataDir, true)
  reply.resolve(response([asset('old-generation')]))
  expect((await old).status.mode).toBe('unavailable')
  expect((await catalog.snapshot()).items.some((item) => item.id === 'new-generation')).toBe(true)
  expect(calls).toBe(2)
})

test('cache hits do not extend the refresh deadline indefinitely', async () => {
  const dataDir = await home()
  await enable(dataDir)
  let now = 0
  let calls = 0
  const catalog = createPascalOnlineCatalog({
    dataDir,
    now: () => now,
    cacheMs: 60,
    fetch: fetcher(async () => {
      calls++
      return response()
    }),
  })
  await catalog.snapshot()
  now = 40
  await catalog.snapshot()
  now = 70
  await catalog.snapshot()
  expect(calls).toBe(2)
})

test('actual HTTP timeout remains a bounded unavailable snapshot', async () => {
  const dataDir = await home()
  await enable(dataDir)
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch() {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return response()
    },
  })
  try {
    const catalog = createPascalOnlineCatalog({
      dataDir,
      timeoutMs: 10,
      fetch: fetcher(async (_input, init) => fetch(server.url, init)),
    })
    expect((await catalog.snapshot()).status.mode).toBe('unavailable')
    expect(JSON.parse(await readFile(path.join(dataDir, 'catalog.json'), 'utf8')).online).toBe(true)
  } finally {
    await server.stop(true)
  }
})
