import { createJSONStorage, type PersistStorage } from 'zustand/middleware'

/**
 * localStorage for a persisted store that rehydrates on mount (`skipHydration`).
 *
 * `persist` writes the whole stored state on every `set`, hydrated or not, so a
 * single write before the editor mounts (a host component's own mount effect
 * runs first) replaced the stored preferences with the defaults, and rehydrate
 * then read the defaults back. Until the store has hydrated, writes stay in
 * memory and rehydrate merges the stored blob over them: host code that sets a
 * persisted field before then has to wait for `persist.onFinishHydration`.
 */
export function hydrationGatedStorage<S>(
  hasHydrated: () => boolean,
): PersistStorage<S> | undefined {
  const storage = createJSONStorage<S>(() => window.localStorage)
  if (!storage) return undefined
  return {
    ...storage,
    setItem: (name, value) => {
      if (hasHydrated()) return storage.setItem(name, value)
    },
  }
}
