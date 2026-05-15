import type { ParametricDescriptor } from '@pascal-app/core'
import type { ItemNode } from './schema'

/**
 * Minimal inspector descriptor for item. Items have catalog-driven
 * properties (asset.id, asset.dimensions, asset.interactive controls,
 * etc.) that don't fit the auto-inspector at Stage A — those are edited
 * via the legacy `<ItemPanel>` which renders the catalog-defined
 * controls dynamically. Auto-inspector covers only the per-instance
 * transform (uniform scale).
 *
 * Phase 5 Stage E (drop legacy panel) probably uses
 * `parametrics.customPanel` to render the catalog-driven controls in
 * a registry-aware way.
 */
export const itemParametrics: ParametricDescriptor<ItemNode> = {
  groups: [],
}
