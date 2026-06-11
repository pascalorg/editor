import type { AnyNode, MaterialSchema, PaintCapability } from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef } from '@pascal-app/viewer'
import type { Material, Mesh, Object3D } from 'three'

/**
 * Paint capability for kinds with a single painted surface (`role: 'surface'`)
 * that register a `<group>` of meshes all sharing one material — the roof
 * vents (box / ridge / turbine / cupola / eyebrow). Replaces the editor's
 * hardcoded `node.type === '<vent>'` paint arms with registry-driven dispatch,
 * the same way chimney / dormer / wall declare their own `paint` capability.
 */

type SurfaceNode = AnyNode & {
  material?: MaterialSchema
  materialPreset?: string
}

function buildPreviewMaterial(
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Material | null {
  if (materialPreset) return createMaterialFromPresetRef(materialPreset)
  if (material) return createMaterial(material)
  return null
}

export const surfacePaintCapability: PaintCapability = {
  // One paintable surface — every face resolves to it.
  resolveRole: () => 'surface',
  buildPatch: ({ material, materialPreset }) => ({ material, materialPreset }) as Partial<AnyNode>,
  applyPreview: ({ material, materialPreset, root }) => {
    const preview = buildPreviewMaterial(material, materialPreset)
    if (!preview) return null
    // The kinds register a group, so walk the subtree and swap every child
    // mesh's material, recording a restore for each.
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
      for (let i = restores.length - 1; i >= 0; i -= 1) restores[i]?.()
    }
  },
  getEffectiveMaterial: ({ node }) => {
    const n = node as SurfaceNode
    return { material: n.material, materialPreset: n.materialPreset }
  },
}
