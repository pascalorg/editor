import { createJSONStorage, type PersistStorage } from 'zustand/middleware'

/**
 * localStorage for a persisted store that rehydrates on mount (`skipHydration`).
 *
 * `persist` saves the whole stored state on every `set`. A save before the
 * store has hydrated would replace the stored preferences with the defaults
 * before they are read (a host component's own mount effect runs first), so
 * those writes stay in memory and rehydrate merges the stored blob over them:
 * host code that sets a persisted field before then has to wait for
 * `persist.onFinishHydration`. After that, a save of the blob this tab already
 * holds is skipped, so an update that changes no preference never replaces
 * what another tab saved since. A blob that cannot be read counts as none:
 * hydration still finishes, on the defaults, and the next save replaces it.
 */
export function hydrationGatedStorage<S>(
  hasHydrated: () => boolean,
): PersistStorage<S> | undefined {
  let held: string | null = null
  const storage = createJSONStorage<S>(() => {
    const local = window.localStorage
    return {
      getItem: (name) => {
        held = local.getItem(name)
        return held
      },
      setItem: (name, value) => {
        if (!hasHydrated() || value === held) return
        held = value
        local.setItem(name, value)
      },
      removeItem: (name) => {
        held = null
        local.removeItem(name)
      },
    }
  })
  if (!storage) return undefined
  return {
    ...storage,
    getItem: (name) => {
      try {
        return storage.getItem(name)
      } catch {
        return null
      }
    },
  }
}
