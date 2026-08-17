import { createHash } from 'node:crypto'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { z } from 'zod'
import { readEnv } from '../lib/env'
import { SceneInvalidError } from './types'

export const DEFAULT_MAX_SCENE_BYTES = 10 * 1024 * 1024
export const DEFAULT_LIST_LIMIT = 100
export const MAX_NAME_LENGTH = 200
export const MIN_NAME_LENGTH = 1

/**
 * How many past versions of a scene are kept. The newest write pushes the
 * oldest out.
 *
 * ## Why there is a limit at all
 *
 * A revision row holds the WHOLE graph, and one was written on every save —
 * including every autosave, which fires on a debounce while you draw. There
 * was no pruning of any kind. On 2026-08-12 that table reached 3.1 GiB across
 * 2 256 rows (~1.4 MB each) and filled the production database's 3 GB quota;
 * the host answered by refusing DDL, the app self-migrates at boot, and the
 * whole site went to 503 over a table **nothing in the application reads**.
 *
 * Five is the operator's number, and the shape of the feature is theirs too:
 * a rolling window, not a growing log. Keep it small — the cost of one extra
 * kept revision is the size of an entire scene.
 */
export const SCENE_REVISION_HISTORY = 5

/**
 * How many live-sync events are kept per scene.
 *
 * Unlike revisions, something DOES read this table: the SSE route polls it
 * every 250 ms with `afterEventId`, up to 50 events a poll. But an event is
 * dead the moment every connected client has polled past it — a quarter of a
 * second after it was written.
 *
 * Ten is small on purpose, and it is safe because **every event carries the
 * whole graph**. A client that misses events does not desynchronise; the next
 * event it does receive replaces its scene wholesale. So the window only has
 * to cover the gap between polls, not the history of the session.
 *
 * The arithmetic is the constraint. At ~1.4 MB an event — the size measured on
 * the warehouse scene that filled production — ten events is ~14 MB per scene.
 * Fifty would be 70 MB per scene, which on a 3 GB database is a handful of
 * scenes away from the outage this is here to prevent.
 *
 * A smaller window also makes a FRESH connection cheaper: it starts at cursor
 * 0 and replays whatever is left, so the shorter the tail, the fewer whole
 * graphs it applies before reaching the current one.
 */
export const SCENE_EVENT_HISTORY = 10

/**
 * `z.object()` strips every key it does not name, so this list IS the set of
 * fields that survive a save → load round trip. A field missing here is not a
 * validation error — it is silent deletion, discovered only when a user
 * reopens a scene and finds their work reverted.
 *
 * Two were missing, both restored from upstream's #597:
 *
 * - `materials` — every custom surface. Reopen and the scene came back with
 *   default materials.
 * - `installedPlugins` — which packs the scene needs. A warehouse scene
 *   forgot it was a warehouse scene.
 *
 * Values stay `unknown` rather than being validated against
 * `SceneMaterial`/`Collection`: nothing validates on the way in, and a strict
 * shape here would let one odd stored value make a saved scene permanently
 * unloadable. Validation belongs on the write path, where the caller can still
 * react to it.
 */
const GraphSchema = z.object({
  nodes: z.record(z.string(), z.unknown()),
  rootNodeIds: z.array(z.string()),
  collections: z.record(z.string(), z.unknown()).optional(),
  materials: z.record(z.string(), z.unknown()).optional(),
  installedPlugins: z.array(z.string()).optional(),
})

export function resolveMaxSceneBytes(
  env: NodeJS.ProcessEnv | undefined,
  explicit: number | undefined,
): number {
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit <= 0) {
      throw new SceneInvalidError('maxSceneBytes must be a positive integer')
    }
    return explicit
  }

  const raw = env ? readEnv(env, 'MAX_SCENE_BYTES') : undefined
  if (raw === undefined) return DEFAULT_MAX_SCENE_BYTES
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SceneInvalidError('DIGITALTWIN_MAX_SCENE_BYTES must be a positive integer')
  }
  return parsed
}

export function editorUrlForScene(id: string): string {
  return `/editor/${id}`
}

export function hashGraphJson(graphJson: string): string {
  return createHash('sha256').update(graphJson).digest('hex')
}

/**
 * Node count of a serialized graph, tolerant of malformed JSON (returns 0).
 * Used to describe a stored revision without loading the whole graph into the
 * scene — a "backups" list only needs the number, not the nodes.
 */
export function countGraphNodes(graphJson: string): number {
  try {
    const parsed = JSON.parse(graphJson) as { nodes?: Record<string, unknown> }
    return parsed?.nodes ? Object.keys(parsed.nodes).length : 0
  } catch {
    return 0
  }
}

export function assertValidName(name: string): void {
  if (typeof name !== 'string') {
    throw new SceneInvalidError('Scene name must be a string')
  }
  const trimmed = name.trim()
  if (trimmed.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    throw new SceneInvalidError(
      `Scene name must be ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters (got ${name.length})`,
    )
  }
}

export function serializeGraph(graph: SceneGraph): string {
  return JSON.stringify(graph)
}

export function parseGraph(raw: string, context: string): SceneGraph {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new SceneInvalidError(
      `Failed to parse scene graph for ${context}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const result = GraphSchema.safeParse(parsed)
  if (!result.success) {
    throw new SceneInvalidError(`Scene graph for ${context} has invalid shape: ${result.error}`)
  }

  const graph = result.data
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new SceneInvalidError(`Scene graph for ${context} has non-object node at "${nodeId}"`)
    }
    const typeField = (node as { type?: unknown }).type
    if (typeof typeField !== 'string' || typeField.length === 0) {
      throw new SceneInvalidError(
        `Scene graph for ${context} has node "${nodeId}" missing a string "type"`,
      )
    }
  }

  return graph as SceneGraph
}
