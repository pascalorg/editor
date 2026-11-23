import * as React from 'react'

const MOBILE_BREAKPOINT = 768

const subscribe = (callback: () => void): (() => void) => {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

const getClientSnapshot = (): boolean => window.innerWidth < MOBILE_BREAKPOINT

// Server can't know the viewport — assume desktop. React's useSyncExternalStore
// reconciles the SSR / client snapshots without a hydration mismatch warning.
const getServerSnapshot = (): boolean => false

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
