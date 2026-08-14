'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type StickyParams = Record<string, unknown>

interface StickyDefaultsState {
  /**
   * Last-used build parameters per node kind — the "draw the next wall at
   * the thickness I just used" memory. Written whenever an instance is
   * created or its parameters edited, filtered to the kind's
   * `capabilities.stickyParams`; read by `setTool`, which seeds
   * `toolDefaults` from it.
   */
  lastUsedParams: Record<string, StickyParams>
  /** Merge a just-created or just-edited instance's parameters into its kind. */
  remember: (kind: string, params: StickyParams) => void
}

export const STICKY_DEFAULTS_STORAGE_KEY = 'pascal-editor-sticky-defaults'

/**
 * Deliberately its own store rather than another slice of `useEditor`.
 *
 * `useEditor` persists with `skipHydration`, rehydrating from an effect once
 * the editor mounts — and the app's startup writes to that store before the
 * effect runs, so the persist middleware saves the still-default state over
 * whatever was on disk. Fields the UI re-sets on every boot (`tool`, `phase`)
 * never notice; a memory the user expects to outlive a reload would be
 * erased every time. Keeping it under its own key, hydrated the ordinary
 * synchronous way, takes the race out of the picture.
 */
export const useStickyDefaults = create<StickyDefaultsState>()(
  persist(
    (set) => ({
      lastUsedParams: {},
      remember: (kind, params) =>
        set((state) => {
          if (Object.keys(params).length === 0) return {}
          const previous = state.lastUsedParams[kind]
          const next = { ...previous, ...params }
          // Moves and other non-sticky edits produce an identical set; bail so
          // a drag doesn't churn the store (and the storage write behind it).
          if (previous && shallowEqualParams(previous, next)) return {}
          return { lastUsedParams: { ...state.lastUsedParams, [kind]: next } }
        }),
    }),
    {
      name: STICKY_DEFAULTS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ lastUsedParams }) => ({ lastUsedParams }),
      merge: (persisted, current) => ({
        ...current,
        lastUsedParams: normalizeLastUsedParams(
          (persisted as { lastUsedParams?: unknown } | null)?.lastUsedParams,
        ),
      }),
    },
  ),
)

function shallowEqualParams(a: StickyParams, b: StickyParams): boolean {
  const keys = Object.keys(b)
  if (keys.length !== Object.keys(a).length) return false
  return keys.every((key) => Object.is(a[key], b[key]))
}

/**
 * Persisted parameters arrive from `localStorage`, so they are untrusted
 * shape. Keep only kind → plain-object entries; anything else is dropped
 * rather than handed to a tool's create path.
 */
function normalizeLastUsedParams(value: unknown): Record<string, StickyParams> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, params]) => !!params && typeof params === 'object' && !Array.isArray(params),
  )
  return Object.fromEntries(entries) as Record<string, StickyParams>
}

/** The parameters a kind was last used at, or `null` if it never has been. */
export function getStickyParamsForKind(kind: string): StickyParams | null {
  const remembered = useStickyDefaults.getState().lastUsedParams[kind]
  return remembered && Object.keys(remembered).length > 0 ? remembered : null
}
