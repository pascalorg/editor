import { useSyncExternalStore } from 'react'
import { getCadUnderlayRevision, subscribeToCadUnderlays } from '../lib/cad-underlay-cache'

/**
 * Re-render when a CAD underlay finishes loading.
 *
 * The registry's floor-plan builders are synchronous, but an underlay's
 * geometry lives in an asset that has to be fetched. A view that calls
 * `def.floorplan` reads the cache synchronously and gets nothing on the first
 * pass; this subscription is what brings it back once the asset lands.
 */
export function useCadUnderlayRevision(): number {
  return useSyncExternalStore(
    subscribeToCadUnderlays,
    getCadUnderlayRevision,
    getCadUnderlayRevision,
  )
}
