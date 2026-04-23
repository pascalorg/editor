'use client'

import {
  type CeilingNode,
  type FenceNode,
  getCatalogMaterialById,
  getEffectiveRoofSurfaceMaterial,
  getEffectiveStairSurfaceMaterial,
  getEffectiveWallSurfaceMaterial,
  getLibraryMaterialIdFromRef,
  getMaterialCategoryTargets,
  type MaterialCategory,
  type MaterialSchema,
  type MaterialTarget,
  type RoofNode,
  type RoofSurfaceMaterialRole,
  type SlabNode,
  type StairNode,
  type StairSurfaceMaterialRole,
  type WallNode,
  type WallSurfaceSide,
} from '@pascal-app/core'

export type PaintableMaterialTarget = Extract<
  MaterialTarget,
  'wall' | 'roof' | 'stair' | 'fence' | 'slab' | 'ceiling'
>

export type SingleSurfaceMaterialRole = 'surface'

export type ActivePaintMaterial = {
  material?: MaterialSchema
  materialPreset?: string
  category?: MaterialCategory
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

function resolvePaintMaterialCategory(
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): MaterialCategory | undefined {
  const catalogId = getLibraryMaterialIdFromRef(materialPreset) ?? material?.id ?? undefined
  const catalogEntry = getCatalogMaterialById(catalogId)
  if (catalogEntry?.category) return catalogEntry.category
  if (material || materialPreset === undefined) return 'other'
  return undefined
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
  const category = material?.category ?? catalogEntry?.category
  if (!category) return false

  return getMaterialCategoryTargets(category).includes(target)
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

export function buildSingleSurfaceMaterialPatch<TNode extends FenceNode | SlabNode | CeilingNode>(
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<TNode> {
  return {
    material,
    materialPreset,
  } as Partial<TNode>
}

export function resolveActivePaintMaterialFromSelection(params: {
  nodes: Record<string, any>
  selectedId: string | null
  selectedMaterialTarget: {
    nodeId: string
    role:
      | WallSurfaceSide
      | StairSurfaceMaterialRole
      | RoofSurfaceMaterialRole
      | SingleSurfaceMaterialRole
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
          category: resolvePaintMaterialCategory(surface.material, surface.materialPreset),
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
          category: resolvePaintMaterialCategory(surface.material, surface.materialPreset),
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
          category: resolvePaintMaterialCategory(surface.material, surface.materialPreset),
          sourceTarget: 'stair',
        }
      : null
  }

  if (
    (selectedNode.type === 'fence' ||
      selectedNode.type === 'slab' ||
      selectedNode.type === 'ceiling') &&
    selectedMaterialTarget.role === 'surface'
  ) {
    const target = selectedNode.type
    return hasActivePaintMaterial({
      material: selectedNode.material,
      materialPreset: selectedNode.materialPreset,
      sourceTarget: target,
    })
      ? {
          material: selectedNode.material,
          materialPreset: selectedNode.materialPreset,
          category: resolvePaintMaterialCategory(
            selectedNode.material,
            selectedNode.materialPreset,
          ),
          sourceTarget: target,
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

  if (selectedNode.type === 'fence') {
    return 'fence'
  }

  if (selectedNode.type === 'slab') {
    return 'slab'
  }

  if (selectedNode.type === 'ceiling') {
    return 'ceiling'
  }

  return null
}
