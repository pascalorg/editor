/**
 * Terrain as the level base — the third and last place flat ground was assumed.
 *
 * `getFloorPlacedElevation` returns a *lift* added to a node's level-local Y, and
 * two of its `0`-returns mean "supported by the level base". This module is what
 * those two branches call so that "the level base" can mean the sculpted ground
 * instead of the plane `y = 0`. The other `0`-returns are `+0` no-ops for
 * wall/ceiling-attached items, non-`level` parents, and broken graphs; substituting
 * terrain there would lift sconces off walls, so they stay `0` forever.
 *
 * The whole file is pure — nodes in, metres out — which is what lets the stacking
 * matrix be tested per kind without a canvas.
 */

import type { AnyNode, AnyNodeId } from '../schema'
import type { BuildingNode } from '../schema/nodes/building'
import type { SiteNode } from '../schema/nodes/site'
import { getLevelElevations } from '../services/storey'
import { heightAt } from './terrain-field'
import { terrainFieldOf } from './terrain-source'

/**
 * World Y of the site datum — the plane terrain heights are measured from.
 *
 * Terrain vertices are absolute world coordinates (the site group renders at the
 * origin and `terrain-geometry` writes `origin + col * spacing` straight into the
 * buffer), so the datum is a constant rather than a site property. It is named
 * because the *comparison* against it is load-bearing, not the value: it is what
 * separates "the ground" from every other horizontal surface in the scene.
 */
export const SITE_DATUM_Y = 0

/**
 * How close a surface must sit to the datum to count as the ground.
 *
 * Loose enough to absorb float drift through a level's world matrix, tight enough
 * that a ground slab (5 cm) still reads as a built surface rather than as terrain.
 */
export const SITE_DATUM_EPSILON = 1e-4

/** True when a world-space height is the site datum — i.e. the terrain's plane. */
export function isSiteDatum(worldY: number): boolean {
  return Math.abs(worldY - SITE_DATUM_Y) < SITE_DATUM_EPSILON
}

/**
 * `getLevelElevations` memoized on the `nodes` record identity.
 *
 * Without this the stacking resolver is O(N) per node and therefore O(N²) per
 * frame, since `FloorElevationSystem` calls it for every dirty floor-placed node.
 * The scene store is immutable-by-convention, so the record identity is a correct
 * version key — the same reasoning (and the same `WeakMap` shape) as
 * `terrain-source`'s field cache and the spatial grid's `levelWallsCache`.
 */
const levelElevationCache = new WeakMap<object, ReturnType<typeof getLevelElevations>>()

function cachedLevelElevations(
  nodes: Record<string, AnyNode>,
): ReturnType<typeof getLevelElevations> {
  const cached = levelElevationCache.get(nodes)
  if (cached) return cached
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  levelElevationCache.set(nodes, elevations)
  return elevations
}

/**
 * `siteOf` memoized on the `nodes` record identity, for the same reason
 * `levelElevationCache` exists: the resolver is called per wall per frame (the
 * spatial grid) and per wall per store update (the space-detection trigger), so
 * an O(N) scan inside it makes those callers O(N²).
 */
const siteCache = new WeakMap<object, SiteNode | null>()

function siteOf(nodes: Record<string, AnyNode>): SiteNode | null {
  const cached = siteCache.get(nodes)
  if (cached !== undefined) return cached
  let site: SiteNode | null = null
  for (const node of Object.values(nodes)) {
    if (node?.type === 'site') {
      site = node as SiteNode
      break
    }
  }
  siteCache.set(nodes, site)
  return site
}

/**
 * Level-local XZ → world XZ, through the building's transform.
 *
 * A level group carries only a Y offset (`LevelSystem` writes `position.y` and
 * nothing else), so level-local XZ is building-local XZ; the building carries the
 * site-space placement, and the site renders at the origin. Only the Y rotation
 * matters — a building tipped in X or Z is not a thing the editor can produce.
 */
function levelLocalToWorldXZ(
  building: BuildingNode | null,
  x: number,
  z: number,
): [number, number] {
  if (!building) return [x, z]
  const angle = building.rotation?.[1] ?? 0
  const [px, , pz] = building.position ?? [0, 0, 0]
  if (angle === 0) return [x + px, z + pz]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [cos * x + sin * z + px, -sin * x + cos * z + pz]
}

/**
 * Where a level sits relative to the datum, for the levels terrain can support.
 *
 * **Only the storey the level stack puts at the datum follows terrain.** An upper
 * storey has a real floor, and draping it would sink its contents into the
 * hillside under the building. The test is that storey's own base height against
 * the datum — deliberately asked of `getLevelElevations`, the same function the
 * renderer positions level groups with, so placement can never hold a second
 * opinion about which storey is on the ground.
 *
 * Which storey that is follows from the stack, not from the ordinal: today the
 * lowest ordinal anchors at 0, so a building with an ordinal `-1` level has *that*
 * level at grade and its ground floor a storey up. When genuine below-grade
 * stacking lands, this rule tracks it with no change here — an excavated basement
 * will stop being at the datum, and stop being draped, on its own.
 */
function levelDatum(
  nodes: Record<string, AnyNode>,
  levelId: string,
): { building: BuildingNode | null; baseWorldY: number } | null {
  const elevation = cachedLevelElevations(nodes).get(levelId)
  if (!elevation) return null

  const building = elevation.buildingId
    ? ((nodes[elevation.buildingId] ?? null) as BuildingNode | null)
    : null
  const datum = building?.position?.[1] ?? 0
  const baseWorldY = datum + elevation.baseY
  if (!isSiteDatum(baseWorldY)) return null

  return { building, baseWorldY }
}

/**
 * Whether the sculpted ground is what a node on `levelId` stands on — i.e.
 * whether moving the terrain moves that node.
 *
 * Split out of `terrainSupportLift` so the invalidation rule that re-elevates
 * nodes after a sculpt (`markTerrainSupportDependents`) tests grade-ness with
 * the *same* predicate the resolver does. Two copies of this test would drift,
 * and the failure is silent: a level the resolver drapes but the dirty rule
 * skips leaves its contents frozen at the height the ground used to be.
 *
 * Deliberately independent of whether a field exists. A stroke that clears the
 * terrain has to re-elevate exactly the nodes a stroke that creates it does, and
 * asking about the field here would mark none of them on the way back down.
 */
export function isLevelAtSiteDatum(nodes: Record<string, AnyNode>, levelId: string): boolean {
  return levelDatum(nodes, levelId) !== null
}

/**
 * The lift, in level-local metres, that the sculpted ground provides to a node on
 * `levelId` at level-local `x`/`z`. Null when terrain does not support this node —
 * no sculpted ground, an unresolvable level, or a storey whose floor is not at
 * grade.
 *
 * Null rather than 0 so callers keep their existing flat-ground path verbatim.
 * That is what makes this change invisible to every scene that never touched
 * terrain, which is nearly all of them.
 */
export function terrainSupportLift(
  nodes: Record<string, AnyNode>,
  levelId: string,
  x: number,
  z: number,
): number | null {
  const site = siteOf(nodes)
  const field = site ? terrainFieldOf(site) : null
  if (!field) return null

  const datum = levelDatum(nodes, levelId)
  if (!datum) return null

  const [worldX, worldZ] = levelLocalToWorldXZ(datum.building, x, z)
  // The lift is measured from the storey's own base, so a building sited on a
  // datum other than 0 does not double-count it.
  return heightAt(field, worldX, worldZ) - datum.baseWorldY
}

/**
 * **The level base, in level-local metres, at level-local `x`/`z`** — the surface
 * a node rests on when nothing built is under it. Sculpted ground where terrain
 * supports this storey, `0` everywhere else.
 *
 * This is the one function every "nothing is under me, so I'm at zero" site in
 * the codebase should call, and the reason it exists separately from
 * {@link terrainSupportLift}: that function answers *"is there terrain here"*
 * (nullable, so a caller can branch), while this one answers *"how high is the
 * floor of the world here"* (total, so a caller does not have to know terrain
 * exists). Spelling the second question `terrainSupportLift(…) ?? 0` at each
 * site is what made terrain opt-in per kind — every new consumer had to remember
 * to ask, and the ones that forgot silently assumed the plane `y = 0`. Kinds
 * inherit terrain by resolving their base through here instead of hardcoding a
 * zero; nothing has to be registered for that to work.
 *
 * Callers that must distinguish "flat ground" from "a built surface flush with
 * the storey base" still need {@link terrainSupportLift}'s null — both read `0`
 * here and only the first follows a hillside.
 */
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
