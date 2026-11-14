import type { AssetInput, GeometryScriptSource } from '../schema'

/**
 * A library item as the agent tools read and place it. A scripted one (a three.js recipe) carries
 * the script it was built from: placed with it, the item keeps its params, so add_object can
 * resize or rework it afterwards, where a plain GLB is fixed.
 */
export type CatalogAsset = AssetInput & { script?: GeometryScriptSource }

/** The item node fields a catalog entry places as: its asset, and its script as the node's source. */
export function catalogItemFields({ script, ...asset }: CatalogAsset): {
  asset: AssetInput
  source?: GeometryScriptSource
} {
  return { asset, ...(script && { source: script }) }
}
