import type { ParametricDescriptor, SiteNode } from '@pascal-app/core'

/**
 * Inspector descriptor for site.
 *
 * `customPanel` mounts `<SitePanel>` — address autocomplete, the parcel
 * lookup, setbacks and the front-edge picker need async network state and
 * feet↔metres conversion that the auto-derived field kinds don't cover.
 */
export const siteParametrics: ParametricDescriptor<SiteNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
