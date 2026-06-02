/**
 * Web Worker entry point for Channel A (geometry parsing).
 * Imported via new Worker(new URL('./workers/dxf-geometry.worker', import.meta.url)).
 * Zero DOM APIs — pure CPU work on a dedicated thread.
 */

import type { CoordsJSON, DxfParsed, GeometryParserOptions } from '@pascal-app/core/importers'
import { parseDxfGeometry } from '@pascal-app/core/importers'

// ─── Message protocol ─────────────────────────────────────────────────────────

export type GeometryWorkerRequest = {
  id: string
  dxf: DxfParsed
  options?: GeometryParserOptions
}

export type GeometryWorkerResponse =
  | { id: string; type: 'result'; coordsJSON: CoordsJSON }
  | { id: string; type: 'error'; message: string }

// ─── Handler ──────────────────────────────────────────────────────────────────

self.addEventListener('message', (event: MessageEvent<GeometryWorkerRequest>) => {
  const { id, dxf, options } = event.data
  try {
    const coordsJSON = parseDxfGeometry(dxf, options)
    const response: GeometryWorkerResponse = { id, type: 'result', coordsJSON }
    self.postMessage(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const response: GeometryWorkerResponse = { id, type: 'error', message }
    self.postMessage(response)
  }
})
