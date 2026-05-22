import type {
  DormerNode,
  DormerSurfaceMaterialRole,
  MaterialSchema,
  PaintCapability,
} from '@pascal-app/core'
import { getEffectiveDormerSurfaceMaterial } from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef } from '@pascal-app/viewer'
import type { Material, Mesh } from 'three'

/**
 * Resolve a dormer face click to its logical surface role.
 *
 * The dormer body mesh has 5 material slots (see
 * `csg-geometry.ts:generateDormerGeometry`):
 *   0 = wall (rectangular wall)
 *   1 = side (deck along the slope)
 *   2 = interior — paint as wall
 *   3 = top   (roof shingle)
 *   4 = gable triangle — paint as wall
 *
 * Window-frame meshes are not in the body mesh; they're routed to
 * 'side' separately by the editor when the click lands on them.
 */
export function resolveDormerRole(materialIndex: number | null): DormerSurfaceMaterialRole {
  if (materialIndex === 3) return 'top'
  if (materialIndex === 1) return 'side'
  return 'wall'
}

export function buildDormerMaterialPatch(
  role: DormerSurfaceMaterialRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<DormerNode> {
  if (role === 'top') {
    return { topMaterial: material, topMaterialPreset: materialPreset }
  }
  if (role === 'side') {
    return { sideMaterial: material, sideMaterialPreset: materialPreset }
  }
  return { wallMaterial: material, wallMaterialPreset: materialPreset }
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
 * Apply a preview material to the dormer's `dormer-body` mesh at the
 * slots that map to `role`:
 *   role='wall' → slots [0, 2, 4]
 *   role='side' → slot  [1]
 *   role='top'  → slot  [3]
 */
function applyDormerPreview(
  role: DormerSurfaceMaterialRole,
  previewMaterial: Material,
  root: import('three').Object3D,
): (() => void) | null {
  const slotsToPaint = (() => {
    if (role === 'top') return [3]
    if (role === 'side') return [1]
    return [0, 2, 4]
  })()

  const restores: Array<() => void> = []
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    if (mesh.name !== 'dormer-body') return
    const current = mesh.material as Material | Material[]
    if (!Array.isArray(current)) return
    const previousArray = [...current]
    const nextArray = [...current]
    for (const idx of slotsToPaint) {
      if (current[idx]) nextArray[idx] = previewMaterial
    }
    mesh.material = nextArray
    restores.push(() => {
      mesh.material = previousArray
    })
  })
  if (restores.length === 0) return null
  return () => {
    for (let i = restores.length - 1; i >= 0; i -= 1) restores[i]?.()
  }
}

/**
 * Capability binding for the dormer kind. The editor's
 * selection-manager invokes these in place of the legacy
 * `if (node.type === 'dormer') { ... }` arm.
 */
export const dormerPaint: PaintCapability = {
  resolveRole: ({ materialIndex }) => resolveDormerRole(materialIndex),
  buildPatch: ({ role, material, materialPreset }) =>
    buildDormerMaterialPatch(role as DormerSurfaceMaterialRole, material, materialPreset),
  applyPreview: ({ role, material, materialPreset, root }) => {
    const previewMaterial = buildPreviewMaterial(material, materialPreset)
    if (!previewMaterial) return null
    return applyDormerPreview(role as DormerSurfaceMaterialRole, previewMaterial, root)
  },
  getEffectiveMaterial: ({ node, role }) => {
    const spec = getEffectiveDormerSurfaceMaterial(
      node as DormerNode,
      role as DormerSurfaceMaterialRole,
    )
    return { material: spec.material, materialPreset: spec.materialPreset }
  },
}
