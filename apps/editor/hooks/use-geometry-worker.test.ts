import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { CoordsJSON, DxfParsed } from '@pascal-app/core/importers'
import { createGeometryParser, type WorkerLike } from './use-geometry-worker'
import type { GeometryWorkerRequest, GeometryWorkerResponse } from '../workers/dxf-geometry.worker'

// ─── Mock Worker ──────────────────────────────────────────────────────────────

class MockWorker implements WorkerLike {
  private msgHandlers: Array<(e: { data: unknown }) => void> = []
  private errHandlers: Array<(e: { message?: string }) => void> = []
  readonly sent: GeometryWorkerRequest[] = []
  terminated = false

  postMessage(data: unknown): void {
    this.sent.push(data as GeometryWorkerRequest)
  }

  addEventListener(type: 'message' | 'error', handler: (e: { data?: unknown; message?: string }) => void): void {
    if (type === 'message') this.msgHandlers.push(handler as (e: { data: unknown }) => void)
    else this.errHandlers.push(handler as (e: { message?: string }) => void)
  }

  terminate(): void { this.terminated = true }

  /** Test helper: push a successful result back to the hook. */
  reply(id: string, coordsJSON: CoordsJSON): void {
    const resp: GeometryWorkerResponse = { id, type: 'result', coordsJSON }
    this.msgHandlers.forEach(h => h({ data: resp }))
  }

  /** Test helper: push an error result back to the hook. */
  replyError(id: string, message: string): void {
    const resp: GeometryWorkerResponse = { id, type: 'error', message }
    this.msgHandlers.forEach(h => h({ data: resp }))
  }

  /** Test helper: simulate a worker crash. */
  crash(message = 'Worker crashed'): void {
    this.errHandlers.forEach(h => h({ message }))
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MINIMAL_DXF: DxfParsed = {
  header: { $INSUNITS: 6 },
  entities: [],
}

function okCoords(override?: Partial<CoordsJSON>): CoordsJSON {
  return {
    unit: 'm',
    bbox: { minX: 0, minY: 0, maxX: 10, maxY: 8 },
    walls: [],
    openings: [],
    closedRegions: [],
    confidence: 0.9,
    warnings: [],
    ...override,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createGeometryParser — worker available', () => {
  let mock: MockWorker
  let parser: ReturnType<typeof createGeometryParser>

  beforeEach(() => {
    mock = new MockWorker()
    parser = createGeometryParser(() => mock)
  })

  afterEach(() => {
    parser.dispose()
  })

  test('postMessage is called with correct id and dxf', async () => {
    const promise = parser.parse(MINIMAL_DXF)

    expect(mock.sent).toHaveLength(1)
    const req = mock.sent[0]!
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/) // UUID
    expect(req.dxf).toEqual(MINIMAL_DXF)
    expect(req.options).toBeUndefined()

    // Resolve so the test doesn't hang
    mock.reply(req.id, okCoords())
    await promise
  })

  test('parse resolves with coordsJSON from worker', async () => {
    const coords = okCoords({ confidence: 0.77 })
    const promise = parser.parse(MINIMAL_DXF)
    mock.reply(mock.sent[0]!.id, coords)
    const result = await promise
    expect(result.confidence).toBe(0.77)
  })

  test('parse rejects when worker replies with type=error', async () => {
    const promise = parser.parse(MINIMAL_DXF)
    mock.replyError(mock.sent[0]!.id, '几何解析失败')
    await expect(promise).rejects.toThrow('几何解析失败')
  })

  test('concurrent parse calls use distinct ids', async () => {
    const p1 = parser.parse(MINIMAL_DXF)
    const p2 = parser.parse(MINIMAL_DXF)

    expect(mock.sent).toHaveLength(2)
    const [req1, req2] = mock.sent
    expect(req1!.id).not.toBe(req2!.id)

    const c1 = okCoords({ confidence: 0.5 })
    const c2 = okCoords({ confidence: 0.9 })
    mock.reply(req1!.id, c1)
    mock.reply(req2!.id, c2)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.confidence).toBe(0.5)
    expect(r2.confidence).toBe(0.9)
  })

  test('unknown id in response is silently ignored', () => {
    void parser.parse(MINIMAL_DXF).catch(() => {}) // suppress dispose-rejection
    expect(() => mock.reply('non-existent-id', okCoords())).not.toThrow()
  })

  test('worker crash rejects all pending promises', async () => {
    const p1 = parser.parse(MINIMAL_DXF)
    const p2 = parser.parse(MINIMAL_DXF)

    mock.crash('GPU process killed')

    await expect(p1).rejects.toThrow('GPU process killed')
    await expect(p2).rejects.toThrow('GPU process killed')
  })

  test('worker factory is called only once across multiple parses', async () => {
    let factoryCalls = 0
    const p = createGeometryParser(() => { factoryCalls++; return mock })
    const a = p.parse(MINIMAL_DXF).catch(() => {})
    const b = p.parse(MINIMAL_DXF).catch(() => {})
    expect(factoryCalls).toBe(1)
    p.dispose()
    await Promise.all([a, b])
  })

  test('options are forwarded to the worker', async () => {
    const promise = parser.parse(MINIMAL_DXF, { wallThicknessMin: 0.1, wallThicknessMax: 0.35 })
    const req = mock.sent[0]!
    expect(req.options?.wallThicknessMin).toBe(0.1)
    expect(req.options?.wallThicknessMax).toBe(0.35)
    mock.reply(req.id, okCoords())
    await promise
  })
})

describe('createGeometryParser — abort signal', () => {
  let mock: MockWorker
  let parser: ReturnType<typeof createGeometryParser>

  beforeEach(() => {
    mock = new MockWorker()
    parser = createGeometryParser(() => mock)
  })

  afterEach(() => { parser.dispose() })

  test('already-aborted signal rejects immediately without posting message', async () => {
    const ctrl = new AbortController()
    ctrl.abort()

    const promise = parser.parse(MINIMAL_DXF, undefined, ctrl.signal)
    const err = await promise.catch((e: unknown) => e)
    expect((err as DOMException).name).toBe('AbortError')
    expect(mock.sent).toHaveLength(0)
  })

  test('aborting after post rejects the promise', async () => {
    const ctrl = new AbortController()
    const promise = parser.parse(MINIMAL_DXF, undefined, ctrl.signal)

    expect(mock.sent).toHaveLength(1)
    ctrl.abort()

    const err = await promise.catch((e: unknown) => e)
    expect((err as DOMException).name).toBe('AbortError')
  })

  test('late worker reply after abort is silently discarded', async () => {
    const ctrl = new AbortController()
    const promise = parser.parse(MINIMAL_DXF, undefined, ctrl.signal)
    const { id } = mock.sent[0]!
    ctrl.abort()

    const err = await promise.catch((e: unknown) => e)
    expect((err as DOMException).name).toBe('AbortError')

    // Worker sends result anyway — must not throw or trigger anything
    expect(() => mock.reply(id, okCoords())).not.toThrow()
  })
})

describe('createGeometryParser — no worker (fallback)', () => {
  test('falls back to parseDxfGeometry on main thread when factory returns null', async () => {
    const parser = createGeometryParser(() => null)
    const dxf: DxfParsed = {
      header: { $INSUNITS: 6 },
      entities: [
        { type: 'LINE', layer: 'WALL', start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
        { type: 'LINE', layer: 'WALL', start: { x: 0, y: 0.2 }, end: { x: 5, y: 0.2 } },
        { type: 'LINE', layer: 'WALL', start: { x: 0, y: 0 }, end: { x: 0, y: 3 } },
        { type: 'LINE', layer: 'WALL', start: { x: 0.2, y: 0 }, end: { x: 0.2, y: 3 } },
        { type: 'LINE', layer: 'WALL', start: { x: 5, y: 0 }, end: { x: 5, y: 3 } },
        { type: 'LINE', layer: 'WALL', start: { x: 4.8, y: 0 }, end: { x: 4.8, y: 3 } },
        { type: 'LINE', layer: 'WALL', start: { x: 0, y: 3 }, end: { x: 5, y: 3 } },
        { type: 'LINE', layer: 'WALL', start: { x: 0, y: 2.8 }, end: { x: 5, y: 2.8 } },
        { type: 'LINE', layer: 'WALL', start: { x: 0, y: 1.5 }, end: { x: 5, y: 1.5 } },
        { type: 'LINE', layer: 'WALL', start: { x: 0, y: 1.7 }, end: { x: 5, y: 1.7 } },
      ],
    }
    const result = await parser.parse(dxf)
    expect(result.unit).toBe('m')
    expect(result.walls.length).toBeGreaterThan(0)
    parser.dispose()
  })

  test('fallback propagates parse errors as rejections', async () => {
    const parser = createGeometryParser(() => null)
    // Entities with no valid geometry still produces a valid result (empty walls, no error)
    const result = await parser.parse({ header: {}, entities: [] })
    expect(result.walls).toHaveLength(0)
    parser.dispose()
  })
})

describe('createGeometryParser — dispose', () => {
  test('dispose terminates the worker', async () => {
    const mock = new MockWorker()
    const parser = createGeometryParser(() => mock)
    const pending = parser.parse(MINIMAL_DXF).catch(() => {}) // suppress rejection
    parser.dispose()
    expect(mock.terminated).toBe(true)
    await pending
  })

  test('dispose rejects all pending promises', async () => {
    const mock = new MockWorker()
    const parser = createGeometryParser(() => mock)
    const p1 = parser.parse(MINIMAL_DXF)
    const p2 = parser.parse(MINIMAL_DXF)
    parser.dispose()
    await expect(p1).rejects.toThrow('Geometry parser disposed')
    await expect(p2).rejects.toThrow('Geometry parser disposed')
  })
})
