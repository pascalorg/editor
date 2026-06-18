'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  type ChimneyMaterialRole,
  type ChimneyNode,
  type ColumnNode,
  type DormerSurfaceMaterialRole,
  type FenceNode,
  getCatalogMaterialById,
  getEffectiveRoofSurfaceMaterial,
  getEffectiveSegmentSurfaceMaterial,
  getEffectiveStairSurfaceMaterial,
  getLibraryMaterialIdFromRef,
  type MaterialSchema,
  type MaterialTarget,
  nodeRegistry,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSegmentSurfaceMaterialRole,
  type RoofSurfaceMaterialRole,
  type ShelfNode,
  type SlabNode,
  type StairNode,
  type StairSurfaceMaterialRole,
  type WallSurfaceSide,
} from '@pascal-app/core'

export type PaintableMaterialTarget =
  | Extract<
      MaterialTarget,
      | 'wall'
      | 'roof'
      | 'stair'
      | 'fence'
      | 'column'
      | 'slab'
      | 'ceiling'
      | 'shelf'
      | 'chimney'
      | 'dormer'
      | 'box-vent'
      | 'ridge-vent'
      | 'turbine-vent'
      | 'cupola'
      | 'eyebrow-vent'
    >
  | 'item'

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

/**
 * Build a per-segment paint patch for one of the three surface roles. The
 * segment ends up with role-specific fields set (and the legacy catch-all
 * `material` cleared) so subsequent reads pick the role override over any
 * parent-roof fallback.
 */
export function buildRoofSegmentSurfaceMaterialPatch(
  node: RoofSegmentNode,
  targetRole: RoofSegmentSurfaceMaterialRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<RoofSegmentNode> {
  const nextSurfaceMaterial = { material, materialPreset }
  const nextTop =
    targetRole === 'top' ? nextSurfaceMaterial : getEffectiveSegmentSurfaceMaterial(node, 'top')
  const nextEdge =
    targetRole === 'edge' ? nextSurfaceMaterial : getEffectiveSegmentSurfaceMaterial(node, 'edge')
  const nextWall =
    targetRole === 'wall' ? nextSurfaceMaterial : getEffectiveSegmentSurfaceMaterial(node, 'wall')

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

/**
 * Clear every painted material on a node back to its default. Works for any
 * kind without per-type knowledge: it nulls the catch-all `material` /
 * `materialPreset` plus any role field (`*Material` / `*MaterialPreset`) that
 * the node actually carries. For a roof it also resets every child segment, so
 * a single call defaults the whole roof system. `updateNode` merges patches
 * shallowly without re-validation, so the `undefined` values land as cleared
 * fields and the renderer falls back to the theme defaults.
 */
export function buildResetSurfaceMaterialUpdates(
  nodes: Record<string, AnyNode>,
  node: AnyNode,
): { id: AnyNodeId; data: Partial<AnyNode> }[] {
  const clearPatch = (target: AnyNode): Partial<AnyNode> => {
    const patch: Record<string, undefined> = {}
    for (const key of Object.keys(target)) {
      if (
        key === 'material' ||
        key === 'materialPreset' ||
        key === 'slots' ||
        key.endsWith('Material') ||
        key.endsWith('MaterialPreset')
      ) {
        patch[key] = undefined
      }
    }
    return patch as Partial<AnyNode>
  }

  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = [
    { id: node.id as AnyNodeId, data: clearPatch(node) },
  ]

  if (node.type === 'roof') {
    for (const segmentId of (node as RoofNode).children ?? []) {
      const segment = nodes[segmentId as AnyNodeId]
      if (segment?.type === 'roof-segment') {
        updates.push({ id: segment.id as AnyNodeId, data: clearPatch(segment) })
      }
    }
  }

  return updates
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

// Chimney / dormer patch builders moved to
// `@pascal-app/nodes/<kind>/paint.ts` and are wired into the kind's
// `capabilities.paint.buildPatch`. The selection-manager invokes them
// through the registry; no editor-side helper needed here.
//
// `getEffectiveChimneyMaterial` below stays because
// `resolveActivePaintMaterialFromSelection` (also in this file) still
// has wall / roof / stair arms that follow the same shape — they all
// migrate together in a follow-up.

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
      | DormerSurfaceMaterialRole
      | SingleSurfaceMaterialRole
      | string
  } | null
}): ActivePaintMaterial | null {
  const { nodes, selectedId, selectedMaterialTarget } = params
  if (!(selectedId && selectedMaterialTarget) || selectedMaterialTarget.nodeId !== selectedId)
    return null

  const selectedNode = nodes[selectedId]
  if (!selectedNode) return null

  // Registry-driven path. Kinds that declare
  // `capabilities.paint.getEffectiveMaterial` resolve their effective
  // material here without an editor-side per-kind arm. Wall,
  // chimney, dormer use this; roof / stair stay legacy below.
  const paintCap = nodeRegistry.get(selectedNode.type)?.capabilities?.paint
  if (paintCap?.getEffectiveMaterial) {
    const surface = paintCap.getEffectiveMaterial({
      node: selectedNode,
      role: selectedMaterialTarget.role as string,
      nodes,
    })
    if (surface) {
      const sourceTarget = selectedNode.type as PaintableMaterialTarget
      return hasActivePaintMaterial({
        material: surface.material,
        materialPreset: surface.materialPreset,
        sourceTarget,
      })
        ? {
            material: surface.material,
            materialPreset: surface.materialPreset,
            sourceTarget,
          }
        : null
    }
  }

  if (
    selectedNode.type === 'roof' &&
    (selectedMaterialTarget.role === 'top' ||
      selectedMaterialTarget.role === 'edge' ||
      selectedMaterialTarget.role === 'wall')
  ) {
    let surface = getEffectiveRoofSurfaceMaterial(selectedNode, selectedMaterialTarget.role)
    if (
      selectedMaterialTarget.role === 'top' &&
      surface.material === undefined &&
      surface.materialPreset === undefined
    ) {
      const roofNode = selectedNode as RoofNode
      const fallbackSegment = (roofNode.children ?? [])
        .map((id: AnyNodeId) => nodes[id as AnyNodeId] as RoofSegmentNode | undefined)
        .find(
          (segment: RoofSegmentNode | undefined) =>
            segment?.type === 'roof-segment' &&
            (segment.material !== undefined || segment.materialPreset !== undefined),
        )
      if (fallbackSegment) {
        surface = {
          material: fallbackSegment.material,
          materialPreset: fallbackSegment.materialPreset,
        }
      }
    }
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

  // Wall / chimney / dormer flow through the registry-driven path
  // at the top of this function.

  if (
    (selectedNode.type === 'fence' ||
      selectedNode.type === 'column' ||
      selectedNode.type === 'shelf') &&
    selectedMaterialTarget.role === 'surface'
  ) {
    // Roof vents previously lived here too; they now resolve via the
    // registry-driven `getEffectiveMaterial` path at the top of this function.
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

  if (selectedNode.type === 'item') {
    return 'item'
  }

  if (selectedNode.type === 'chimney') {
    return 'chimney'
  }

  if (selectedNode.type === 'dormer') {
    return 'dormer'
  }

  if (selectedNode.type === 'box-vent') {
    return 'box-vent'
  }

  if (selectedNode.type === 'ridge-vent') {
    return 'ridge-vent'
  }

  if (selectedNode.type === 'turbine-vent') {
    return 'turbine-vent'
  }

  if (selectedNode.type === 'cupola') {
    return 'cupola'
  }

  if (selectedNode.type === 'eyebrow-vent') {
    return 'eyebrow-vent'
  }

  return null
}
