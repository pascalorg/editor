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

export function getRoofMaterialArray(node: RoofNode): RoofMaterialArray | null {
  const top = getEffectiveRoofSurfaceMaterial(node, 'top')
  const edge = getEffectiveRoofSurfaceMaterial(node, 'edge')
  const wall = getEffectiveRoofSurfaceMaterial(node, 'wall')
  const cacheKey = JSON.stringify({
    top: getSurfaceMaterialSignature(top),
    edge: getSurfaceMaterialSignature(edge),
    wall: getSurfaceMaterialSignature(wall),
  })

  const cached = roofMaterialArrayCache.get(cacheKey)
  if (cached) return cached

  const topMaterial = createResolvedMaterial(top.material, top.materialPreset)
  const edgeMaterial = createResolvedMaterial(edge.material, edge.materialPreset)
  const wallMaterial = createResolvedMaterial(wall.material, wall.materialPreset)

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
