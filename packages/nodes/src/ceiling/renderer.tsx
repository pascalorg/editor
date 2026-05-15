'use client'

import { CeilingRenderer } from '@pascal-app/viewer'

/**
 * Wrap-export of the legacy `CeilingRenderer`.
 *
 * Ceiling's renderer uses TSL shader code for the grid-line pattern
 * (~100 lines incl. material setup) — too much to duplicate at Stage A.
 * The legacy file stays in viewer; the registry imports it through the
 * public export. Phase 5 Stage B/F (per-kind migration stages, see
 * plans/editor-node-registry.md) moves the renderer body into this
 * folder and deletes the legacy file.
 */
export default CeilingRenderer
