'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const FOLLOW_PASCAL_STORAGE_KEY = 'pascal-follow-pascal'

/** Reads `localStorage` on each call, so a page without it (a test, a sandbox) still has the store's persist API. */
const browserStorage = createJSONStorage(() => ({
  getItem: (key: string) => globalThis.localStorage?.getItem(key) ?? null,
  setItem: (key: string, value: string) => globalThis.localStorage?.setItem(key, value),
  removeItem: (key: string) => globalThis.localStorage?.removeItem(key),
}))

type FollowPascalState = {
  /** The person's switch: the camera follows what a build works on. Kept across sessions. */
  on: boolean
  /** The person took the camera: it stays theirs until they resume or the next build begins. */
  paused: boolean
  /** A build is playing (set by the follower from the reveal's own words). */
  building: boolean
  setOn: (on: boolean) => void
  pause: () => void
  resume: () => void
  beginBuild: () => void
  endBuild: () => void
}

/** Follow Pascal's switch, its pause and whether a build is being followed. */
const useFollowPascal = create<FollowPascalState>()(
  persist(
    (set, get) => ({
      on: true,
      paused: false,
      building: false,
      setOn: (on) => set({ on, paused: false }),
      pause: () => {
        if (get().on) set({ paused: true })
      },
      resume: () => set({ paused: false }),
      beginBuild: () => set({ building: true, paused: false }),
      endBuild: () => set({ building: false }),
    }),
    {
      name: FOLLOW_PASCAL_STORAGE_KEY,
      storage: browserStorage,
      partialize: (state) => ({ on: state.on }),
    },
  ),
)

export default useFollowPascal
export { useFollowPascal }
