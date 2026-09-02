import type { AnyNodeId, GeometryContext } from '@pascal-app/core'
import { type BuildingFrame, type LooseNode, resolveFrameVia } from './site-frame'

/**
 * Resolve the building frame from a `def.floorplan` / `def.geometry`
 * context.
 *
 * Two starting points are tried, because the two dispatchers hand a
 * different `parent`:
 *  - the node's own `parentId` (the building, for these kinds); and
 *  - `ctx.parent`, which for a `floorplanScope: 'building'` kind the
 *    floor-plan layer SYNTHESISES as the active level, not the real parent
 *    (floorplan-registry-layer.tsx:995).
 * Whichever reaches a `building` first wins; neither → the identity frame,
 * so a scene with no building still draws (site coords == world coords).
 */
export function frameFromContext(node: LooseNode, ctx: GeometryContext): BuildingFrame {
  const resolve = (id: string): LooseNode | undefined =>
    ctx.resolve(id as AnyNodeId) as unknown as LooseNode | undefined
  const own = typeof node.parentId === 'string' ? node.parentId : null
  const fromOwn = resolveFrameVia(resolve, own)
  if (fromOwn.id) return fromOwn
  const parent = ctx.parent as unknown as LooseNode | null
  const parentId = typeof parent?.id === 'string' ? parent.id : null
  return resolveFrameVia(resolve, parentId)
}
