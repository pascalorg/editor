import type {
  ChimneyMaterialRole,
  ChimneyNode,
  MaterialSchema,
  PaintCapability,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef } from '@pascal-app/viewer'
import type { Material, Mesh } from 'three'

/**
 * Resolve a chimney face click to its logical surface role.
 *
 * `holes.ts:partitionTopFaceGroups` partitions the chimney body
 * mesh's material slots so:
 *   0 = body
 *   1 = top (the cap face)
 * Faces outside any group (cricket mesh, which renders with a single
 * material) fall back to 'body'.
 */
export function resolveChimneyRole(materialIndex: number | null): ChimneyMaterialRole {
  return materialIndex === 1 ? 'top' : 'body'
}

export function buildChimneyMaterialPatch(
  role: ChimneyMaterialRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<ChimneyNode> {
  if (role === 'top') {
    return { topMaterial: material, topMaterialPreset: materialPreset }
  }
  return { material, materialPreset }
}

export function getEffectiveChimneyMaterial(
  node: ChimneyNode,
  role: ChimneyMaterialRole,
): { material: MaterialSchema | undefined; materialPreset: string | undefined } {
  if (role === 'top') {
    const hasTop = node.topMaterial !== undefined || node.topMaterialPreset !== undefined
    if (hasTop) {
      return { material: node.topMaterial, materialPreset: node.topMaterialPreset }
    }
  }
  return { material: node.material, materialPreset: node.materialPreset }
}

function buildPreviewMaterial(
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Material | null {
  if (materialPreset) {
    return createMaterialFromPresetRef(materialPreset)
  }
  if (material) {
    return createMaterial(material)
  }
  return null
}

/**
 * Apply a preview material to the chimney's mesh subtree for the
 * given role. The body mesh uses a 2-slot material array (body =
 * slot 0, top = slot 1) so paint-target → slot index is a single
 * lookup. The cricket mesh uses a single material, which only the
 * 'body' role paints.
 */
function applyChimneyPreview(
  role: ChimneyMaterialRole,
  previewMaterial: Material,
  root: import('three').Object3D,
): (() => void) | null {
  const restores: Array<() => void> = []
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const current = mesh.material as Material | Material[]
    if (Array.isArray(current)) {
      const idx = role === 'top' ? 1 : 0
      const previousAtIdx = current[idx]
      if (!previousAtIdx) return
      const previousArray = [...current]
      const nextArray = [...current]
      nextArray[idx] = previewMaterial
      mesh.material = nextArray
      restores.push(() => {
        mesh.material = previousArray
      })
    } else if (role === 'body') {
      const previous = mesh.material
      mesh.material = previewMaterial
      restores.push(() => {
        mesh.material = previous
      })
    }
  })
  if (restores.length === 0) return null
  return () => {
    for (let i = restores.length - 1; i >= 0; i -= 1) restores[i]?.()
  }
}

/**
 * Capability binding for the chimney kind. The editor's
 * selection-manager invokes these in place of the legacy
 * `if (node.type === 'chimney') { ... }` arm.
 */
export const chimneyPaint: PaintCapability = {
  resolveRole: ({ materialIndex }) => resolveChimneyRole(materialIndex),
  buildPatch: ({ role, material, materialPreset }) =>
    buildChimneyMaterialPatch(role as ChimneyMaterialRole, material, materialPreset),
  applyPreview: ({ role, material, materialPreset, root }) => {
    const previewMaterial = buildPreviewMaterial(material, materialPreset)
    if (!previewMaterial) return null
    return applyChimneyPreview(role as ChimneyMaterialRole, previewMaterial, root)
  },
  getEffectiveMaterial: ({ node, role }) =>
    getEffectiveChimneyMaterial(node as ChimneyNode, role as ChimneyMaterialRole),
}
