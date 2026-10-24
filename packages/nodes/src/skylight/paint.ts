import type { PaintCapability, SkylightNode } from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import { buildSlotPreviewMaterial } from '../shared/slot-paint'
import { swapPreviewMaterial } from '../shared/swap-preview-material'

export const skylightPaint: PaintCapability = {
  resolveRole: ({ hitObject }) =>
    (hitObject as Mesh | undefined)?.name === 'skylight-glass' ? 'glass' : 'frame',
  roleLabel: (_node, role) => (role === 'frame' ? 'Frame' : 'Glass'),
  buildPatch: ({ role, material, materialPreset }) =>
    role === 'glass'
      ? { glassMaterial: material, glassMaterialPreset: materialPreset }
      : { material, materialPreset },
  getEffectiveMaterial: ({ node, role }) => {
    const surface = node as SkylightNode
    return role === 'glass'
      ? { material: surface.glassMaterial, materialPreset: surface.glassMaterialPreset }
      : { material: surface.material, materialPreset: surface.materialPreset }
  },
  applyPreview: ({ role, material, materialPreset, root }) => {
    const preview = buildSlotPreviewMaterial(material, materialPreset)
    if (!preview) return null
    const restores: Array<() => void> = []
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      if (mesh.name !== (role === 'glass' ? 'skylight-glass' : 'skylight-surface')) return
      restores.push(swapPreviewMaterial(mesh, preview))
    })
    return restores.length
      ? () => {
          for (const restore of restores) restore()
        }
      : null
  },
}
