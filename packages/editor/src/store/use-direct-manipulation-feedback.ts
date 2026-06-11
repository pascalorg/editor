import type { AnyNodeId } from '@pascal-app/core'
import { create } from 'zustand'

type DirectManipulationFeedbackState = {
  activeRotateNodeId: AnyNodeId | null
  setActiveRotateNodeId(nodeId: AnyNodeId | null): void
  clearActiveRotateNodeId(nodeId?: AnyNodeId): void
}

const useDirectManipulationFeedback = create<DirectManipulationFeedbackState>((set) => ({
  activeRotateNodeId: null,
  setActiveRotateNodeId: (activeRotateNodeId) => set({ activeRotateNodeId }),
  clearActiveRotateNodeId: (nodeId) =>
    set((state) => {
      if (nodeId !== undefined && state.activeRotateNodeId !== nodeId) return {}
      return { activeRotateNodeId: null }
    }),
}))

export default useDirectManipulationFeedback
