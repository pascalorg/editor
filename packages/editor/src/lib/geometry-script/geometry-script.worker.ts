/// <reference lib="webworker" />
import './worker-window-shim'
// The compile subpath only: the package index pulls in core, which needs `window`.
import { compileGeometryScript } from '@pascal-app/geometry-script/compile'
import type { GeometryScriptWorkerRequest, GeometryScriptWorkerResponse } from './protocol'

// Model-written code runs in this worker. Before any of it runs, remove the
// ambient capabilities a geometry build never needs: network, storage,
// nested workers and script loading. This is a deterrent, not a sandbox:
// the isolation boundary is an opaque-origin host with a CSP (not built yet).
const BLOCKED = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'Request',
  'Response',
] as const

const scope = self as unknown as Record<string, unknown>
const post = self.postMessage.bind(self)
for (const name of BLOCKED) {
  for (let target: object | null = scope; target; target = Object.getPrototypeOf(target)) {
    if (Object.hasOwn(target, name)) {
      try {
        Object.defineProperty(target, name, {
          value: undefined,
          configurable: false,
          writable: false,
        })
      } catch {}
    }
  }
}
try {
  Object.defineProperty(scope.navigator as object, 'sendBeacon', { value: undefined })
} catch {}

self.addEventListener('message', async (event: MessageEvent<GeometryScriptWorkerRequest>) => {
  const { id, code, params } = event.data
  try {
    const output = await compileGeometryScript({ code, params })
    const response: GeometryScriptWorkerResponse = { id, ok: true, output }
    post(response, [output.glb])
  } catch (error) {
    const response: GeometryScriptWorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    post(response)
  }
})
