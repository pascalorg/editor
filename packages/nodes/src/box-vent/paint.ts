import type { AnyNode, BoxVentMaterialRole, MaterialSchema } from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import { buildSlotPreviewMaterial, createSlotPaintCapability } from '../shared/slot-paint'
import { BOX_VENT_MATERIAL_INDEX } from './geometry'

type LegacyBoxVent = AnyNode & { material?: MaterialSchema; materialPreset?: string }

export function resolveBoxVentMaterialRole(materialIndex: number | null): BoxVentMaterialRole {
  return materialIndex === BOX_VENT_MATERIAL_INDEX.top ? 'top' : 'base'
}

export const boxVentPaint = createSlotPaintCapability({
  materialTarget: 'box-vent',
  resolveRole: ({ materialIndex }) => resolveBoxVentMaterialRole(materialIndex),
  applyPreview: ({ role, material, materialPreset, root }) => {
    const preview = buildSlotPreviewMaterial(material, materialPreset)
    if (!preview) return null
    const materialIndex = BOX_VENT_MATERIAL_INDEX[role as BoxVentMaterialRole]
    const restores: Array<() => void> = []
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || mesh.name !== 'box-vent-surface' || !Array.isArray(mesh.material)) return
      const previous = [...mesh.material]
      if (!previous[materialIndex]) return
      const next = [...previous]
      next[materialIndex] = preview
      mesh.material = next
      restores.push(() => {
        mesh.material = previous
      })
    })
    if (restores.length === 0) return null
    return () => {
      for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
    }
  },
  legacyEffective: (node) => {
    const legacy = node as LegacyBoxVent
    return { material: legacy.material, materialPreset: legacy.materialPreset }
  },
})
