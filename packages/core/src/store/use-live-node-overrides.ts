import { create } from 'zustand'

export type LiveNodeOverrides = Record<string, unknown>

type LiveNodeOverrideState = {
  overrides: Map<string, LiveNodeOverrides>
  set(nodeId: string, values: LiveNodeOverrides): void
  get(nodeId: string): LiveNodeOverrides | undefined
  clear(nodeId: string): void
  clearAll(): void
}

const useLiveNodeOverrides = create<LiveNodeOverrideState>((set, get) => ({
  overrides: new Map(),
  set: (nodeId, values) =>
    set((state) => {
      const next = new Map(state.overrides)
      next.set(nodeId, { ...(next.get(nodeId) ?? {}), ...values })
      return { overrides: next }
    }),
  get: (nodeId) => get().overrides.get(nodeId),
  clear: (nodeId) =>
    set((state) => {
      const next = new Map(state.overrides)
      next.delete(nodeId)
      return { overrides: next }
    }),
  clearAll: () => set({ overrides: new Map() }),
}))

export default useLiveNodeOverrides
