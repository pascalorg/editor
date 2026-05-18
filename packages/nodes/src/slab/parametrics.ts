import type { ParametricDescriptor } from '@pascal-app/core'
import type { SlabNode } from './schema'

/**
 * Inspector descriptor for slab.
 *
 * Mounts the kind-owned `<SlabPanel>` via `customPanel` — the slab
 * editor has shape-specific concerns (elevation presets, area display,
 * holes list with auto-vs-manual provenance) that don't fit the
 * auto-derived field model. `groups` retained as a placeholder for the
 * future when `list` / `computed` / `action` field kinds let this
 * collapse into pure parametrics.
 */
export const slabParametrics: ParametricDescriptor<SlabNode> = {
  groups: [
    {
      label: 'Elevation',
      fields: [{ key: 'elevation', kind: 'number', unit: 'm', min: 0.02, max: 1, step: 0.01 }],
    },
  ],
  customPanel: () => import('./panel'),
}
