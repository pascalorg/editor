import type { AnyNode } from '@pascal-app/core/schema'
import type { CastableHostNode } from '@pascal-app/nodes/formwork-assembly/headless'
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

/**
 * The cast is to `Record<string, unknown>` because the SDK's `structuredContent` demands an
 * index signature, and a payload described by a named interface — as the shared reports in
 * `@pascal-app/nodes` are — has none. Declaring those shapes twice to satisfy it is how the
 * MCP reply comes to disagree with the panel it was extracted from.
 */
export function textResult<T extends object>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
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
 * The scene as a list, for the finders that scan it by type.
 *
 * `sceneNodes` returns the map the solver wants; this is the same graph in the shape
 * `findFormworkSettingsNode` and its kin take. Both read the whole graph, because the
 * settings node is parented to the site and is therefore outside any level scope.
 */
export function sceneNodeList(bridge: SceneOperations): AnyNode[] {
  return Object.values(bridge.getNodes()) as unknown as AnyNode[]
}

/**
 * How many shutters a settings change re-designs.
 *
 * Reported so a reply can say what the change reached, not so anything is rebuilt: a
 * shutter's parts and its design report are both solved from the settings at the moment
 * they are read, so the new pour is already in every figure. The number is there because
 * a settings change that reports nothing reads as a settings change that did nothing.
 */
export function formworkAssemblyCount(nodes: readonly AnyNode[]): number {
  return nodes.filter((node) => node.type === 'formwork-assembly').length
}

/**
 * A refusal the model reads back, rather than a thrown tool failure.
 *
 * The message is the point: "no beamId peri-h20, pick one of …" is a sentence an agent
 * can act on, where an exception arrives as a failed call with no catalog in it. `isError`
 * so an SDK client still sees a failure rather than a result.
 */
export function refusal(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  }
}

/**
 * Refused rather than reported as an empty level.
 *
 * "Nothing wrong on level_9" is a sentence a model will happily produce about a level
 * that does not exist, and a clean report on a typo is indistinguishable from a clean
 * report on a floor.
 */
export function noSuchLevel(levelId: string) {
  return refusal(
    `no level with id ${levelId}. Call list_levels and read the id of the level you mean.`,
  )
}

/**
 * The element a parts question is about, or the refusal to hand back.
 *
 * A shape check rather than an id lookup, because the id the caller most plausibly gets
 * wrong is a real one: `list_castable_elements` reports a wall's `parentId` alongside it,
 * and a level asked for its parts would otherwise solve to nothing and report "no
 * formwork assembly" — sending the agent to `attach_formwork` on a floor.
 */
export function castableOrRefusal(
  nodes: Record<string, AnyNode>,
  elementId: string,
): CastableHostNode | ReturnType<typeof refusal> {
  const node = nodes[elementId]
  if (node === undefined || !CASTABLE_TYPES.includes(node.type)) {
    return refusal(
      `Error: no wall, column or slab with id ${elementId}. Call find_nodes with type wall, column or slab and read the id you mean.`,
    )
  }
  return node as CastableHostNode
}

const CASTABLE_TYPES: readonly string[] = ['wall', 'column', 'slab']

export function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
