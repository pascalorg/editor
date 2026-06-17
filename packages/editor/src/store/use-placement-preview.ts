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
  /** Optional synthetic parent for the preview's `def.floorplan` context.
   *  Door / window glyph builders need `ctx.parent` to be a wall to draw their
   *  real symbol (swing arc / panes); off any real wall we hand them a
   *  synthetic wall segment centred at the cursor so the floating ghost shows
   *  the faithful blueprint symbol instead of a bare rectangle. `null` for
   *  self-contained kinds (column / elevator). */
  parentNode: AnyNode | null
  set(node: AnyNode | null, parentNode?: AnyNode | null): void
  clear(): void
}

const usePlacementPreview = create<PlacementPreviewState>((set) => ({
  node: null,
  parentNode: null,
  set: (node, parentNode = null) => set({ node, parentNode }),
  clear: () => set({ node: null, parentNode: null }),
}))

export default usePlacementPreview
