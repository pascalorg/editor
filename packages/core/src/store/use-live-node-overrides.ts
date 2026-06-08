import { create } from 'zustand'

export type LiveNodeOverrides = Record<string, unknown>

type LiveNodeOverrideState = {
  overrides: Map<string, LiveNodeOverrides>
  set(nodeId: string, values: LiveNodeOverrides): void
  setMany(entries: ReadonlyArray<readonly [string, LiveNodeOverrides]>): void
  get(nodeId: string): LiveNodeOverrides | undefined
  clear(nodeId: string): void
  clearFields(nodeId: string, keys: readonly string[]): void
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
  // Batch update — one Map clone + one zustand notification regardless
  // of entry count, so a drag publishing to N linked walls re-renders
  // subscribers (WallSystem, FloorplanRegistryLayer) once per tick
  // instead of N+1 times.
  setMany: (entries) =>
    set((state) => {
      if (entries.length === 0) return state
      const next = new Map(state.overrides)
      for (const [nodeId, values] of entries) {
        next.set(nodeId, { ...(next.get(nodeId) ?? {}), ...values })
      }
      return { overrides: next }
    }),
  get: (nodeId) => get().overrides.get(nodeId),
  clear: (nodeId) =>
    set((state) => {
      const next = new Map(state.overrides)
      next.delete(nodeId)
      return { overrides: next }
    }),
  clearFields: (nodeId, keys) =>
    set((state) => {
      const current = state.overrides.get(nodeId)
      if (!current) return state

      const nextValues = { ...current }
      for (const key of keys) {
        delete nextValues[key]
      }

      const next = new Map(state.overrides)
      if (Object.keys(nextValues).length === 0) {
        next.delete(nodeId)
      } else {
        next.set(nodeId, nextValues)
      }
      return { overrides: next }
    }),
  clearAll: () => set({ overrides: new Map() }),
}))

/**
 * Merge any live override for `node` into a fresh copy. Spread semantics —
 * override fields win, untouched fields stay. Returns the input unchanged
 * when no override exists, so the caller can use the result directly
 * without an extra "did anything change" check.
 */
export function getEffectiveNode<T extends { id: string }>(node: T): T {
  const override = useLiveNodeOverrides.getState().overrides.get(node.id)
  if (!override || Object.keys(override).length === 0) return node
  return { ...node, ...override } as T
}

export default useLiveNodeOverrides
