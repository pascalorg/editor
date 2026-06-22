import {
  type AnyNode,
  type CeilingNode,
  getMaterialPresetByRef,
  resolveMaterial,
} from '@pascal-app/core'
import type { Mesh } from 'three'
import { createSlotPaintCapability } from '../shared/slot-paint'
import { getCeilingMaterials } from './materials'

/**
 * Ceiling paint on the unified slot model. A ceiling has one paintable surface,
 * so every hit resolves to `surface`; commit writes `node.slots.surface`. The
 * preview swaps the registered underside mesh to the ceiling's own flat-tinted
 * material (built `BackSide`, the way it renders), so the hover preview matches
 * the committed result — a generic PBR preview would be invisible from below.
 */
export const ceilingPaint = createSlotPaintCapability({
  resolveRole: () => 'surface',
  applyPreview: ({ material, materialPreset, root }) => {
    const color = materialPreset
      ? (getMaterialPresetByRef(materialPreset)?.mapProperties.color ?? null)
      : material
        ? (resolveMaterial(material).color ?? null)
        : null
    if (!color) return () => {}
    const mesh = root as Mesh
    if (!mesh.isMesh) return null
    const previous = mesh.material
    mesh.material = getCeilingMaterials(color).bottomMaterial
    return () => {
      mesh.material = previous
    }
  },
  legacyEffective: (node: AnyNode) => {
    const ceiling = node as CeilingNode
    if (ceiling.materialPreset || ceiling.material) {
      return { material: ceiling.material, materialPreset: ceiling.materialPreset }
    }
    return null
  },
})
