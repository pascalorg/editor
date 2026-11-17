import { livePreviewsVisible } from '../lib/live-previews'
import { terrainPreviewField } from './terrain-authority'
import type { TerrainField } from './terrain-field'
import { persistedTerrainFieldOf } from './terrain-source-persisted'
import type { TerrainNodes, TerrainSite } from './terrain-tiles'

export {
  commitTerrainField,
  persistedTerrainFieldOf,
  terrainFieldForEdit,
} from './terrain-source-persisted'

const previewCache = new WeakMap<TerrainField, WeakMap<TerrainField, TerrainField>>()
let sceneNodesOf: (() => TerrainNodes) | undefined
let liveFieldOf: ((siteId: string) => TerrainField | undefined) | undefined

/** The live store installs its reader so persisted migration queries stay headless. */
export function setTerrainLiveSource(source: (siteId: string) => TerrainField | undefined): void {
  liveFieldOf = source
}

/** The package entry installs the live store without making schema readers import it. */
export function setTerrainSceneSource(source: () => TerrainNodes): void {
  sceneNodesOf = source
}

function previewOf(live: TerrainField, persisted: TerrainField | null): TerrainField {
  let fields = previewCache.get(live)
  if (!fields) {
    fields = new WeakMap()
    previewCache.set(live, fields)
  }
  const key = persisted ?? live
  let field = fields.get(key)
  if (!field) {
    field = terrainPreviewField(live, persisted)
    fields.set(key, field)
  }
  return field
}

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
  site: TerrainSite | null | undefined,
  nodes?: TerrainNodes,
): TerrainField | null {
  const sceneNodes = nodes ?? (site?.id ? sceneNodesOf?.() : undefined)
  const persisted = persistedTerrainFieldOf(site, sceneNodes)
  if (site?.id && livePreviewsVisible()) {
    const live = liveFieldOf?.(site.id)
    if (live) return previewOf(live, persisted)
  }
  return persisted
}
