'use client'

import { useSyncExternalStore } from 'react'
import { getRegistryVersion, nodeRegistry, onRegistryChange } from './registry'

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

/**
 * The registered definition of `kind`, kept current as plugins register. The
 * snapshot is the definition itself, so a registration of any other kind
 * leaves it identity-stable and re-renders nothing: only nodes of a kind that
 * registers (or changes) update.
 */
export function useNodeDefinition(kind: string | undefined) {
  const read = () => (kind === undefined ? undefined : nodeRegistry.get(kind))
  return useSyncExternalStore(onRegistryChange, read, read)
}
