import type { GeometryScriptParamValue } from '@pascal-app/core'
import type { GeometryScriptCompileOutput } from '@pascal-app/geometry-script'
import type { GeometryScriptWorkerRequest, GeometryScriptWorkerResponse } from './protocol'

const COMPILE_TIMEOUT_MS = 20_000

type Pending = {
  resolve: (output: GeometryScriptCompileOutput) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function reset(error: Error) {
  worker?.terminate()
  worker = null
  for (const entry of pending.values()) {
    clearTimeout(entry.timeout)
    entry.reject(error)
  }
  pending.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  if (typeof Worker === 'undefined') throw new Error('Web Workers are unavailable here')
  worker = new Worker(new URL('./geometry-script.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<GeometryScriptWorkerResponse>) => {
    const entry = pending.get(event.data.id)
    if (!entry) return
    pending.delete(event.data.id)
    clearTimeout(entry.timeout)
    if (event.data.ok) entry.resolve(event.data.output)
    else entry.reject(new Error(event.data.error))
  })
  worker.addEventListener('error', (event) => {
    reset(new Error(event.message || 'The geometry script worker crashed'))
  })
  return worker
}

/**
 * Runs a geometry script in the worker and returns its GLB + manifest. A
 * script that hangs is killed with its worker; the next compile starts fresh.
 */
export function compileGeometryScriptInWorker(input: {
  code: string
  params?: Record<string, GeometryScriptParamValue>
}): Promise<GeometryScriptCompileOutput> {
  const active = getWorker()
  const id = nextId++
  const request: GeometryScriptWorkerRequest = { id, code: input.code, params: input.params }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reset(new Error(`The script ran longer than ${COMPILE_TIMEOUT_MS / 1000} s and was stopped`))
    }, COMPILE_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timeout })
    active.postMessage(request)
  })
}
