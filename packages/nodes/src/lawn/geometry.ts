import type { GeometryContext, LawnBuild, LawnChunk, LawnNode } from '@pascal-app/core'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type Material,
  Mesh,
  type Object3D,
  Sphere,
  Vector3,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { lawnBladeMaterial, setLawnBladeDraw } from './blade-material'
import {
  LAWN_MID_INDICES,
  LAWN_MID_POSITIONS,
  LAWN_NEAR_INDICES,
  LAWN_NEAR_POSITIONS,
} from './blade-shape'
import { type LawnDetailChunk, registerLawnDetail, unregisterLawnDetail } from './lod'
import { buildVisibleLawn } from './render-build'

export type LawnMeshArrays = {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  indices: Uint32Array
}

export function lawnBufferGeometry(data: LawnMeshArrays): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))
  geometry.setAttribute('color', new BufferAttribute(data.colors, 3))
  geometry.setIndex(new BufferAttribute(data.indices, 1))
  geometry.computeBoundingSphere()
  return geometry
}

function bladeGeometry(
  near: boolean,
  roots: InstancedBufferAttribute,
  traits: InstancedBufferAttribute,
  sphere: Sphere,
) {
  const geometry = new InstancedBufferGeometry()
  const positions = near ? LAWN_NEAR_POSITIONS : LAWN_MID_POSITIONS
  const normals = new Float32Array(positions.length)
  for (let index = 2; index < normals.length; index += 3) normals[index] = 1
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('lawnRootHeight', roots)
  geometry.setAttribute('lawnTraits', traits)
  geometry.setIndex(new BufferAttribute(near ? LAWN_NEAR_INDICES : LAWN_MID_INDICES, 1))
  geometry.boundingSphere = sphere
  return geometry
}

function detailChunk(
  node: LawnNode,
  population: LawnBuild['blades'],
  chunk: LawnChunk,
  material: MeshStandardNodeMaterial,
): LawnDetailChunk {
  const [minX, minZ, maxX, maxZ] = chunk.bounds
  let minY = Infinity
  let maxY = -Infinity
  for (let index = chunk.start; index < chunk.start + chunk.count; index++) {
    minY = Math.min(minY, population.rootHeight[index * 4 + 1] ?? 0)
    maxY = Math.max(
      maxY,
      (population.rootHeight[index * 4 + 1] ?? 0) +
        (population.rootHeight[index * 4 + 3] ?? node.height),
    )
  }
  if (!Number.isFinite(minY)) minY = maxY = 0
  const sphere = new Sphere(
    new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
    Math.hypot(maxX - minX, maxZ - minZ, maxY - minY) / 2 + node.height * 2,
  )
  const roots = new InstancedBufferAttribute(
    population.rootHeight.subarray(chunk.start * 4, (chunk.start + chunk.count) * 4),
    4,
  )
  const traits = new InstancedBufferAttribute(
    population.traits.subarray(chunk.start * 4, (chunk.start + chunk.count) * 4),
    4,
  )
  const near = new Mesh(bladeGeometry(true, roots, traits, sphere), material)
  const mid = new Mesh(bladeGeometry(false, roots, traits, sphere), material)
  near.name = `lawn-blades-near-${chunk.key}`
  mid.name = `lawn-blades-mid-${chunk.key}`
  const configureNear = () => {
    setLawnBladeDraw(material, true, chunk.midCount)
  }
  const configureMid = () => {
    setLawnBladeDraw(material, false, chunk.midCount)
  }
  near.onBeforeRender = near.onBeforeShadow = configureNear
  mid.onBeforeRender = mid.onBeforeShadow = configureMid
  near.castShadow = mid.castShadow = true
  near.receiveShadow = mid.receiveShadow = true
  near.visible = mid.visible = false
  return { near, mid, count: chunk.count, midCount: chunk.midCount, sphere, tier: 'far' }
}

export function buildLawnGeometry(node: LawnNode, ctx?: Partial<GeometryContext>): Group {
  const result = new Group()
  result.name = 'lawn-geometry'
  const built = buildVisibleLawn(node, ctx)
  if (!built) return result
  const group = new Group()
  group.name = 'lawn-detail'
  result.add(group)
  const material = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.96,
    side: DoubleSide,
  })
  material.name = 'lawn-ground-and-flowers'
  const ground = new Mesh(lawnBufferGeometry(built.base), material)
  ground.name = 'lawn-ground'
  ground.receiveShadow = true
  group.add(ground)
  let blades: MeshStandardNodeMaterial | undefined
  const chunks: LawnDetailChunk[] = built.blades.chunks.map((chunk) => {
    blades ??= lawnBladeMaterial(node)
    const detail = detailChunk(node, built.blades, chunk, blades)
    group.add(detail.near, detail.mid)
    return detail
  })
  let flowers: Mesh | undefined
  if (built.flowers.count > 0) {
    flowers = new Mesh(lawnBufferGeometry(built.flowers), material)
    flowers.name = 'lawn-flowers'
    flowers.castShadow = flowers.receiveShadow = true
    flowers.visible = false
    group.add(flowers)
  }
  registerLawnDetail({
    group,
    height: node.height,
    chunks,
    flowers,
    headIndexEnds: built.flowers.headIndexEnds,
  })
  result.userData.lawn = built.facts
  return result
}

const disposed = new WeakSet<Object3D>()
export function disposeLawnGeometry(group: Object3D): void {
  if (disposed.has(group)) return
  disposed.add(group)
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  group.traverse((object) => {
    unregisterLawnDetail(object)
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

export { updateLawnLOD } from './lod'
