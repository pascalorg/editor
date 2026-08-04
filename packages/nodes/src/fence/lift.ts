import {
  type AnyNode,
  type AnyNodeId,
  findLevelAncestorId,
  levelBaseElevationAt,
  type SlabNode,
} from '@pascal-app/core'
import type { FenceNode } from './schema'

/**
 * Elevation (meters above the level plane) a hosted fence stands at.
 *
 * A fence carrying `supportSlabId` is a railing on that slab's walking
 * surface (drawn onto a deck, or placed by a deck preset). The
 * host pins the lift only while it still exists as a slab on the fence's
 * own level — a stale host (deleted slab, reparented fence) silently
 * falls back to the level floor, mirroring the read-path rules of the
 * other `supportSlabId` carriers. Pure so it is unit-testable and
 * callable from the geometry builder with `ctx.resolve`.
 *
 * `levelBase` is what "the level floor" means here — the sculpted ground
 * under the fence (`levelBaseElevationAt`, reached through `ctx.levelBaseAt`
 * in the builder and {@link resolveFenceLiftElevationForNodes} everywhere
 * else), or 0 for a level with no terrain under it. A caller-resolved scalar
 * rather than a terrain lookup inside, so this stays pure and the sample stays
 * at the caller's chosen point; it substitutes for the literal `0` this used to
 * return in every unhosted branch, and nowhere else — a host slab that still
 * exists wins outright, so a railing on a deck pad keeps the pad's elevation
 * instead of following the hillside around it.
 */
export function resolveFenceLiftElevation(
  node: Pick<FenceNode, 'supportSlabId' | 'supportOffset' | 'parentId'>,
  resolve: (id: string) => AnyNode | undefined,
  levelBase = 0,
): number {
  const offset = node.supportOffset ?? 0
  if (!node.supportSlabId) return levelBase + offset
  const host = resolve(node.supportSlabId)
  if (host?.type !== 'slab') return levelBase + offset
  if ((host.parentId ?? null) !== (node.parentId ?? null)) return levelBase + offset
  const elevation = (host as SlabNode).elevation
  return (Number.isFinite(elevation) ? elevation : 0) + offset
}

/**
 * {@link resolveFenceLiftElevation} against a nodes record, with the level base
 * resolved from the terrain under the fence's start point — the same anchor the
 * geometry builder samples, so a handle, a snap guide and the rendered rail all
 * agree about where the ground is.
 *
 * Exists so the callers that already hold the whole scene (handles via
 * `sceneApi.nodes()`, the dependency tracker, the editor's elevation guides)
 * don't each re-derive the level walk and the sample point. The builder keeps
 * using the pure form, since `GeometryContext` deliberately exposes the ground
 * as a closure rather than the store.
 */
export function resolveFenceLiftElevationForNodes(
  node: Pick<FenceNode, 'id' | 'start' | 'supportSlabId' | 'supportOffset' | 'parentId'>,
  nodes: Record<string, AnyNode>,
): number {
  const levelId = findLevelAncestorId(node.id as AnyNodeId, nodes)
  const levelBase = levelId ? levelBaseElevationAt(nodes, levelId, node.start[0], node.start[1]) : 0
  return resolveFenceLiftElevation(node, (id) => nodes[id], levelBase)
}
