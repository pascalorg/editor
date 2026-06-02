'use client'

import type { CoordsJSON, DxfParsed, GeometryParserOptions } from '@pascal-app/core/importers'
import { parseDxfGeometry } from '@pascal-app/core/importers'
import { useCallback, useEffect, useRef } from 'react'
import type { GeometryWorkerRequest, GeometryWorkerResponse } from '../workers/dxf-geometry.worker'

// ─── Core parser (testable, framework-free) ───────────────────────────────────

type Pending = {
  resolve: (result: CoordsJSON) => void
  reject: (err: Error) => void
}

/**
 * Minimal Worker surface that the factory cares about.
 * Matches the real Worker API and is easy to mock in tests.
 */
export interface WorkerLike {
  postMessage(data: unknown): void
  addEventListener(type: 'message', handler: (e: { data: unknown }) => void): void
  addEventListener(type: 'error', handler: (e: { message?: string }) => void): void
  terminate(): void
}

export type GeometryParser = {
  /** Parse a DxfParsed object. Resolves with CoordsJSON or rejects on error/abort. */
  parse(dxf: DxfParsed, options?: GeometryParserOptions, signal?: AbortSignal): Promise<CoordsJSON>
  /** Release the underlying worker. */
  dispose(): void
}

/**
 * Creates a geometry parser backed by a Worker supplied by `workerFactory`.
 * When `workerFactory` returns `null` (SSR or Worker unavailable), parsing
 * falls back to the main thread via a microtask yield.
 *
 * Exported for unit-testing with a mock worker factory.
 */
export function createGeometryParser(workerFactory: () => WorkerLike | null): GeometryParser {
  let worker: WorkerLike | null = null
  const pending = new Map<string, Pending>()

  function getWorker(): WorkerLike | null {
    if (worker) return worker
    try {
      const w = workerFactory()
      if (!w) return null

      w.addEventListener('message', (e) => {
        const msg = e.data as GeometryWorkerResponse
        const p = pending.get(msg.id)
        if (!p) return // aborted or already resolved
        pending.delete(msg.id)
        if (msg.type === 'result') {
          p.resolve(msg.coordsJSON)
        } else {
          p.reject(new Error(msg.message))
        }
      })

      w.addEventListener('error', (e) => {
        const err = new Error(e.message ?? 'Geometry worker crashed')
        for (const p of pending.values()) p.reject(err)
        pending.clear()
        worker = null // allow re-creation on next call
      })

      worker = w
      return w
    } catch {
      return null
    }
  }

  function parse(
    dxf: DxfParsed,
    options?: GeometryParserOptions,
    signal?: AbortSignal,
  ): Promise<CoordsJSON> {
    const w = getWorker()

    if (!w) {
      // Fallback: main-thread parse after yielding to browser
      return Promise.resolve().then(() => parseDxfGeometry(dxf, options))
    }

    return new Promise<CoordsJSON>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      const id = crypto.randomUUID()

      const onAbort = () => {
        if (pending.delete(id)) {
          reject(new DOMException('Aborted', 'AbortError'))
        }
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      pending.set(id, {
        resolve(result) {
          signal?.removeEventListener('abort', onAbort)
          resolve(result)
        },
        reject(err) {
          signal?.removeEventListener('abort', onAbort)
          reject(err)
        },
      })

      const request: GeometryWorkerRequest = { id, dxf, options }
      w.postMessage(request)
    })
  }

  function dispose(): void {
    worker?.terminate()
    worker = null
    // Reject any pending promises that will never resolve
    const err = new Error('Geometry parser disposed')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }

  return { parse, dispose }
}

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Creates a persistent geometry parser for the component lifetime.
 * The worker is started lazily on the first `parse()` call.
 * Falls back to main-thread parsing when Worker is not available (SSR).
 */
export function useGeometryWorker(): { parse: GeometryParser['parse'] } {
  const parserRef = useRef<GeometryParser | null>(null)

  function getParser(): GeometryParser {
    if (!parserRef.current) {
      parserRef.current = createGeometryParser(() => {
        if (typeof Worker === 'undefined') return null
        try {
          return new Worker(
            // new URL() + import.meta.url tells Webpack/Turbopack to bundle this
            // file as a separate worker chunk.
            new URL('../workers/dxf-geometry.worker', import.meta.url),
            { type: 'module' },
          )
        } catch {
          return null
        }
      })
    }
    return parserRef.current
  }

  useEffect(
    () => () => {
      parserRef.current?.dispose()
      parserRef.current = null
    },
    [],
  )

  // Stable reference — refs are stable, so the callback never needs to change.
  const parse = useCallback<GeometryParser['parse']>(
    (dxf, options, signal) => getParser().parse(dxf, options, signal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return { parse }
}
