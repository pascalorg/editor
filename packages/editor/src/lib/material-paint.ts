'use client'

import {
  type CeilingNode,
  type ChimneyMaterialRole,
  type ChimneyNode,
  type ColumnNode,
  type FenceNode,
  getCatalogMaterialById,
  getEffectiveRoofSurfaceMaterial,
  getEffectiveStairSurfaceMaterial,
  getEffectiveWallSurfaceMaterial,
  getLibraryMaterialIdFromRef,
  type MaterialSchema,
  type MaterialTarget,
  type RoofNode,
  type RoofSurfaceMaterialRole,
  type ShelfNode,
  type SlabNode,
  type StairNode,
  type StairSurfaceMaterialRole,
  type WallNode,
  type WallSurfaceSide,
} from '@pascal-app/core'

export type PaintableMaterialTarget = Extract<
  MaterialTarget,
  'wall' | 'roof' | 'stair' | 'fence' | 'column' | 'slab' | 'ceiling' | 'shelf' | 'chimney'
>

export type SingleSurfaceMaterialRole = 'surface'

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

export function buildSingleSurfaceMaterialPatch<
  TNode extends FenceNode | ColumnNode | SlabNode | CeilingNode | ShelfNode,
>(material: MaterialSchema | undefined, materialPreset: string | undefined): Partial<TNode> {
  return {
    material,
    materialPreset,
  } as Partial<TNode>
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

export function resolveActivePaintMaterialFromSelection(params: {
  nodes: Record<string, any>
  selectedId: string | null
  selectedMaterialTarget: {
    nodeId: string
    role:
      | WallSurfaceSide
      | StairSurfaceMaterialRole
      | RoofSurfaceMaterialRole
      | ChimneyMaterialRole
      | SingleSurfaceMaterialRole
  } | null
}): ActivePaintMaterial | null {
  const { nodes, selectedId, selectedMaterialTarget } = params
  if (!(selectedId && selectedMaterialTarget) || selectedMaterialTarget.nodeId !== selectedId)
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

  if (
    selectedNode.type === 'chimney' &&
    (selectedMaterialTarget.role === 'body' || selectedMaterialTarget.role === 'top')
  ) {
    const surface = getEffectiveChimneyMaterial(
      selectedNode,
      selectedMaterialTarget.role as ChimneyMaterialRole,
    )
    return hasActivePaintMaterial({
      material: surface.material,
      materialPreset: surface.materialPreset,
      sourceTarget: 'chimney',
    })
      ? {
          material: surface.material,
          materialPreset: surface.materialPreset,
          sourceTarget: 'chimney',
        }
      : null
  }

  if (
    (selectedNode.type === 'fence' ||
      selectedNode.type === 'column' ||
      selectedNode.type === 'slab' ||
      selectedNode.type === 'ceiling' ||
      selectedNode.type === 'shelf') &&
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

  if (selectedNode.type === 'column') {
    return 'column'
  }

  if (selectedNode.type === 'slab') {
    return 'slab'
  }

  if (selectedNode.type === 'ceiling') {
    return 'ceiling'
  }

  if (selectedNode.type === 'shelf') {
    return 'shelf'
  }

  if (selectedNode.type === 'chimney') {
    return 'chimney'
  }

  return null
}
