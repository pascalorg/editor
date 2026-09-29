import type { SiteNode } from '../schema/nodes/site'
import useLiveTerrain from '../store/use-live-terrain'
import type { TerrainField } from './terrain-field'
import { persistedTerrainFieldOf } from './terrain-source-persisted'

export {
  commitTerrainField,
  persistedTerrainFieldOf,
  terrainFieldForEdit,
} from './terrain-source-persisted'

/**
 * The terrain field for a site, or `null` when the site has no sculpted terrain.
 *
 * `null` means flat ground at the datum. It is deliberately not "a flat field":
 * callers use `null` to take their existing flat-ground fast path, which keeps
 * every scene that has never touched terrain — the overwhelming majority —
 * running exactly the code it ran before terrain existed. That property is worth
 * more than the uniformity of always having a field.
 *
 * An in-flight sculpt stroke wins over the persisted data. Resolving that *here*
 * rather than per caller is what makes a stroke consistent: the mesh, the pointer
 * raycast, the placement predicate, the collider, and the 2D view all see the
 * same ground mid-drag without any of them knowing a stroke exists. The
 * alternative — each consumer checking the live store — is how a drag ends up
 * showing a hill the raycast cannot hit.
 */
export function terrainFieldOf(
  site: (Pick<SiteNode, 'terrain'> & { id?: string }) | null | undefined,
): TerrainField | null {
  if (site?.id) {
    const live = useLiveTerrain.getState().fieldOf(site.id)
    if (live) return live
  }
  return persistedTerrainFieldOf(site)
}
