import { terrainSupportLift } from '../../lib/terrain-support'
import { nodeRegistry } from '../../registry'
import type {
  FloorPlacedConfig,
  FloorPlacedFootprint,
  FloorPlacedFootprintContext,
  FloorPlacedFootprintsResolver,
} from '../../registry/types'
import type { AnyNode, AnyNodeId } from '../../schema'
import { spatialGridManager } from './spatial-grid-manager'

export { GROUND_SUPPORT_ID } from './support-host-id'

import { GROUND_SUPPORT_ID } from './support-host-id'

/**
 * Sentinel `supportSlabId` meaning "hosted by the level base (ground)".
 * Persisted when a pointer-capped commit elects the ground while one or
 * more slabs (e.g. an elevated deck) still overlap the footprint above the
 * cap — without it, the uncapped per-frame election would lift the
 * committed node back onto the deck.
 */
export type FloorPlacedElevationArgs = {
  node: AnyNode
  nodes: Record<string, AnyNode>
  position: [number, number, number]
  rotation?: unknown
  levelId?: string | null
  /**
   * Pointer-decided support cap (level-local Y): only slabs whose walking
   * surface sits at or below `maxElevation + SUPPORT_ELEVATION_EPSILON`
   * may be elected, and the persisted `supportSlabId` is bypassed — during
   * a drag the pointer, not the stored host, decides the target surface.
   * Omit (or pass null) for the uncapped committed-read behavior.
   */
  maxElevation?: number | null
}

function finiteSlabElevation(elevation: number): number {
  return Number.isFinite(elevation) ? elevation : 0
}

function withPositionAndRotation({
  node,
  position,
  rotation,
}: Pick<FloorPlacedElevationArgs, 'node' | 'position' | 'rotation'>): AnyNode {
  return {
    ...(node as Record<string, unknown>),
    position,
    ...(rotation !== undefined ? { rotation } : {}),
  } as AnyNode
}

export function getFloorPlacedFootprints(
  floorPlaced: FloorPlacedConfig,
  node: AnyNode,
  ctx?: FloorPlacedFootprintContext,
): FloorPlacedFootprint[] {
  const rawFootprints = floorPlaced.footprints?.(node, ctx)
  if (rawFootprints) return [...rawFootprints]

  const footprint = floorPlaced.footprint?.(node, ctx)
  return footprint ? [footprint] : []
}

export function getFloorPlacedElevation({
  node,
  nodes,
  position,
  rotation,
  levelId,
  maxElevation,
}: FloorPlacedElevationArgs): number {
  const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
  if (!floorPlaced) return 0

  const effectiveNode = withPositionAndRotation({ node, position, rotation })
  if (floorPlaced.applies && !floorPlaced.applies(effectiveNode)) return 0

  const parentId = (effectiveNode as { parentId?: AnyNodeId | null }).parentId ?? null
  const parent = parentId ? nodes[parentId] : null
  if (parentId && !parent) return 0
  if (parent && parent.type !== 'level') return 0
  if (!parent && !levelId) return 0

  const resolvedLevelId = parent?.type === 'level' ? parent.id : levelId
  if (!resolvedLevelId) return 0

  const footprints = getFloorPlacedFootprints(floorPlaced, effectiveNode, { nodes })

  /**
   * What "the level base" evaluates to: the sculpted ground under this node, or 0
   * when the scene has no terrain / this storey is not at grade.
   *
   * Sampled once at the node's own XZ — not per footprint, and not averaged over
   * the footprint. One sample per node is what keeps a row of columns individually
   * correct on a slope while a composite node (a cabinet run, an L-shaped desk)
   * stays rigid instead of shearing across its own parts. Kinds that need a level
   * pad (stairs, a building's ground slab) get one by flattening the terrain under
   * them, which is a scene edit and therefore visible and undoable — not by
   * silently disagreeing with the ground here.
   *
   * Deliberately called only where level-base support is asserted. The six
   * `0`-returns above mean "do not touch this node's Y" — an attached item, a
   * non-`level` parent, a broken graph — and lifting those would pull wall sconces
   * and cabinet interiors off their hosts.
   */
  let groundLiftCache: number | null = null
  const groundLift = (): number => {
    groundLiftCache ??= terrainSupportLift(nodes, resolvedLevelId, position[0], position[2]) ?? 0
    return groundLiftCache
  }

  // A persisted support host pins the elevation while it still exists and
  // overlaps a footprint — deterministic across stacked slabs. A stale
  // host (deleted or reshaped away) silently falls through to the
  // election below; this per-frame read path never writes the field.
  // Skipped entirely under a pointer cap: the cursor, not the stored
  // host, decides the target surface during a drag.
  const supportSlabId = (effectiveNode as { supportSlabId?: string | null }).supportSlabId
  if (maxElevation == null && supportSlabId) {
    if (supportSlabId === GROUND_SUPPORT_ID) return groundLift()
    for (const footprint of footprints) {
      const hosted = spatialGridManager.getHostSlabElevationForFootprint(
        resolvedLevelId,
        supportSlabId,
        footprint.position ?? position,
        footprint.dimensions,
        footprint.rotation,
      )
      if (hosted !== null) return finiteSlabElevation(hosted)
    }
  }

  // Per footprint the support is its winning slab, or the level base when no slab
  // overlaps it; the node rests on the highest of them. The *slab id* is what says
  // which of the two it is — `getSlabSupportForItem` reports a no-winner election
  // as elevation 0, and terrain makes that ambiguous: a slab flush with the storey
  // base and bare ground both read as 0, and only the second follows a hillside.
  //
  // Electing the base per footprint rather than as a whole-node fallback is what
  // keeps this identical on flat ground, where `groundLift()` is 0: a composite node
  // straddling a recessed slab and bare floor still rests on the floor rather than
  // sinking into the recess.
  let elected = Number.NEGATIVE_INFINITY
  for (const footprint of footprints) {
    const support = spatialGridManager.getSlabSupportForItem(
      resolvedLevelId,
      footprint.position ?? position,
      footprint.dimensions,
      footprint.rotation,
      maxElevation,
    )
    const elevation =
      support.slabId === null ? groundLift() : finiteSlabElevation(support.elevation)
    if (elevation > elected) {
      elected = elevation
    }
  }

  // A kind with no footprint at all still rests on the ground.
  return elected === Number.NEGATIVE_INFINITY ? groundLift() : elected
}

export function getFloorStackedPosition(args: FloorPlacedElevationArgs): [number, number, number] {
  const [x, y, z] = args.position
  return [x, y + getFloorPlacedElevation(args), z]
}

export type { FloorPlacedFootprint, FloorPlacedFootprintContext, FloorPlacedFootprintsResolver }
