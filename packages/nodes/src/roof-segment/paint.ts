import {
  type AnyNodeId,
  getEffectiveRoofSurfaceMaterial,
  getEffectiveSegmentSurfaceMaterial,
  getRoofGlazing,
  getRoofWallBandMaterial,
  isGlazedRoofSegment,
  type PaintCapability,
  type RoofSegmentNode,
  type RoofWallBand,
  roofWallBandFields,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { buildRoofSegmentSurfaceMaterialPatch } from '@pascal-app/editor'
import type { Mesh } from 'three'
import { GLAZED_ROOF_SLOTS } from '../roof/glazed-materials'
import { buildSlotPreviewMaterial, createSlotPaintCapability } from '../shared/slot-paint'
import { swapPreviewMaterial } from '../shared/swap-preview-material'

function glazingLook(node: RoofSegmentNode, role: string) {
  const config = getRoofGlazing(node)
  const glass = role === 'glazing-glass'
  return {
    materialPreset: undefined,
    material: {
      preset: 'custom' as const,
      properties: {
        color: glass ? config.glassColor : config.frameColor,
        transparent: glass,
        opacity: glass ? config.glassOpacity : 1,
        roughness: glass ? config.glassRoughness : 0.4,
        metalness: role === 'glazing-frame' ? 0.65 : 0,
        side: 'front' as const,
      },
    },
  }
}

const glazingPaint = createSlotPaintCapability({
  materialTarget: 'roof',
  erasedLook: ({ node, role }) => glazingLook(node as RoofSegmentNode, role),
  legacyEffective: (node, role) => glazingLook(node as RoofSegmentNode, role),
  resolveRole: ({ materialIndex }) => GLAZED_ROOF_SLOTS[materialIndex ?? -1] ?? null,
  applyPreview(args) {
    const mesh = sceneRegistry.nodes.get(args.node.id) as Mesh | undefined
    if (!mesh?.isMesh || !Array.isArray(mesh.material)) return null
    const slot = (GLAZED_ROOF_SLOTS as readonly string[]).indexOf(args.role)
    if (slot < 0) return null
    const material = buildSlotPreviewMaterial(args.material, args.materialPreset)
    if (!material) return null
    const next = [...mesh.material]
    next[slot] = material
    return swapPreviewMaterial(mesh, next)
  },
})

// Slots 4–6 are the wall bands split off the wall/trim slot (the viewer's `ROOF_HEEL_MATERIAL_INDEX`…).
const WALL_BAND_BY_INDEX: Record<number, RoofWallBand> = {
  4: 'heel',
  5: 'gable-left',
  6: 'gable-right',
}
const WALL_BAND_LABELS: Record<RoofWallBand, string> = {
  heel: 'Heel band',
  'gable-left': 'Left gable',
  'gable-right': 'Right gable',
}

function standardRole(index: number | null) {
  if (index !== null && WALL_BAND_BY_INDEX[index]) return WALL_BAND_BY_INDEX[index]
  return index === 3 ? 'top' : index === 0 ? 'edge' : index === 1 || index === 2 ? 'wall' : null
}

function isWallBand(role: string): role is RoofWallBand {
  return role === 'heel' || role === 'gable-left' || role === 'gable-right'
}

/** A heel or gable paints on its own: its own finish, cleared back to its fallback by the eraser. */
export function wallBandPatch(
  band: RoofWallBand,
  material: RoofSegmentNode['material'],
  materialPreset: string | undefined,
): Partial<RoofSegmentNode> {
  const fields = roofWallBandFields(band)
  return { [fields.material]: material, [fields.materialPreset]: materialPreset }
}

export const roofSegmentPaint: PaintCapability = {
  materialTarget: 'roof',
  resolveRole(args) {
    return isGlazedRoofSegment(args.node as RoofSegmentNode)
      ? glazingPaint.resolveRole(args)
      : standardRole(args.materialIndex)
  },
  roleLabel(node, role) {
    return isWallBand(role) && !isGlazedRoofSegment(node as RoofSegmentNode)
      ? WALL_BAND_LABELS[role]
      : null
  },
  buildPatch(args) {
    if (isGlazedRoofSegment(args.node as RoofSegmentNode)) return glazingPaint.buildPatch(args)
    const role = args.role
    if (isWallBand(role)) return wallBandPatch(role, args.material, args.materialPreset)
    if (role !== 'top' && role !== 'edge' && role !== 'wall') return {}
    return buildRoofSegmentSurfaceMaterialPatch(
      args.node as RoofSegmentNode,
      role,
      args.material,
      args.materialPreset,
    )
  },
  commit(args) {
    if (isGlazedRoofSegment(args.node as RoofSegmentNode)) glazingPaint.commit?.(args)
    else useScene.getState().updateNode(args.node.id, roofSegmentPaint.buildPatch(args))
  },
  applyPreview(args) {
    if (isGlazedRoofSegment(args.node as RoofSegmentNode)) return glazingPaint.applyPreview(args)
    const mesh = sceneRegistry.nodes.get(args.node.id) as Mesh | undefined
    if (!mesh?.isMesh || !Array.isArray(mesh.material)) return null
    const material = buildSlotPreviewMaterial(args.material, args.materialPreset)
    if (!material) return null
    const next = mesh.material.map((existing, index) =>
      standardRole(index) === args.role ? material : existing,
    )
    return swapPreviewMaterial(mesh, next)
  },
  getEffectiveMaterial(args) {
    const node = args.node as RoofSegmentNode
    if (isGlazedRoofSegment(node)) return glazingPaint.getEffectiveMaterial?.(args) ?? null
    const role = args.role
    const parent = node.parentId ? args.nodes?.[node.parentId as AnyNodeId] : undefined
    if (isWallBand(role)) {
      // Unpainted, a gable shows the edge role and the heel band the roof's (else the walls').
      const own =
        getRoofWallBandMaterial(node, role) ??
        (role === 'heel' && parent?.type === 'roof'
          ? getRoofWallBandMaterial(parent, 'heel')
          : null)
      if (own) return { material: own.material, materialPreset: own.materialPreset }
      if (role === 'heel') return null
      const edge = getEffectiveSegmentSurfaceMaterial(
        node,
        'edge',
        parent?.type === 'roof' ? getEffectiveRoofSurfaceMaterial(parent, 'edge') : undefined,
      )
      return { material: edge.material, materialPreset: edge.materialPreset }
    }
    if (role !== 'top' && role !== 'edge' && role !== 'wall') return null
    const spec = getEffectiveSegmentSurfaceMaterial(
      node,
      role,
      parent?.type === 'roof' ? getEffectiveRoofSurfaceMaterial(parent, role) : undefined,
    )
    return { material: spec.material, materialPreset: spec.materialPreset }
  },
}

export { roofSegmentSlots } from '@pascal-app/core'
