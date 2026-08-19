'use client'

import { useSyncExternalStore } from 'react'
import { getRegistryVersion, onRegistryChange } from './registry'

/**
 * React binding for the node registry's change counter. Re-renders the
 * consumer whenever a kind registers (plugin kinds arrive asynchronously via
 * dynamic-import discovery, AFTER the first mount). Effects that snapshot
 * registry-derived lists — `getSelectableKinds()` subscription lists in the
 * selection managers — add the returned version to their dependency array so
 * a late plugin load rebuilds the subscriptions instead of leaving the
 * plugin's kinds without hover / click handlers.
 */
export function useRegistryVersion(): number {
  return useSyncExternalStore(onRegistryChange, getRegistryVersion, getRegistryVersion)
}
