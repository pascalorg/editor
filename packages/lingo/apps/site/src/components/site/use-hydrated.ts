'use client'

import { useSyncExternalStore } from 'react'

function subscribe() {
  return () => {
    // Hydration is a one-way transition; there is nothing to unsubscribe from.
  }
}

const onClient = () => true
const onServer = () => false

/**
 * `false` during SSR and the first client render, `true` afterwards. Demos that
 * parse relative dates use it to hold a fixed reference time through hydration
 * and then switch to the real clock, so the markup matches but the reading is
 * not frozen at build time.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer)
}
