import {
  type AnyNode,
  type AnyNodeId,
  CEILING_SLOT_DEFAULT_COLOR,
  CEILING_SURFACE_ROLE,
  type CeilingNode,
  ceilingPaintRegions,
  ceilingRegionsOwner,
  type MaterialSchema,
  type PaintCapability,
  type PaintPatchArgs,
  type PaintPreviewArgs,
  parseCeilingRegionRole,
  parseMaterialRef,
  type SceneMaterialId,
  useScene,
} from '@pascal-app/core'
import { CEILING_REGION_MESH, useViewer } from '@pascal-app/viewer'
import type { Material, Mesh, Object3D } from 'three'
import { createSlotPaintCapability, resolveSlotPaintMaterialRef } from '../shared/slot-paint'
import { swapPreviewMaterial } from '../shared/swap-preview-material'
import { getCeilingMaterials, resolveCeilingFinish } from './materials'

/**
 * Ceiling paint on the unified slot model. A ceiling's own finish is its
 * `surface` slot (`node.slots.surface`); a painted part of it is a region —
 * the room's (`zone.ceiling.regions`) for an automatic ceiling, the ceiling's
 * own (`ceiling.regions`) for a manual one — drawn as its own mesh tagged
 * `region:<id>`. A click lands on what shows there. Previews swap the ceiling's
 * room-facing material on exactly the
 * mesh the click would change, so the hover matches the committed result.
 */

function regionMesh(root: Object3D, role: string): Mesh | null {
  let found: Mesh | null = null
  root.traverse((object) => {
    if (!found && object.name === CEILING_REGION_MESH && object.userData.paintRole === role)
      found = object as Mesh
  })
  return found
}

function applyCeilingPreview({ role, material, materialPreset, root }: PaintPreviewArgs) {
  const mesh = root as Mesh
  if (!mesh.isMesh) return null
  const shading = useViewer.getState().shading
  const finish = resolveCeilingFinish(
    materialPreset ?? material,
    useScene.getState().materials,
    shading,
  )
  const erasing = material === undefined && materialPreset === undefined
  if (role === CEILING_SURFACE_ROLE) {
    // Erasing shows the default the ceiling returns to.
    const shown =
      finish ??
      (erasing ? getCeilingMaterials(CEILING_SLOT_DEFAULT_COLOR, shading).bottomMaterial : null)
    if (!shown) return () => {}
    return swapPreviewMaterial(mesh, shown)
  }
  const region = regionMesh(mesh, role)
  if (!region) return null
  // An erased region shows the ceiling's own finish under it.
  const preview: Material | null = finish ? finish : erasing ? (mesh.material as Material) : null
  return preview ? swapPreviewMaterial(region, preview) : () => {}
}

/** Repaint a region, or remove it for the eraser, in one history step. */
function commitCeilingRegion(
  ceiling: CeilingNode,
  regionId: string,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
) {
  const state = useScene.getState()
  const resolution = resolveSlotPaintMaterialRef(state.materials, material, materialPreset)
  if (!resolution) return
  const { ref, newSceneMaterial } = resolution
  const owner = ceilingRegionsOwner(ceiling)
  useScene.setState((current) => {
    if (current.readOnly) return current
    const node = current.nodes[owner.id as AnyNodeId]
    const regions =
      node?.type === 'zone'
        ? (node.ceiling?.regions ?? [])
        : node?.type === 'ceiling'
          ? (node.regions ?? [])
          : null
    if (!(node && regions?.some((region) => region.id === regionId))) return current
    const next = ref
      ? regions.map((region) => (region.id === regionId ? { ...region, finish: ref } : region))
      : regions.filter((region) => region.id !== regionId)
    const updated = (
      node.type === 'zone'
        ? { ...node, ceiling: { ...node.ceiling, regions: next.length ? next : undefined } }
        : { ...node, regions: next.length ? next : undefined }
    ) as AnyNode
    return {
      ...(newSceneMaterial
        ? { materials: { ...current.materials, [newSceneMaterial.id]: newSceneMaterial } }
        : {}),
      nodes: { ...current.nodes, [owner.id]: updated },
    }
  })
  useScene.getState().markDirty(ceiling.id as AnyNodeId)
}

function regionFinish(ceiling: CeilingNode, regionId: string) {
  return ceilingPaintRegions(ceiling, useScene.getState().nodes).find(
    (region) => region.id === regionId,
  )?.finish
}

const base = createSlotPaintCapability({
  resolveRole: ({ hitObject }) => {
    const role = hitObject?.userData?.paintRole
    return typeof role === 'string' && parseCeilingRegionRole(role) ? role : CEILING_SURFACE_ROLE
  },
  applyPreview: applyCeilingPreview,
  legacyEffective: (node: AnyNode) => {
    const ceiling = node as CeilingNode
    if (ceiling.materialPreset || ceiling.material) {
      return { material: ceiling.material, materialPreset: ceiling.materialPreset }
    }
    return null
  },
})

export const ceilingPaint: PaintCapability = {
  ...base,
  roleLabel: (_node, role) => (parseCeilingRegionRole(role) ? 'Painted part' : null),
  buildPatch: (args: PaintPatchArgs) =>
    parseCeilingRegionRole(args.role) ? {} : base.buildPatch(args),
  commit: (args: PaintPatchArgs) => {
    const regionId = parseCeilingRegionRole(args.role)
    if (!regionId) return base.commit?.(args)
    commitCeilingRegion(args.node as CeilingNode, regionId, args.material, args.materialPreset)
  },
  getEffectiveMaterial: (args) => {
    const regionId = parseCeilingRegionRole(args.role)
    if (!regionId) return base.getEffectiveMaterial?.(args) ?? null
    const finish = regionFinish(args.node as CeilingNode, regionId)
    if (finish === undefined) return null
    if (typeof finish !== 'string')
      return { material: finish as MaterialSchema, materialPreset: undefined }
    const parsed = parseMaterialRef(finish)
    if (parsed?.kind === 'library') return { material: undefined, materialPreset: finish }
    if (parsed?.kind === 'scene') {
      const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
      if (sceneMaterial) return { material: sceneMaterial.material, materialPreset: undefined }
    }
    return null
  },
}
