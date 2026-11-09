import type { AnyNode } from '../schema'
import { terrainFieldOf } from './terrain-source'
import { terrainSupportLift as queryTerrainSupportLift } from './terrain-support-query'

export {
  isLevelAtSiteDatum,
  isSiteDatum,
  SITE_DATUM_EPSILON,
  SITE_DATUM_Y,
} from './terrain-support-query'

export function terrainSupportLift(
  nodes: Record<string, AnyNode>,
  levelId: string,
  x: number,
  z: number,
): number | null {
  return queryTerrainSupportLift(nodes, levelId, x, z, terrainFieldOf)
}

export function levelBaseElevationAt(
  nodes: Record<string, AnyNode>,
  levelId: string,
  x: number,
  z: number,
): number {
  return terrainSupportLift(nodes, levelId, x, z) ?? 0
}

/**
 * Kinds whose geometry builder has actually asked for the level base, learned at
 * runtime from the first build rather than declared.
 *
 * A builder that bakes its vertical origin (`ctx.levelBaseAt`) must be rebuilt
 * when the ground moves, and core cannot see inside a pure function to know
 * which kinds do. The two declarative alternatives both fail the goal: a flag on
 * the definition is another per-kind opt-in — the exact thing that left half the
 * scene flat on a hillside — and over-approximating to "every kind with a
 * geometry builder" would rebuild every cabinet and duct on the ground floor on
 * every dab of a brush stroke.
 *
 * So the question is answered by the call itself: asking for the ground is what
 * enrolls the kind in following it. A plugin inherits terrain by reading
 * `ctx.levelBaseAt` and nothing else — no registration, no capability, no core
 * change. Keyed by node *type*, not id: types are bounded and stable, so the set
 * cannot leak with the scene, and a kind that asked once will ask again on every
 * subsequent build of every instance.
 *
 * Ordering is not a hazard: geometry builds on mount, long before any sculpt can
 * happen, and a node created after a stroke builds against the current field.
 */
const levelBaseConsumerKinds = new Set<string>()

/** Record that `type`'s geometry builder resolved its origin from the ground. */
export function noteLevelBaseConsumer(type: string): void {
  levelBaseConsumerKinds.add(type)
}

/** Whether `type`'s geometry has to be rebuilt when the sculpted ground moves. */
export function isLevelBaseConsumer(type: string): boolean {
  return levelBaseConsumerKinds.has(type)
}
