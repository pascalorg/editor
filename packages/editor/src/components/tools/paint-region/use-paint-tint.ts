import {
  getCatalogMaterialById,
  parseMaterialRef,
  type SceneMaterialId,
  useScene,
} from '@pascal-app/core'
import { useMemo } from 'react'
import { usePaintRegionMode } from '../../../lib/paint-region-mode'
import useEditor from '../../../store/use-editor'

/**
 * The paint material's colour for a region preview: a library preset's
 * preview colour, a scene material's colour, or a plain material colour;
 * `fallback` for the eraser or a material with no cheap colour.
 */
export function usePaintTint(fallback: string): string {
  const active = useEditor((state) => state.activePaintMaterial)
  const eraser = usePaintRegionMode((state) => state.mode) === 'erase'
  const materials = useScene((state) => state.materials)
  return useMemo(() => {
    if (eraser) return fallback
    const parsed = parseMaterialRef(active?.materialPreset)
    if (parsed?.kind === 'library') {
      const color = getCatalogMaterialById(parsed.id)?.previewColor
      if (color) return color
    }
    if (parsed?.kind === 'scene') {
      const color = materials[parsed.id as SceneMaterialId]?.material.properties?.color
      if (color) return color
    }
    return (
      active?.material?.properties?.color ??
      getCatalogMaterialById(active?.material?.id)?.previewColor ??
      fallback
    )
  }, [active, eraser, materials, fallback])
}
