'use client'

import {
  getCatalogMaterialById,
  getDynamicLibraryMaterials,
  getLibraryMaterialIdFromRef,
  getLibraryMaterialsVersion,
  getMaterialsForCategory,
  MATERIAL_CATEGORIES,
  type MaterialSource,
  subscribeLibraryMaterials,
  toLibraryMaterialRef,
} from '@pascal-app/core'
import { useEffect, useState, useSyncExternalStore } from 'react'

export type MaterialSourceFilter = 'all' | MaterialSource
const SOURCE_FILTERS: { id: MaterialSourceFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pascal', label: 'Pascal' },
  { id: 'mine', label: 'Mine' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'community', label: 'Community' },
]

export function useMaterialCatalogModel(
  selectedMaterialPreset?: string,
  onSelectMaterialPreset?: (ref: string) => void,
  disabled = false,
) {
  const [selectedCategory, setCategory] = useState<(typeof MATERIAL_CATEGORIES)[number]>(
    MATERIAL_CATEGORIES[0],
  )
  const [sourceFilter, setSourceFilter] = useState<MaterialSourceFilter>('all')
  useSyncExternalStore(
    subscribeLibraryMaterials,
    getLibraryMaterialsVersion,
    getLibraryMaterialsVersion,
  )
  const availableCategories = MATERIAL_CATEGORIES.filter(
    (category) => getMaterialsForCategory(category).length > 0,
  )
  const visibleSourceFilters = SOURCE_FILTERS.filter(
    (filter) =>
      filter.id !== 'workspace' ||
      getDynamicLibraryMaterials().some((item) => item.source === 'workspace'),
  )
  const itemsFor = (category: typeof selectedCategory) =>
    getMaterialsForCategory(category).filter(
      (item) => sourceFilter === 'all' || (item.source ?? 'pascal') === sourceFilter,
    )
  useEffect(() => {
    const entry = getCatalogMaterialById(
      getLibraryMaterialIdFromRef(selectedMaterialPreset) ?? undefined,
    )
    if (entry?.category) setCategory(entry.category)
  }, [selectedMaterialPreset])
  const select = (id: string) => {
    if (!disabled) onSelectMaterialPreset?.(toLibraryMaterialRef(id))
  }
  const setSelectedCategory = (category: typeof selectedCategory) => {
    setCategory(category)
    const first = itemsFor(category)[0]
    if (first) select(first.id)
  }
  return {
    selectedCategory,
    setSelectedCategory,
    sourceFilter,
    setSourceFilter,
    visibleSourceFilters,
    availableCategories,
    catalogItems: itemsFor(selectedCategory),
    select,
  }
}
