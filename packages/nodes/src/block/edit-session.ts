import type { BlockTopology } from '@pascal-app/core'
import { create } from 'zustand'
import { type BlockSelectionState, createBlockSelection } from './selection-model'

type BlockEditSessionState = {
  nodeId: string | null
  selection: BlockSelectionState
  activeMaterialSlotId: string | null
  begin: (nodeId: string, selection: BlockSelectionState) => void
  end: (nodeId: string) => void
  setSelection: (nodeId: string, selection: BlockSelectionState) => void
  setActiveMaterialSlot: (nodeId: string, slotId: string) => void
  reconcileSelection: (nodeId: string, topology: BlockTopology) => void
}

const emptySelection = () => createBlockSelection('face')

const useBlockEditSession = create<BlockEditSessionState>((set) => ({
  nodeId: null,
  selection: emptySelection(),
  activeMaterialSlotId: null,
  begin: (nodeId, selection) => set({ nodeId, selection, activeMaterialSlotId: null }),
  end: (nodeId) =>
    set((state) =>
      state.nodeId === nodeId
        ? { nodeId: null, selection: emptySelection(), activeMaterialSlotId: null }
        : state,
    ),
  setSelection: (nodeId, selection) =>
    set((state) => (state.nodeId === nodeId ? { selection } : state)),
  setActiveMaterialSlot: (nodeId, activeMaterialSlotId) =>
    set((state) => (state.nodeId === nodeId ? { activeMaterialSlotId } : state)),
  reconcileSelection: (nodeId, topology) =>
    set((state) => {
      if (state.nodeId !== nodeId) return state
      const validIds = new Set(
        state.selection.mode === 'vertex'
          ? topology.vertices.map((vertex) => vertex.id)
          : state.selection.mode === 'edge'
            ? topology.edges.map((edge) => edge.id)
            : topology.faces.map((face) => face.id),
      )
      const ids = state.selection.ids.filter((id) => validIds.has(id))
      const activeId =
        state.selection.activeId && ids.includes(state.selection.activeId)
          ? state.selection.activeId
          : (ids.at(-1) ?? null)
      if (ids.length === state.selection.ids.length && activeId === state.selection.activeId) {
        return state
      }
      return { selection: { ...state.selection, ids, activeId } }
    }),
}))

export default useBlockEditSession
