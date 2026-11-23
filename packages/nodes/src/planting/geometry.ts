import type { GeometryContext, PlantingNode } from '@pascal-app/core'
import { DoubleSide, Group, Mesh } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { hedgeBufferGeometry } from '../hedge/geometry'
import { hedgeMaterial } from '../hedge/material'
import { plantingContext } from './context'
import { buildPlanting } from './planting-mesh'

let plain: MeshStandardNodeMaterial | undefined

/** Merged core meshes in Site metres, using the foliage writer's existing GPU adapter. */
export function buildPlantingGeometry(
  node: PlantingNode,
  ctx?: Partial<GeometryContext>,
  _shading?: unknown,
  textures = true,
): Group {
  const group = new Group()
  group.name = 'planting-geometry'
  const { ground, accept } = plantingContext(node, ctx)
  const { plan, meshes } = buildPlanting(node, ground, accept)
  if (!textures)
    plain ??= new MeshStandardNodeMaterial({ color: '#b9c4ae', roughness: 0.95, side: DoubleSide })
  const material = textures ? hedgeMaterial() : (plain as MeshStandardNodeMaterial)
  meshes.forEach((data, index) => {
    const mesh = new Mesh(hedgeBufferGeometry(data), material)
    mesh.name = `planting-body-${index}`
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.plantingBodyIndexCount = data.bodyIndexCount
    group.add(mesh)
  })
  group.userData.planting = {
    triangles: plan.estimate.triangles,
    gen: plan.gen,
    area: plan.area,
    plants: plan.placements.length,
    cover: plan.cover,
  }
  return group
}
