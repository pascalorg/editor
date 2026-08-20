import type { AnyNode, EyebrowVentMaterialRole, MaterialSchema } from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import { buildSlotPreviewMaterial, createSlotPaintCapability } from '../shared/slot-paint'
import { EYEBROW_VENT_MATERIAL_INDEX } from './geometry'

type LegacyEyebrowVent = AnyNode & { material?: MaterialSchema; materialPreset?: string }

export function resolveEyebrowVentMaterialRole(
  materialIndex: number | null,
): EyebrowVentMaterialRole {
  return materialIndex === EYEBROW_VENT_MATERIAL_INDEX.front ? 'front' : 'hood'
}

export const eyebrowVentPaint = createSlotPaintCapability({
  materialTarget: 'eyebrow-vent',
  resolveRole: ({ materialIndex }) => resolveEyebrowVentMaterialRole(materialIndex),
  applyPreview: ({ role, material, materialPreset, root }) => {
    const preview = buildSlotPreviewMaterial(material, materialPreset)
    if (!preview) return null
    const materialIndex = EYEBROW_VENT_MATERIAL_INDEX[role as EyebrowVentMaterialRole]
    let restore: (() => void) | null = null
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || mesh.name !== 'eyebrow-vent-surface' || !Array.isArray(mesh.material))
        return
      const previous = [...mesh.material]
      const next = [...previous]
      next[materialIndex] = preview
      mesh.material = next
      restore = () => {
        mesh.material = previous
      }
    })
    return restore
  },
  legacyEffective: (node) => {
    const legacy = node as LegacyEyebrowVent
    return { material: legacy.material, materialPreset: legacy.materialPreset }
  },
})
