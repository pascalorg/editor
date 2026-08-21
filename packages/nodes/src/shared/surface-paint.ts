import type { AnyNode, MaterialSchema } from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import { buildSlotPreviewMaterial, createSlotPaintCapability } from './slot-paint'

type LegacySurfaceNode = AnyNode & { material?: MaterialSchema; materialPreset?: string }

export const surfacePaintCapability = createSlotPaintCapability({
  resolveRole: () => 'surface',
  applyPreview: ({ material, materialPreset, root }) => {
    const preview = buildSlotPreviewMaterial(material, materialPreset)
    if (!preview) return null
    const restores: Array<() => void> = []
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
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
    const legacy = node as LegacySurfaceNode
    return { material: legacy.material, materialPreset: legacy.materialPreset }
  },
})
