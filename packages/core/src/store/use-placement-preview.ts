// Ephemeral store for a placement tool's 2D floor-plan ghost. A registry
// placement tool (e.g. column) publishes a fully-positioned, transient
// preview node on each `grid:move`; the floor-plan placement-preview layer
// subscribes and renders the node's `def.floorplan` footprint as a faint
// ghost that follows the cursor. The 3D view already shows a translucent
// mesh preview, so this only feeds the 2D layer. Producers clear on commit,
// cancel, and unmount.

import { create } from 'zustand'
import type { AnyNode } from '../schema/types'

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
