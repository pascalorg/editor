'use client'

import type { ConstructionRevealLevel } from '@pascal-app/viewer'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const CONSTRUCTION_REVEAL_LEVELS: readonly ConstructionRevealLevel[] = [
  'off',
  'simple',
  'full',
  'framing',
]

export const CONSTRUCTION_REVEAL_STORAGE_KEY = 'pascal-construction-reveal'

const DEFAULT_LEVEL: ConstructionRevealLevel = 'full'

function normalizeLevel(value: unknown): ConstructionRevealLevel {
  return CONSTRUCTION_REVEAL_LEVELS.includes(value as ConstructionRevealLevel)
    ? (value as ConstructionRevealLevel)
    : DEFAULT_LEVEL
}

/** Reads `localStorage` on each call, so a page without it (a test, a sandbox) still has the store's persist API. */
const browserStorage = createJSONStorage(() => ({
  getItem: (key: string) => globalThis.localStorage?.getItem(key) ?? null,
  setItem: (key: string, value: string) => globalThis.localStorage?.setItem(key, value),
  removeItem: (key: string) => globalThis.localStorage?.removeItem(key),
}))

type ConstructionRevealState = {
  /** How much of an agent's build plays as a construction; the host passes it to `ConstructionReveal`. */
  level: ConstructionRevealLevel
  setLevel: (level: ConstructionRevealLevel) => void
}

/** The person's construction-animation preference, kept across sessions. */
const useConstructionReveal = create<ConstructionRevealState>()(
  persist(
    (set) => ({
      level: DEFAULT_LEVEL,
      setLevel: (level) => set({ level }),
    }),
    {
      name: CONSTRUCTION_REVEAL_STORAGE_KEY,
      storage: browserStorage,
      partialize: (state) => ({ level: state.level }),
      merge: (persisted, current) => ({
        ...current,
        level: normalizeLevel((persisted as { level?: unknown } | undefined)?.level),
      }),
    },
  ),
)

export default useConstructionReveal
