import { describe, expect, test } from 'bun:test'
import { encodeJsonBody, type SaveGraph, saveSceneGraph } from './save-scene-graph'

function graph(nodeCount: number, mutate?: (nodes: Record<string, unknown>) => void): SaveGraph {
  const nodes: Record<string, unknown> = {}
  for (let i = 0; i < nodeCount; i += 1) {
    nodes[`wall_${i}`] = { id: `wall_${i}`, height: 2.7, start: [i, 0], end: [i + 1, 0] }
  }
  mutate?.(nodes)
  return { nodes, rootNodeIds: ['site_a'] }
}

type Call = {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  keepalive?: boolean
}

/**
 * Records what was sent and replies with the queued statuses, in order. It
 * decodes gzipped bodies rather than skipping them, so every assertion below
 * about what was sent is also an assertion that the compression round-trips.
 */
function recorder(replies: Array<{ status: number; version?: number }>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    let body: unknown
    if (typeof init.body === 'string') {
      body = JSON.parse(init.body)
    } else {
      const stream = new Blob([init.body as ArrayBuffer])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'))
      body = JSON.parse(await new Response(stream).text())
    }
    calls.push({ url, method: init.method ?? 'GET', headers, body, keepalive: init.keepalive })
    const reply = replies.shift() ?? { status: 200, version: 1 }
    return new Response(JSON.stringify({ version: reply.version ?? 1 }), { status: reply.status })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const base = {
  sceneId: 'abc',
  name: 'Scene',
  version: 7,
  isCheckpoint: false,
}

describe('saveSceneGraph picks a path', () => {
  test('a small change from a known base goes as a delta', async () => {
    const previous = graph(100)
    const next = { ...previous, nodes: { ...previous.nodes, wall_3: { id: 'wall_3', height: 4 } } }
    const { calls, fetchImpl } = recorder([{ status: 200, version: 8 }])

    const result = await saveSceneGraph({
      ...base,
      graph: next,
      previousGraph: previous,
      fetchImpl,
    })

    expect(result).toEqual({ outcome: 'saved', version: 8, via: 'delta' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/scenes/abc/patch')
    expect(calls[0]?.body).toEqual({
      baseVersion: 7,
      ops: [{ op: 'set', id: 'wall_3', node: { id: 'wall_3', height: 4 } }],
    })
  })

  test('without a known base there is nothing to diff against', async () => {
    const { calls, fetchImpl } = recorder([{ status: 200, version: 8 }])

    const result = await saveSceneGraph({
      ...base,
      graph: graph(100),
      previousGraph: null,
      fetchImpl,
    })

    expect(result).toEqual({ outcome: 'saved', version: 8, via: 'full' })
    expect(calls[0]?.url).toBe('/api/scenes/abc')
    expect(calls[0]?.method).toBe('PUT')
  })

  test('a checkpoint always carries the whole graph', async () => {
    const previous = graph(100)
    const next = { ...previous, nodes: { ...previous.nodes, wall_3: { id: 'wall_3', height: 4 } } }
    const { calls, fetchImpl } = recorder([{ status: 200, version: 8 }])

    await saveSceneGraph({
      ...base,
      isCheckpoint: true,
      graph: next,
      previousGraph: previous,
      fetchImpl,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/scenes/abc')
    expect((calls[0]?.body as { saveMode: string }).saveMode).toBe('checkpoint')
  })

  test('a delta that rewrites most of the scene is not worth sending', async () => {
    const { calls, fetchImpl } = recorder([{ status: 200, version: 8 }])

    await saveSceneGraph({
      ...base,
      graph: graph(100),
      // Every node object is a fresh reference, so every one reads as changed.
      previousGraph: graph(100),
      fetchImpl,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/scenes/abc')
  })
})

/**
 * The acceptance criterion this pins: a delta the server cannot apply must not
 * be able to lose the save. Both failure shapes fall back to the full write,
 * and the full write's own 409 is the only thing that surfaces as a conflict.
 */
describe('a delta never gets to be the reason a save was lost', () => {
  const previous = graph(100)
  const next = { ...previous, nodes: { ...previous.nodes, wall_3: { id: 'wall_3', height: 4 } } }

  test('a stale base falls back to the full graph, and that save stands', async () => {
    const { calls, fetchImpl } = recorder([{ status: 409 }, { status: 200, version: 12 }])

    const result = await saveSceneGraph({
      ...base,
      graph: next,
      previousGraph: previous,
      fetchImpl,
    })

    expect(result).toEqual({ outcome: 'saved', version: 12, via: 'full' })
    expect(calls.map((call) => call.url)).toEqual(['/api/scenes/abc/patch', '/api/scenes/abc'])
  })

  test('a patch endpoint that errors falls back too', async () => {
    const { calls, fetchImpl } = recorder([{ status: 500 }, { status: 200, version: 12 }])

    const result = await saveSceneGraph({
      ...base,
      graph: next,
      previousGraph: previous,
      fetchImpl,
    })

    expect(result).toEqual({ outcome: 'saved', version: 12, via: 'full' })
    expect(calls).toHaveLength(2)
  })

  test('a conflict on the full write is what the user is told about', async () => {
    const { fetchImpl } = recorder([{ status: 409 }, { status: 409 }])

    expect(
      await saveSceneGraph({ ...base, graph: next, previousGraph: previous, fetchImpl }),
    ).toEqual({ outcome: 'conflict' })
  })

  test('a network failure is reported, not swallowed', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    expect(await saveSceneGraph({ ...base, graph: next, previousGraph: null, fetchImpl })).toEqual({
      outcome: 'error',
      message: 'offline',
    })
  })
})

/**
 * The unload flush is the last write a session gets. It has to outlive the page
 * (`keepalive`) and it has to fit — browsers cap a keepalive body at 64 KB, and
 * an uncompressed scene of any size is over that on its own.
 */
describe('the unload flush', () => {
  test('sends a compressed, keepalive full graph', async () => {
    const { calls, fetchImpl } = recorder([{ status: 200, version: 9 }])
    const big = graph(1200)
    const KEEPALIVE_CAP = 64 * 1024
    expect(JSON.stringify({ name: 'Scene', graph: big }).length).toBeGreaterThan(KEEPALIVE_CAP)

    const result = await saveSceneGraph({
      ...base,
      isCheckpoint: true,
      keepalive: true,
      graph: big,
      previousGraph: big,
      fetchImpl,
    })

    expect(result.outcome).toBe('saved')
    expect(calls[0]?.keepalive).toBe(true)
    expect(calls[0]?.headers['Content-Encoding']).toBe('gzip')

    // The scene is over the cap; what actually goes on the wire is not.
    const sent = await encodeJsonBody({ name: 'Scene', graph: big, saveMode: 'checkpoint' })
    expect((sent.body as ArrayBuffer).byteLength).toBeLessThan(KEEPALIVE_CAP)
  })
})

describe('encodeJsonBody', () => {
  test('leaves a small payload alone', async () => {
    const { body, headers } = await encodeJsonBody({ hello: 'world' })
    expect(typeof body).toBe('string')
    expect(headers['Content-Encoding']).toBeUndefined()
  })

  test('gzips a scene-sized payload, and it round-trips', async () => {
    const payload = { name: 'Scene', graph: graph(400) }
    const raw = JSON.stringify(payload)
    const { body, headers } = await encodeJsonBody(payload)

    expect(headers['Content-Encoding']).toBe('gzip')
    const compressed = body as ArrayBuffer
    expect(compressed.byteLength).toBeLessThan(raw.length / 5)

    const restored = await new Response(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text()
    expect(JSON.parse(restored)).toEqual(payload)
  })
})
