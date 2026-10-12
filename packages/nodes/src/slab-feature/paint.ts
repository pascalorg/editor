import {
  type AnyNode,
  resolveSlabFeaturePlacement,
  sceneRegistry,
  slotDefaultPaintMaterial,
  slotPaintMaterial,
  useScene,
} from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import {
  beginSlotPaintPreview,
  buildSlotPreviewMaterial,
  createSlotPaintCapability,
} from '../shared/slot-paint'
import { swapPreviewMaterial } from '../shared/swap-preview-material'
import { slabFeatureFinish } from './finish'

export const slabFeaturePaint = createSlotPaintCapability({
  resolveRole: () => 'surface',
  erasedLook: () => null,
  applyPreview(args) {
    if (args.node.type !== 'slab-feature') return null
    const nodes: Readonly<Record<string, AnyNode>> = args.nodes ?? useScene.getState().nodes
    const p = resolveSlabFeaturePlacement(nodes, args.node)
    const root = sceneRegistry.nodes.get(p.slab.id) as Object3D | undefined
    if (!root) return null
    const erasing = args.material === undefined && args.materialPreset === undefined
    const finish = erasing ? slabFeatureFinish(args.node, nodes, args.node.id) : args.materialPreset
    const ref = typeof finish === 'string' ? finish : undefined
    const look =
      typeof finish === 'object'
        ? { material: finish, materialPreset: undefined }
        : (slotPaintMaterial(ref, args.materials ?? useScene.getState().materials) ??
          slotDefaultPaintMaterial(ref))
    const preview = buildSlotPreviewMaterial(
      args.material ?? look?.material,
      look?.materialPreset ?? ref,
    )
    if (!preview) return null
    const endHostPreview = beginSlotPaintPreview(p.slab.id)
    const restores: (() => void)[] = []
    root.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      let owner = nodes[mesh.userData.slabFeatureId]
      while (owner?.type === 'slab-feature') {
        if (owner.id === args.node.id) {
          restores.push(swapPreviewMaterial(mesh, preview))
          break
        }
        if (owner.slots?.surface) break
        owner = nodes[owner.parentId ?? '']
      }
    })
    if (!restores.length) {
      endHostPreview()
      return null
    }
    let ended = false
    const release = () => {
      if (!ended) {
        ended = true
        endHostPreview()
      }
    }
    return Object.assign(
      () => {
        if (ended) return
        try {
          for (const restore of restores.reverse()) restore()
        } finally {
          release()
        }
      },
      { commit: release },
    )
  },
})
slabFeaturePaint.getEffectiveMaterial = (args) => {
  if (args.node.type !== 'slab-feature') return null
  const finish = slabFeatureFinish(args.node, args.nodes)
  if (typeof finish !== 'string') return { material: finish, materialPreset: undefined }
  const look = slotPaintMaterial(finish, args.materials ?? {}) ?? slotDefaultPaintMaterial(finish)
  return look ? { material: look.material, materialPreset: look.materialPreset } : null
}
