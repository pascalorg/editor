import type { AnyNode, SlabNode } from '@pascal-app/core'
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
 */
export function resolveFenceLiftElevation(
  node: Pick<FenceNode, 'supportSlabId' | 'parentId'>,
  resolve: (id: string) => AnyNode | undefined,
): number {
  if (!node.supportSlabId) return 0
  const host = resolve(node.supportSlabId)
  if (host?.type !== 'slab') return 0
  if ((host.parentId ?? null) !== (node.parentId ?? null)) return 0
  const elevation = (host as SlabNode).elevation
  return Number.isFinite(elevation) ? elevation : 0
}
