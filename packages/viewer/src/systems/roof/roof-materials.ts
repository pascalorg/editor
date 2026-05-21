import {
  getEffectiveRoofSurfaceMaterial,
  type RoofNode,
  type RoofSegmentNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { createMaterial, createMaterialFromPresetRef } from '../../lib/materials'

export type RoofMaterialArray = [THREE.Material, THREE.Material, THREE.Material, THREE.Material]

const roofMaterialArrayCache = new Map<string, RoofMaterialArray>()

function getSurfaceMaterialSignature(
  spec: ReturnType<typeof getEffectiveRoofSurfaceMaterial>,
): string {
  return JSON.stringify({
    material: spec.material ?? null,
    materialPreset: spec.materialPreset ?? null,
  })
}

function getSegmentMaterialSignature(segment: RoofSegmentNode | undefined): string {
  return JSON.stringify({
    material: segment?.material ?? null,
    materialPreset: segment?.materialPreset ?? null,
  })
}

function createResolvedMaterial(
  material: RoofNode['material'] | RoofSegmentNode['material'] | undefined,
  materialPreset: string | undefined,
): THREE.Material | null {
  if (materialPreset) {
    return createMaterialFromPresetRef(materialPreset)
  }

  if (material) {
    return createMaterial(material)
  }

  return null
}

export function getRoofMaterialArray(
  node: RoofNode,
  segments?: RoofSegmentNode[] | null,
): RoofMaterialArray | null {
  const top = getEffectiveRoofSurfaceMaterial(node, 'top')
  const edge = getEffectiveRoofSurfaceMaterial(node, 'edge')
  const wall = getEffectiveRoofSurfaceMaterial(node, 'wall')

  // Back-compat / persistence: roof materials were historically stored on the
  // roof-segment (legacy `material/materialPreset`). The merged-roof mesh is
  // owned by the roof container, so if the roof node has no explicit surface
  // material configured, fall back to the first segment that has one.
  const hasAnyRoofSurfaceMaterial =
    top.material !== undefined ||
    typeof top.materialPreset === 'string' ||
    edge.material !== undefined ||
    typeof edge.materialPreset === 'string' ||
    wall.material !== undefined ||
    typeof wall.materialPreset === 'string'
  const fallbackSegment = hasAnyRoofSurfaceMaterial
    ? undefined
    : (segments ?? []).find((s) => s.material !== undefined || typeof s.materialPreset === 'string')

  const cacheKey = JSON.stringify({
    top: getSurfaceMaterialSignature(top),
    edge: getSurfaceMaterialSignature(edge),
    wall: getSurfaceMaterialSignature(wall),
    fallbackSegment: getSegmentMaterialSignature(fallbackSegment),
  })

  const cached = roofMaterialArrayCache.get(cacheKey)
  if (cached) return cached

  const topMaterial = createResolvedMaterial(
    top.material ?? fallbackSegment?.material,
    top.materialPreset ?? fallbackSegment?.materialPreset,
  )
  const edgeMaterial = createResolvedMaterial(
    edge.material ?? fallbackSegment?.material,
    edge.materialPreset ?? fallbackSegment?.materialPreset,
  )
  const wallMaterial = createResolvedMaterial(
    wall.material ?? fallbackSegment?.material,
    wall.materialPreset ?? fallbackSegment?.materialPreset,
  )

  if (!(topMaterial || edgeMaterial || wallMaterial)) {
    return null
  }

  const materialArray: RoofMaterialArray = [
    edgeMaterial ?? wallMaterial ?? topMaterial ?? new THREE.MeshStandardMaterial(),
    wallMaterial ?? edgeMaterial ?? topMaterial ?? new THREE.MeshStandardMaterial(),
    wallMaterial ?? edgeMaterial ?? topMaterial ?? new THREE.MeshStandardMaterial(),
    topMaterial ?? wallMaterial ?? edgeMaterial ?? new THREE.MeshStandardMaterial(),
  ]

  roofMaterialArrayCache.set(cacheKey, materialArray)
  return materialArray
}
