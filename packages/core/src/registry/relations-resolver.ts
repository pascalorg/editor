import type { AnyNode, AnyNodeId } from '../schema/types'
import { nodeRegistry } from './registry'
import type { SceneApi } from './types'

/**
 * Spatial neighbor query — given a node and a set of kinds, returns IDs of
 * neighboring nodes of those kinds. The runtime provides this from
 * `spatialGridManager`; tests can pass a stub.
 */
export type SpatialQuery = (node: AnyNode, kinds: readonly string[]) => Iterable<AnyNodeId>

/**
 * Returns the IDs of nodes that share `node` as a parent. The runtime can
 * pass an optimized index; the default fallback iterates the scene.
 */
export type ChildQuery = (node: AnyNode) => Iterable<AnyNodeId>

export type CascadeContext = {
  scene: SceneApi
  /** Optional: bounded spatial neighbor lookup. Required for `affectsSpatial`. */
  spatialQuery?: SpatialQuery
  /** Optional: children-by-parent lookup. Defaults to iterating the scene. */
  childQuery?: ChildQuery
  /** Safety cap on cascade depth — guards against bad data and pathological
   * registry configurations. Default 16 (deeper than the maxHostDepth of 6). */
  maxDepth?: number
}

const DEFAULT_MAX_DEPTH = 16

/**
 * Walks the relations graph from one dirty node and returns the full set of
 * IDs (including the starting one) that should be marked dirty. Pure — does
 * NOT call `scene.markDirty`; callers iterate the result.
 *
 * Phase 1 implements:
 * - `hosts`: marks children whose `type` matches the kind list
 * - `affectsSpatial`: marks neighbors found via `spatialQuery`
 *
 * Phase 3 will add `linkedBy: 'endpoint-match'` for wall corner propagation.
 */
export function cascadeDirty(startId: AnyNodeId, ctx: CascadeContext): Set<AnyNodeId> {
  const result = new Set<AnyNodeId>()
  const maxDepth = ctx.maxDepth ?? DEFAULT_MAX_DEPTH
  walk(startId, ctx, result, 0, maxDepth)
  return result
}

function walk(
  id: AnyNodeId,
  ctx: CascadeContext,
  result: Set<AnyNodeId>,
  depth: number,
  maxDepth: number,
): void {
  if (result.has(id) || depth > maxDepth) return
  result.add(id)

  const node = ctx.scene.get(id)
  if (!node) return

  const def = nodeRegistry.get(node.type)
  if (!def?.relations) return

  const { hosts, affectsSpatial } = def.relations

  if (hosts && hosts.length > 0) {
    const childIds = ctx.childQuery ? ctx.childQuery(node) : defaultChildIds(node, ctx.scene)
    for (const childId of childIds) {
      const child = ctx.scene.get(childId)
      if (child && (hosts as readonly string[]).includes(child.type)) {
        walk(childId, ctx, result, depth + 1, maxDepth)
      }
    }
  }

  if (affectsSpatial && affectsSpatial.length > 0 && ctx.spatialQuery) {
    for (const neighborId of ctx.spatialQuery(node, affectsSpatial)) {
      walk(neighborId, ctx, result, depth + 1, maxDepth)
    }
  }
}

/**
 * Fallback children lookup that reads the node's `children: AnyNodeId[]`
 * field if present. Most parametric nodes carry one; nodes that don't will
 * need a `childQuery` override on the context.
 */
function defaultChildIds(node: AnyNode, _scene: SceneApi): AnyNodeId[] {
  if (!('children' in node)) return []
  const maybeChildren: unknown = node.children
  return Array.isArray(maybeChildren) ? (maybeChildren as AnyNodeId[]) : []
}

/**
 * Recursively collects every descendant of a node, plus the node itself.
 * Used by `cascadeDelete: 'descendants'` and by tools that need to delete a
 * subtree atomically. Independent of dirty-marking — pure traversal.
 */
export function collectDescendants(
  startId: AnyNodeId,
  ctx: Pick<CascadeContext, 'scene' | 'childQuery' | 'maxDepth'>,
): Set<AnyNodeId> {
  const result = new Set<AnyNodeId>()
  const maxDepth = ctx.maxDepth ?? DEFAULT_MAX_DEPTH
  walkDescendants(startId, ctx, result, 0, maxDepth)
  return result
}

function walkDescendants(
  id: AnyNodeId,
  ctx: Pick<CascadeContext, 'scene' | 'childQuery' | 'maxDepth'>,
  result: Set<AnyNodeId>,
  depth: number,
  maxDepth: number,
): void {
  if (result.has(id) || depth > maxDepth) return
  result.add(id)
  const node = ctx.scene.get(id)
  if (!node) return
  const childIds = ctx.childQuery ? ctx.childQuery(node) : defaultChildIds(node, ctx.scene)
  for (const childId of childIds) {
    walkDescendants(childId, ctx, result, depth + 1, maxDepth)
  }
}
