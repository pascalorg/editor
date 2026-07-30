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
  node: Pick<FenceNode, 'supportSlabId' | 'supportOffset' | 'parentId'>,
  resolve: (id: string) => AnyNode | undefined,
): number {
  const offset = node.supportOffset ?? 0
  if (!node.supportSlabId) return offset
  const host = resolve(node.supportSlabId)
  if (host?.type !== 'slab') return offset
  if ((host.parentId ?? null) !== (node.parentId ?? null)) return offset
  const elevation = (host as SlabNode).elevation
  return (Number.isFinite(elevation) ? elevation : 0) + offset
}
