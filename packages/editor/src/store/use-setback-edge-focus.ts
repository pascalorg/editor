// Which parcel edge the user is pointing at, shared by the three surfaces that
// each hold one end of the same conversation: the setback rows in the site
// panel, the floorplan's buildable-area layer, and the 3D site renderer.
//
// A store rather than props because those three live in different packages and
// two different render trees — the floorplan and the R3F canvas share nothing
// but the scene store. It is deliberately ephemeral: hovering an edge is not an
// edit, so it is neither persisted nor history-tracked.

import { create } from 'zustand'

type SetbackEdgeFocusState = {
  /** Edge under the pointer, in either view or in the panel. */
  hoveredEdge: number | null
  /** Edge the user clicked, which keeps its highlight after the pointer leaves. */
  selectedEdge: number | null
  setHoveredEdge: (edgeIndex: number | null) => void
  setSelectedEdge: (edgeIndex: number | null) => void
  clear: () => void
}

const useSetbackEdgeFocus = create<SetbackEdgeFocusState>((set) => ({
  hoveredEdge: null,
  selectedEdge: null,
  setHoveredEdge: (edgeIndex) => set({ hoveredEdge: edgeIndex }),
  setSelectedEdge: (edgeIndex) => set({ selectedEdge: edgeIndex }),
  clear: () => set({ hoveredEdge: null, selectedEdge: null }),
}))

export default useSetbackEdgeFocus
