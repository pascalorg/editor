import type { AnyNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { NodeIdSchema } from '../schemas'

/**
 * What both formwork tools need, and neither should say twice.
 *
 * The scope shape and the refusal in particular: the two tools answer different
 * questions about the same scope, and a level id that means "the whole scene" in one
 * of them and "no such level" in the other is a difference the caller cannot see in
 * either reply.
 */

export const formworkScopeInput = {
  levelId: NodeIdSchema.optional(),
  elementIds: z.array(NodeIdSchema).max(500).optional(),
}

export function textResult<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

/**
 * The scene as the solver takes it: a plain map, keyed by id.
 *
 * `solveProjectFormwork` reads the whole graph rather than one level's nodes, which
 * is its own contract — an element on the storey below still anchors a single-sided
 * pour above it, and a junction check that saw only the level would report a free end
 * where a wall stands. Scoping happens inside, on the scope argument.
 */
export function sceneNodes(bridge: SceneOperations): Record<string, AnyNode> {
  return bridge.getNodes() as unknown as Record<string, AnyNode>
}

/**
 * Refused rather than reported as an empty level.
 *
 * "Nothing wrong on level_9" is a sentence a model will happily produce about a level
 * that does not exist, and a clean report on a typo is indistinguishable from a clean
 * report on a floor. `isError` so an SDK client sees a failure rather than a result.
 */
export function noSuchLevel(levelId: string) {
  const message = `no level with id ${levelId}. Call list_levels and read the id of the level you mean.`
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  }
}

export function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
