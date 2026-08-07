import type { GeometryContext } from '@pascal-app/core/registry'
import type { AnyNode, ColumnNode, SlabNode, WallNode } from '@pascal-app/core/schema'
import { Group } from 'three'
import type { CastableHostNode } from './attach'
import { buildColumnFormwork } from './geometry-column'
import { panelMaterial, resolveFormworkScope } from './geometry-shared'
import { buildSlabFormwork } from './geometry-slab'
import { buildWallFormwork } from './geometry-wall'
import type { BuiltFormwork } from './parts'
import type { FormworkAssemblyNode } from './schema'

/**
 * Pure formwork geometry builder. Reads the host (`ctx.parent`) for its
 * dimensions and its shuttering fields (`tieSpacing`/`walerSpacing`/
 * `scaffoldRequired`), asks the coverage solver which faces are actually
 * formed, and hands both to the builder for that kind.
 *
 * The dispatch is per kind because the three shutters are different machines,
 * not one machine with different extents: a wall is two skins tied through the
 * concrete, a column is a self-reacting clamped box, and a slab is a decked
 * table propped off the floor below. They also live in three different local
 * spaces — see `attach.ts`.
 *
 * The assembly covers one pour unit, not the whole element: `segmentIndex` and
 * `liftIndex` select which (segment × lift) this shutter is, and everything is
 * built inside that unit's extents. A 9 m wall capped at 3 m lifts therefore
 * gets three shutters stacked up it, each with its own tie grid, rather than
 * one impossible 9 m one.
 *
 * A build produces geometry *and* the parts it is made of, from one pass — see
 * `parts.ts` for why they cannot be derived separately. The registry's geometry hook
 * wants only the group and the panels want only the parts, so both go through
 * `buildFormwork` and neither has its own enumeration.
 */
export function buildFormwork(
  node: FormworkAssemblyNode,
  ctx: GeometryContext,
): BuiltFormwork | null {
  const host = ctx.parent as AnyNode | null
  if (!host) return null
  if (host.type !== 'wall' && host.type !== 'column' && host.type !== 'slab') return null

  const castable = host as CastableHostNode
  if (!castable.formworkType || castable.formworkType === 'none') return null

  const scope = resolveFormworkScope(castable, node, ctx)
  if (!scope) return null
  const material = panelMaterial(castable)

  if (host.type === 'column') return buildColumnFormwork(host as ColumnNode, node, scope, material)
  if (host.type === 'slab') return buildSlabFormwork(host as SlabNode, node, scope, material)
  return buildWallFormwork(host as WallNode, node, scope, material)
}

export function buildFormworkGeometry(node: FormworkAssemblyNode, ctx: GeometryContext): Group {
  return buildFormwork(node, ctx)?.group ?? new Group()
}
