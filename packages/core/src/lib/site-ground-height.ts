import type { AnyNode } from '../schema'
import { heightAt } from './terrain-field'
import { terrainFieldOf } from './terrain-source'

/**
 * Where a flat site's ground lies: the plane the site renderer draws its fill on, a hand under
 * the datum so the floors laid at grade sit on it and never inside it.
 */
export const FLAT_GROUND_Y = -0.05

/**
 * The height of the site's ground at a world XZ, as the renderer draws it: the sculpted terrain
 * where the site has one, the flat plane everywhere else. `site` is the site node (the caller
 * knows it; looking it up here would walk every node for every call).
 */
export function groundHeightAt(site: AnyNode | null | undefined, x: number, z: number): number {
  const field = site?.type === 'site' ? terrainFieldOf(site) : null
  return field ? heightAt(field, x, z) : FLAT_GROUND_Y
}
