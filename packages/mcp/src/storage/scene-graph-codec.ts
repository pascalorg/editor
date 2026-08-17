/**
 * How a scene graph is written down, read back, sized, hashed and named.
 *
 * Shared by both backends on purpose: these rules are part of the `SceneStore`
 * contract, not of SQLite or Postgres. A second copy would drift — the strict
 * read schema in particular, which silently strips any key it does not name.
 */

import { createHash } from 'node:crypto'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { z } from 'zod'
import { SceneInvalidError } from './types'

export const DEFAULT_MAX_SCENE_BYTES = 10 * 1024 * 1024
export const DEFAULT_LIST_LIMIT = 100

const MIN_NAME_LENGTH = 1
const MAX_NAME_LENGTH = 200

/**
 * `z.object()` strips every key it does not name, silently and on load, so every
 * field that must survive a save→load round trip has to be listed here. A bag
 * can be correct through every editor-side boundary and still vanish the moment
 * the scene round-trips through this schema.
 *
 * Values stay `unknown` rather than being validated against
 * `SceneMaterial`/`Collection`: nothing validates on the way in, and
 * `parseGraph` throws, so a strict shape here would let one odd stored value
 * make a saved scene permanently unloadable. Validation belongs on the write
 * path, where the caller can still react to it.
 */
export const GraphSchema = z.object({
  nodes: z.record(z.string(), z.unknown()),
  rootNodeIds: z.array(z.string()),
  collections: z.record(z.string(), z.unknown()).optional(),
  savedViews: z.record(z.string(), z.unknown()).optional(),
  comments: z.record(z.string(), z.unknown()).optional(),
  definitions: z.record(z.string(), z.unknown()).optional(),
  materials: z.record(z.string(), z.unknown()).optional(),
  installedPlugins: z.array(z.string()).optional(),
})

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
  return validateGraph(parsed, context)
}

/** For backends that hand back a decoded value (`jsonb`) rather than text. */
export function validateGraph(parsed: unknown, context: string): SceneGraph {
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

export function hashGraphJson(graphJson: string): string {
  return createHash('sha256').update(graphJson).digest('hex')
}

export function editorUrlForScene(id: string): string {
  return `/editor/${id}`
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

  const raw = env?.PASCAL_MAX_SCENE_BYTES
  if (raw === undefined || raw === '') return DEFAULT_MAX_SCENE_BYTES
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SceneInvalidError('PASCAL_MAX_SCENE_BYTES must be a positive integer')
  }
  return parsed
}
