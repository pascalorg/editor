'use client'

import {
  getCatalogMaterialById,
  getEffectiveRoofSurfaceMaterial,
  getEffectiveStairSurfaceMaterial,
  getEffectiveWallSurfaceMaterial,
  getLibraryMaterialIdFromRef,
  type MaterialSchema,
  type MaterialTarget,
  type RoofNode,
  type RoofSurfaceMaterialRole,
  type StairNode,
  type StairSurfaceMaterialRole,
  type WallNode,
  type WallSurfaceSide,
} from '@pascal-app/core'

export type PaintableMaterialTarget = Extract<MaterialTarget, 'wall' | 'roof' | 'stair'>

export type ActivePaintMaterial = {
  material?: MaterialSchema
  materialPreset?: string
  sourceTarget: PaintableMaterialTarget
}

export function hasActivePaintMaterial(
  material: ActivePaintMaterial | null | undefined,
): material is ActivePaintMaterial {
  return Boolean(
    material && (material.material !== undefined || material.materialPreset !== undefined),
  )
}

function getCatalogEntryForActivePaintMaterial(material: ActivePaintMaterial | null | undefined) {
  const catalogId =
    getLibraryMaterialIdFromRef(material?.materialPreset) ?? material?.material?.id ?? undefined

  return getCatalogMaterialById(catalogId)
}

export function getActivePaintMaterialLabel(material: ActivePaintMaterial | null | undefined) {
  return getCatalogEntryForActivePaintMaterial(material)?.label ?? 'Custom'
}

export function isActivePaintMaterialCompatible(
  material: ActivePaintMaterial | null | undefined,
  target: PaintableMaterialTarget,
) {
  if (!hasActivePaintMaterial(material)) return false

  const catalogEntry = getCatalogEntryForActivePaintMaterial(material)
  if (!catalogEntry) return true

  return catalogEntry.targets.includes(target)
}

export function buildWallSurfaceMaterialPatch(
  node: WallNode,
  targetSide: WallSurfaceSide,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<WallNode> {
  const nextSurfaceMaterial = { material, materialPreset }
  const nextInterior =
    targetSide === 'interior'
      ? nextSurfaceMaterial
      : getEffectiveWallSurfaceMaterial(node, 'interior')
  const nextExterior =
    targetSide === 'exterior'
      ? nextSurfaceMaterial
      : getEffectiveWallSurfaceMaterial(node, 'exterior')

  return {
    interiorMaterial: nextInterior.material,
    interiorMaterialPreset: nextInterior.materialPreset,
    exteriorMaterial: nextExterior.material,
    exteriorMaterialPreset: nextExterior.materialPreset,
    material: undefined,
    materialPreset: undefined,
  }
}

export function buildRoofSurfaceMaterialPatch(
  node: RoofNode,
  targetRole: RoofSurfaceMaterialRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<RoofNode> {
  const nextSurfaceMaterial = { material, materialPreset }
  const nextTop =
    targetRole === 'top' ? nextSurfaceMaterial : getEffectiveRoofSurfaceMaterial(node, 'top')
  const nextEdge =
    targetRole === 'edge' ? nextSurfaceMaterial : getEffectiveRoofSurfaceMaterial(node, 'edge')
  const nextWall =
    targetRole === 'wall' ? nextSurfaceMaterial : getEffectiveRoofSurfaceMaterial(node, 'wall')

  return {
    topMaterial: nextTop.material,
    topMaterialPreset: nextTop.materialPreset,
    edgeMaterial: nextEdge.material,
    edgeMaterialPreset: nextEdge.materialPreset,
    wallMaterial: nextWall.material,
    wallMaterialPreset: nextWall.materialPreset,
    material: undefined,
    materialPreset: undefined,
  }
}

export function buildStairSurfaceMaterialPatch(
  node: StairNode,
  targetRole: StairSurfaceMaterialRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<StairNode> {
  const nextSurfaceMaterial = { material, materialPreset }
  const nextRailing =
    targetRole === 'railing'
      ? nextSurfaceMaterial
      : getEffectiveStairSurfaceMaterial(node, 'railing')
  const nextTread =
    targetRole === 'tread' ? nextSurfaceMaterial : getEffectiveStairSurfaceMaterial(node, 'tread')
  const nextSide =
    targetRole === 'side' ? nextSurfaceMaterial : getEffectiveStairSurfaceMaterial(node, 'side')

  return {
    railingMaterial: nextRailing.material,
    railingMaterialPreset: nextRailing.materialPreset,
    treadMaterial: nextTread.material,
    treadMaterialPreset: nextTread.materialPreset,
    sideMaterial: nextSide.material,
    sideMaterialPreset: nextSide.materialPreset,
    material: undefined,
    materialPreset: undefined,
  }
}

export function resolveActivePaintMaterialFromSelection(params: {
  nodes: Record<string, any>
  selectedId: string | null
  selectedMaterialTarget: {
    nodeId: string
    role: WallSurfaceSide | StairSurfaceMaterialRole | RoofSurfaceMaterialRole
  } | null
}): ActivePaintMaterial | null {
  const { nodes, selectedId, selectedMaterialTarget } = params
  if (!selectedId || !selectedMaterialTarget || selectedMaterialTarget.nodeId !== selectedId)
    return null

  const selectedNode = nodes[selectedId]
  if (!selectedNode) return null

  if (
    selectedNode.type === 'wall' &&
    (selectedMaterialTarget.role === 'interior' || selectedMaterialTarget.role === 'exterior')
  ) {
    const surface = getEffectiveWallSurfaceMaterial(selectedNode, selectedMaterialTarget.role)
    return hasActivePaintMaterial({
      material: surface.material,
      materialPreset: surface.materialPreset,
      sourceTarget: 'wall',
    })
      ? {
          material: surface.material,
          materialPreset: surface.materialPreset,
          sourceTarget: 'wall',
        }
      : null
  }

  if (
    selectedNode.type === 'roof' &&
    (selectedMaterialTarget.role === 'top' ||
      selectedMaterialTarget.role === 'edge' ||
      selectedMaterialTarget.role === 'wall')
  ) {
    const surface = getEffectiveRoofSurfaceMaterial(selectedNode, selectedMaterialTarget.role)
    return hasActivePaintMaterial({
      material: surface.material,
      materialPreset: surface.materialPreset,
      sourceTarget: 'roof',
    })
      ? {
          material: surface.material,
          materialPreset: surface.materialPreset,
          sourceTarget: 'roof',
        }
      : null
  }

  if (
    selectedNode.type === 'stair' &&
    (selectedMaterialTarget.role === 'railing' ||
      selectedMaterialTarget.role === 'tread' ||
      selectedMaterialTarget.role === 'side')
  ) {
    const surface = getEffectiveStairSurfaceMaterial(selectedNode, selectedMaterialTarget.role)
    return hasActivePaintMaterial({
      material: surface.material,
      materialPreset: surface.materialPreset,
      sourceTarget: 'stair',
    })
      ? {
          material: surface.material,
          materialPreset: surface.materialPreset,
          sourceTarget: 'stair',
        }
      : null
  }

  return null
}

export function resolvePaintTargetFromSelection(params: {
  nodes: Record<string, any>
  selectedId: string | null
}): PaintableMaterialTarget | null {
  const { nodes, selectedId } = params
  if (!selectedId) return null

  const selectedNode = nodes[selectedId]
  if (!selectedNode) return null

  if (selectedNode.type === 'wall') {
    return 'wall'
  }

  if (selectedNode.type === 'roof' || selectedNode.type === 'roof-segment') {
    return 'roof'
  }

  if (selectedNode.type === 'stair' || selectedNode.type === 'stair-segment') {
    return 'stair'
  }

  return null
}
