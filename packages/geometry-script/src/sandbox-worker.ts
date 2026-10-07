/// <reference lib="webworker" />
// The compile worker that runs inside the editor's opaque-origin sandbox frame.
// Built into one self-contained classic script (scripts/build-sandbox.ts): the
// frame receives it as text and starts it from a blob (an opaque origin cannot
// start a module worker), under the frame's CSP (no
// network, fonts, images or nested frames). Removing ambient capabilities
// below is defence in depth on top of that boundary.

import './sandbox-window'
import { compileGeometryScript } from './compile'

const scope = globalThis as unknown as Record<string, unknown>

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
  'FontFace',
] as const

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

type Request = { id: number; code: string; params?: Record<string, string | number | boolean> }

self.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { id, code, params } = event.data
  try {
    const output = await compileGeometryScript({ code, params })
    post({ id, ok: true, output }, [output.glb])
  } catch (error) {
    post({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})
post({ ready: true })
