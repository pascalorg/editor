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
