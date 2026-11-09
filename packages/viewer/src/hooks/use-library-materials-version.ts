import { getLibraryMaterialsVersion, subscribeLibraryMaterials } from '@pascal-app/core'
import { useSyncExternalStore } from 'react'

/**
 * Re-render when dynamic library materials (un)register — AI-generated
 * `library:mtl_*` presets arrive after mount, and material caches keyed on
 * ref-resolution signatures must recompute once they land.
 */
export function useLibraryMaterialsVersion(): number {
  return useSyncExternalStore(
    subscribeLibraryMaterials,
    getLibraryMaterialsVersion,
    getLibraryMaterialsVersion,
  )
}
