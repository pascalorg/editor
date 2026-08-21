import type { AnyNode, CupolaMaterialRole, MaterialSchema } from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import { buildSlotPreviewMaterial, createSlotPaintCapability } from '../shared/slot-paint'
import { CUPOLA_MATERIAL_INDEX } from './geometry'

type LegacyCupola = AnyNode & { material?: MaterialSchema; materialPreset?: string }

export function resolveCupolaMaterialRole(materialIndex: number | null): CupolaMaterialRole {
  if (materialIndex === CUPOLA_MATERIAL_INDEX.body) return 'body'
  if (materialIndex === CUPOLA_MATERIAL_INDEX.roof) return 'roof'
  return 'base'
}

export const cupolaPaint = createSlotPaintCapability({
  materialTarget: 'cupola',
  resolveRole: ({ materialIndex }) => resolveCupolaMaterialRole(materialIndex),
  applyPreview: ({ role, material, materialPreset, root }) => {
    const preview = buildSlotPreviewMaterial(material, materialPreset)
    if (!preview) return null
    const materialIndex = CUPOLA_MATERIAL_INDEX[role as CupolaMaterialRole]
    let restore: (() => void) | null = null
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || mesh.name !== 'cupola-surface' || !Array.isArray(mesh.material)) return
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
    const legacy = node as LegacyCupola
    return { material: legacy.material, materialPreset: legacy.materialPreset }
  },
})
