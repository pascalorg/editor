import type { ParametricDescriptor } from '@pascal-app/core'
import type { ItemNode } from './schema'

/**
 * Inspector descriptor for item. The fields shape (position / rotation /
 * scale sliders, catalog popover, move / duplicate / delete actions)
 * can't be expressed via the auto-inspector — they need the kind-owned
 * `<ItemPanel>` for layout, the catalog popover, and the move-on-pick
 * behaviour. `customPanel` mounts `panel.tsx` through
 * `<ParametricInspector>`'s lazy-load slot.
 */
export const itemParametrics: ParametricDescriptor<ItemNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
