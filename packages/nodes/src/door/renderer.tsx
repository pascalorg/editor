'use client'

import { DoorRenderer } from '@pascal-app/viewer'

/**
 * Wrap-export of the legacy `DoorRenderer`. The renderer is 33 lines
 * (thin placeholder + register + dirty-on-mount) — could be duplicated
 * but at Stage A re-export is sufficient. Phase 5 Stage F will inline
 * it here and delete the viewer-side file.
 */
export default DoorRenderer
