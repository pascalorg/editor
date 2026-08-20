import type { AnyNode, MaterialSchema, TurbineVentMaterialRole } from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import { buildSlotPreviewMaterial, createSlotPaintCapability } from '../shared/slot-paint'

type LegacyTurbineVent = AnyNode & { material?: MaterialSchema; materialPreset?: string }

export function resolveTurbineVentMaterialRole(hitObjectName?: string): TurbineVentMaterialRole {
  return hitObjectName === 'turbine-vent-head' ? 'head' : 'base'
}

export const turbineVentPaint = createSlotPaintCapability({
  materialTarget: 'turbine-vent',
  resolveRole: ({ hitObjectName }) => resolveTurbineVentMaterialRole(hitObjectName),
  applyPreview: ({ role, material, materialPreset, root }) => {
    const preview = buildSlotPreviewMaterial(material, materialPreset)
    if (!preview) return null
    const targetName = `turbine-vent-${role}`
    const restores: Array<() => void> = []
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || mesh.name !== targetName) return
      const previous = mesh.material
      mesh.material = preview
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
    const legacy = node as LegacyTurbineVent
    return { material: legacy.material, materialPreset: legacy.materialPreset }
  },
})
