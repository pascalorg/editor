import type { PaintCapability, SolarPanelNode } from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import { buildSlotPreviewMaterial } from '../shared/slot-paint'
import { swapPreviewMaterial } from '../shared/swap-preview-material'

export const solarPanelPaint: PaintCapability = {
  resolveRole: ({ materialIndex }) => (materialIndex === 1 ? 'panel' : 'frame'),
  roleLabel: (_node, role) => (role === 'frame' ? 'Frame' : 'Panel'),
  buildPatch: ({ role, material, materialPreset }) =>
    role === 'panel'
      ? { panelMaterial: material, panelMaterialPreset: materialPreset }
      : { material, materialPreset },
  getEffectiveMaterial: ({ node, role }) => {
    const surface = node as SolarPanelNode
    return role === 'panel'
      ? { material: surface.panelMaterial, materialPreset: surface.panelMaterialPreset }
      : { material: surface.material, materialPreset: surface.materialPreset }
  },
  applyPreview: ({ role, material, materialPreset, root }) => {
    const preview = buildSlotPreviewMaterial(material, materialPreset)
    if (!preview) return null
    const restores: Array<() => void> = []
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      if (mesh.name !== 'solar-panel-surface' || !Array.isArray(mesh.material)) return
      const materials = [...mesh.material]
      materials[role === 'panel' ? 1 : 0] = preview
      restores.push(swapPreviewMaterial(mesh, materials))
    })
    return restores.length
      ? () => {
          for (const restore of restores) restore()
        }
      : null
  },
}
