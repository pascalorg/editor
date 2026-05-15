'use client'

import { ItemRenderer } from '@pascal-app/viewer'

/**
 * Wrap-export of the legacy `ItemRenderer`.
 *
 * Item's renderer is ~280 lines using `useGLTF` from `@react-three/drei`
 * to load GLB assets from the CDN. It also handles asset-loaded
 * `interactive` widgets (clickable hot-spots, sliders inside the
 * scene), surface mounting, attachment offsets — too much code to
 * duplicate at Stage A. Phase 5 Stage F (cleanup) moves it into this
 * folder if useful, or leaves it in viewer with the public re-export.
 *
 * Item is also the first kind to demonstrate the "custom def.renderer"
 * escape hatch documented in plans/editor-node-registry.md — kinds with
 * GLB loaders, drei helpers, `useGLTF`, etc., set `def.renderer` to a
 * full React component rather than trying to express geometry as a
 * pure builder.
 */
export default ItemRenderer
