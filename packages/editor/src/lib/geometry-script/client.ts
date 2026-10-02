import type { GeometryScriptParamValue } from '@pascal-app/core'
import type { GeometryScriptCompileOutput } from '@pascal-app/geometry-script'
import type { GeometryScriptWorkerRequest, GeometryScriptWorkerResponse } from './protocol'

const COMPILE_TIMEOUT_MS = 20_000
const START_TIMEOUT_MS = 15_000

// Model-written code runs in a worker inside a sandboxed frame: an opaque
// origin (no cookies, storage or access to the editor) whose CSP allows only
// its own scripts and blob workers, so the code cannot reach the network,
// load fonts or images, or open frames. The worker inherits that policy.
const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:"
const FRAME_HTML = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><script>
let worker
addEventListener('message', (event) => {
  if (event.source !== parent) return
  const data = event.data
  if (data && data.type === 'start') {
    worker = new Worker(URL.createObjectURL(new Blob([data.source], { type: 'text/javascript' })))
    worker.onmessage = (e) => parent.postMessage(e.data, '*', e.data && e.data.output ? [e.data.output.glb] : [])
    worker.onerror = (e) => parent.postMessage({ crashed: e.message || 'The compile worker crashed' }, '*')
    return
  }
  if (worker) worker.postMessage(data)
})
parent.postMessage({ frame: true }, '*')
</script>`

type Pending = {
  code: string
  resolve: (output: GeometryScriptCompileOutput) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type FrameMessage =
  | { frame: true }
  | { ready: true }
  | { crashed: string }
  | GeometryScriptWorkerResponse

let frame: HTMLIFrameElement | null = null
let started: Promise<Window> | null = null
let nextId = 1
const pending = new Map<number, Pending>()
let onFrameMessage: ((message: FrameMessage) => void) | null = null

function reset(error: Error) {
  frame?.remove()
  frame = null
  started = null
  for (const entry of pending.values()) {
    clearTimeout(entry.timeout)
    entry.reject(error)
  }
  pending.clear()
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent<FrameMessage>) => {
    if (!frame || event.source !== frame.contentWindow) return
    const message = event.data
    if ('crashed' in message) return reset(new Error(message.crashed))
    if ('id' in message) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timeout)
      if (message.ok) withOwnHashes(message.output, entry.code).then(entry.resolve, entry.reject)
      else entry.reject(new Error(message.error))
      return
    }
    onFrameMessage?.(message)
  })
}

async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The artifact and script hashes, computed here: nothing the sandboxed code reports about itself is trusted. */
async function withOwnHashes(
  output: GeometryScriptCompileOutput,
  code: string,
): Promise<GeometryScriptCompileOutput> {
  const [artifact, script] = await Promise.all([
    sha256(output.glb),
    sha256(new TextEncoder().encode(code)),
  ])
  return { ...output, sha256: artifact, script }
}

/** Starts the sandbox frame and its compile worker once; a crash or timeout starts a fresh one. */
function startSandbox(): Promise<Window> {
  if (started) return started
  started = (async () => {
    if (typeof document === 'undefined') throw new Error('Geometry scripts compile in a browser')
    const { sandboxWorkerSource } = await import('@pascal-app/geometry-script/sandbox')
    const iframe = document.createElement('iframe')
    iframe.sandbox.add('allow-scripts')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.style.display = 'none'
    iframe.srcdoc = FRAME_HTML
    frame = iframe
    const ready = new Promise<Window>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The script sandbox did not start')),
        START_TIMEOUT_MS,
      )
      onFrameMessage = (message) => {
        const target = iframe.contentWindow
        if (!target) return
        if ('frame' in message)
          target.postMessage({ type: 'start', source: sandboxWorkerSource }, '*')
        if ('ready' in message) {
          clearTimeout(timer)
          onFrameMessage = null
          resolve(target)
        }
      }
    })
    document.body.appendChild(iframe)
    return ready
  })()
  started.catch((error: unknown) =>
    reset(error instanceof Error ? error : new Error(String(error))),
  )
  return started
}

/**
 * Runs a geometry script in the sandbox and returns its GLB + manifest. A
 * script that hangs is stopped with its sandbox; the next compile starts fresh.
 */
export async function compileGeometryScriptInWorker(input: {
  code: string
  params?: Record<string, GeometryScriptParamValue>
}): Promise<GeometryScriptCompileOutput> {
  const target = await startSandbox()
  const id = nextId++
  const request: GeometryScriptWorkerRequest = { id, code: input.code, params: input.params }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reset(new Error(`The script ran longer than ${COMPILE_TIMEOUT_MS / 1000} s and was stopped`))
    }, COMPILE_TIMEOUT_MS)
    pending.set(id, { code: input.code, resolve, reject, timeout })
    target.postMessage(request, '*')
  })
}
