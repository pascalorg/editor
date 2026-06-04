// Ephemeral store for a placement tool's 2D floor-plan ghost. A registry
// placement tool (e.g. column / elevator) publishes a fully-positioned,
// transient preview node on each `grid:move`; the floor-plan
// placement-preview layer subscribes and renders the node's `def.floorplan`
// footprint as a faint ghost that follows the cursor. The 3D view already
// shows a translucent mesh preview, so this only feeds the 2D layer.
//
// Editor-only: the read-only viewer route never places nodes. Lives here
// rather than in `core` for that reason; node-kind tools (e.g. column) reach
// it through the `@pascal-app/editor` public surface, the same way they
// already consume `triggerSFX`. Producers clear on commit, cancel, and
// unmount.

import type { AnyNode } from '@pascal-app/core'
import { create } from 'zustand'

type PlacementPreviewState = {
  /** Transient preview node, already positioned + rotated at the (snapped,
   *  aligned) cursor. `null` when no placement is active. */
  node: AnyNode | null
  set(node: AnyNode | null): void
  clear(): void
}

const usePlacementPreview = create<PlacementPreviewState>((set) => ({
  node: null,
  set: (node) => set({ node }),
  clear: () => set({ node: null }),
}))

export default usePlacementPreview
