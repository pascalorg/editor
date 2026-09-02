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

export type PlacementPreviewDimension = {
  id: string
  start: [number, number, number]
  end: [number, number, number]
  offsetNormal: [number, number]
  offsetDistance: number
  value: number
  renderIn3d?: boolean
  renderInFloorplan?: boolean
}

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
  dimensions: PlacementPreviewDimension[]
  activeDimensionId: string | null
  dimensionInput: string
  set(
    node: AnyNode | null,
    parentNode?: AnyNode | null,
    dimensions?: PlacementPreviewDimension[],
  ): void
  selectDimension(id: string | null): void
  setDimensionInput(value: string): void
  clearDimensionEditor(): void
  clear(): void
}

const usePlacementPreview = create<PlacementPreviewState>((set) => ({
  node: null,
  parentNode: null,
  dimensions: [],
  activeDimensionId: null,
  dimensionInput: '',
  set: (node, parentNode = null, dimensions = []) =>
    set((state) => {
      const activeDimensionId = dimensions.some(
        (dimension) => dimension.id === state.activeDimensionId,
      )
        ? state.activeDimensionId
        : null
      return {
        node,
        parentNode,
        dimensions,
        activeDimensionId,
        dimensionInput: activeDimensionId ? state.dimensionInput : '',
      }
    }),
  selectDimension: (id) => set({ activeDimensionId: id, dimensionInput: '' }),
  setDimensionInput: (dimensionInput) => set({ dimensionInput }),
  clearDimensionEditor: () => set({ activeDimensionId: null, dimensionInput: '' }),
  clear: () =>
    set({
      node: null,
      parentNode: null,
      dimensions: [],
      activeDimensionId: null,
      dimensionInput: '',
    }),
}))

export default usePlacementPreview
