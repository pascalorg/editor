import { create } from 'zustand'

export type LiveFenceSegment = {
  start: [number, number]
  end: [number, number]
}

type LiveFenceSegmentState = {
  segments: Map<string, LiveFenceSegment>
  set: (nodeId: string, segment: LiveFenceSegment) => void
  get: (nodeId: string) => LiveFenceSegment | undefined
  clear: (nodeId: string) => void
  clearAll: () => void
}

const useLiveFenceSegments = create<LiveFenceSegmentState>((set, get) => ({
  segments: new Map(),
  set: (nodeId, segment) =>
    set((state) => {
      const next = new Map(state.segments)
      next.set(nodeId, segment)
      return { segments: next }
    }),
  get: (nodeId) => get().segments.get(nodeId),
  clear: (nodeId) =>
    set((state) => {
      const next = new Map(state.segments)
      next.delete(nodeId)
      return { segments: next }
    }),
  clearAll: () => set({ segments: new Map() }),
}))

export default useLiveFenceSegments
