/**
 * The parcel service the lot tools read — injected by the host. The editor
 * ships no parcel backend: a host that has one calls `setParcelProvider` at
 * bootstrap, and until it does the address lookup is hidden and `dropInLot`
 * answers that no service is available.
 */
import { useSyncExternalStore } from 'react'

export type ParcelEndpoint = 'autocomplete' | 'resolve' | 'roads' | 'elevation' | 'dossier'

/**
 * Answers one parcel call with the endpoint's JSON. `body` is the request:
 * `{ q }` for `autocomplete`, the posted JSON for the others.
 */
export type ParcelProvider = (
  endpoint: ParcelEndpoint,
  body: Record<string, unknown>,
) => Promise<unknown>

let provider: ParcelProvider | null = null
const listeners = new Set<() => void>()

export function setParcelProvider(next: ParcelProvider | null): void {
  provider = next
  for (const listener of listeners) listener()
}

export function getParcelProvider(): ParcelProvider | null {
  return provider
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useParcelProvider(): ParcelProvider | null {
  return useSyncExternalStore(subscribe, getParcelProvider, getParcelProvider)
}

export const NO_PARCEL_SERVICE = 'No parcel service is available.'
