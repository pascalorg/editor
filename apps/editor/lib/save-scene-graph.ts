import { deltaIsWorthSending, diffSceneGraphs, type SceneDelta } from '@pascal-app/core/scene-delta'

/**
 * The save decision, lifted out of the component so it can be exercised.
 *
 * Every branch that matters here is one the test suite otherwise cannot see:
 * whether a stale delta really falls back to a full write, whether a checkpoint
 * really refuses the delta path, whether a compressed body still carries the
 * same JSON. Those are the failures that ship silently — the scene still looks
 * saved, and the divergence only shows up on the next reload.
 */

/** Below this, gzip's own framing costs more than it saves. */
const COMPRESSION_THRESHOLD_BYTES = 1024

export type SaveGraph = {
  nodes: Record<string, unknown>
  rootNodeIds: readonly string[]
} & Record<string, unknown>

export interface SaveSceneGraphOptions {
  sceneId: string
  name: string
  graph: SaveGraph
  /** The graph the server last acknowledged, or null to force a full write. */
  previousGraph: SaveGraph | null
  version: number
  isCheckpoint: boolean
  keepalive?: boolean
  fetchImpl?: typeof fetch
}

export type SaveSceneGraphResult =
  | { outcome: 'saved'; version: number; via: 'delta' | 'full' }
  | { outcome: 'conflict' }
  | { outcome: 'error'; message: string }

/**
 * Compresses a JSON payload when it is worth it and the browser can.
 *
 * The body is fully compressed before the request is made rather than streamed
 * into it: a streaming body needs `duplex: 'half'` and rules out `keepalive`,
 * and `keepalive` is exactly the case that benefits most — browsers cap those
 * bodies at 64 KB, which gzip is what puts a large scene back under.
 */
export async function encodeJsonBody(
  payload: unknown,
): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  const json = JSON.stringify(payload)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (json.length < COMPRESSION_THRESHOLD_BYTES || typeof CompressionStream === 'undefined') {
    return { body: json, headers }
  }

  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
    const compressed = await new Response(stream).arrayBuffer()
    return { body: compressed, headers: { ...headers, 'Content-Encoding': 'gzip' } }
  } catch {
    // A browser that advertises the API but fails on it still has to be able to
    // save; an uncompressed body is always accepted.
    return { body: json, headers }
  }
}

export async function saveSceneGraph(
  options: SaveSceneGraphOptions,
): Promise<SaveSceneGraphResult> {
  const doFetch = options.fetchImpl ?? fetch

  // A checkpoint carries the whole graph — it is the row someone restores from,
  // and rebuilding one out of a delta chain is the recovery risk checkpoints
  // exist to avoid. Everything else only needs to say what moved.
  if (!options.isCheckpoint && options.previousGraph) {
    const delta = diffSceneGraphs(options.previousGraph, options.graph)
    if (deltaIsWorthSending(delta, options.graph)) {
      const sent = await sendDelta(doFetch, options, delta)
      if (sent.outcome === 'saved') return sent
      // `conflict` and `error` both fall through to the full write below, which
      // resynchronises the base the next delta is measured against. A delta is
      // an optimisation; it never gets to be the reason a save was lost.
    }
  }

  return sendFullGraph(doFetch, options)
}

async function sendDelta(
  doFetch: typeof fetch,
  options: SaveSceneGraphOptions,
  delta: SceneDelta,
): Promise<SaveSceneGraphResult> {
  try {
    const { body, headers } = await encodeJsonBody({
      baseVersion: options.version,
      ops: delta.ops,
    })
    const response = await doFetch(`/api/scenes/${options.sceneId}/patch`, {
      method: 'POST',
      headers,
      body,
      keepalive: options.keepalive,
    })
    if (response.status === 409) return { outcome: 'conflict' }
    if (!response.ok) return { outcome: 'error', message: `Patch failed (${response.status})` }
    const next = (await response.json()) as { version: number }
    return { outcome: 'saved', version: next.version, via: 'delta' }
  } catch (error) {
    return { outcome: 'error', message: error instanceof Error ? error.message : 'Patch failed' }
  }
}

async function sendFullGraph(
  doFetch: typeof fetch,
  options: SaveSceneGraphOptions,
): Promise<SaveSceneGraphResult> {
  try {
    const { body, headers } = await encodeJsonBody({
      name: options.name,
      graph: options.graph,
      saveMode: options.isCheckpoint ? 'checkpoint' : 'draft',
    })
    const response = await doFetch(`/api/scenes/${options.sceneId}`, {
      method: 'PUT',
      headers: { ...headers, 'If-Match': String(options.version) },
      body,
      // `keepalive` lets the request outlive a page unload (the autosave flush
      // on refresh/close). Browsers cap keepalive bodies at 64 KB, which is why
      // this path compresses.
      keepalive: options.keepalive,
    })

    if (response.status === 409) return { outcome: 'conflict' }
    if (!response.ok) return { outcome: 'error', message: `Save failed (${response.status})` }
    const next = (await response.json()) as { version: number }
    return { outcome: 'saved', version: next.version, via: 'full' }
  } catch (error) {
    return { outcome: 'error', message: error instanceof Error ? error.message : 'Save failed' }
  }
}
