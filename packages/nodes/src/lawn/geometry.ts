import type { GeometryContext, LawnBuild, LawnChunk, LawnNode } from '@pascal-app/core'
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type Material,
  Mesh,
  type Object3D,
  Sphere,
  Vector3,
} from 'three'
import type { MeshStandardNodeMaterial } from 'three/webgpu'
import { disposeLawnBakeTexture } from './bake-textures'
import { lawnBladeMaterial, setLawnBladeDraw } from './blade-material'
import { lawnFlowerMaterial } from './flower-material'
import { type LawnDetailChunk, registerLawnDetail, unregisterLawnDetail } from './lod'
import { buildVisibleLawn } from './render-build'
import { noteLawnBuild } from './stroke-rebuild'
import { MID_ORDER, MID_TUFT, NEAR_ORDER, NEAR_TUFT } from './tuft-shape'
import { lawnGroundMaterial } from './turf-ground'

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

export function lawnFlowerGeometry(data: LawnBuild['flowers']) {
  // Complete heads occupy contiguous triangle ranges. Their live draw can use the
  // vertices directly and pack normals and linear colours without an identity index.
  const geometry = new BufferGeometry()
  // Plain loops: `TypedArray.from` with a mapper took most of a flowering lawn's mesh build.
  const normals = new Int8Array(data.normals.length)
  for (let index = 0; index < normals.length; index++)
    normals[index] = Math.round((data.normals[index] ?? 0) * 127)
  const colors = new Uint8Array(data.colors.length)
  for (let index = 0; index < colors.length; index++)
    colors[index] = Math.round((data.colors[index] ?? 0) * 255)
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3, true))
  geometry.setAttribute('color', new BufferAttribute(colors, 3, true))
  geometry.setAttribute('uv', new BufferAttribute(data.uv, 2, true))
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
  const positions = near ? NEAR_TUFT : MID_TUFT
  const normals = new Float32Array(positions.length)
  for (let index = 2; index < normals.length; index += 3) normals[index] = 1
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('lawnRootHeight', roots)
  geometry.setAttribute('lawnTraits', traits)
  geometry.setIndex(new BufferAttribute(near ? NEAR_ORDER : MID_ORDER, 1))
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
  let maxReach = node.height * 2
  let minY = Infinity
  let maxY = -Infinity
  for (let index = chunk.start; index < chunk.start + chunk.count; index++) {
    const rootY = population.rootHeight[index * 4 + 1] ?? 0
    const height = population.rootHeight[index * 4 + 3] ?? node.height
    const lean = population.traits[index * 4 + 1] ?? 0
    const width = population.traits[index * 4 + 3] ?? node.bladeWidth
    maxReach = Math.max(
      maxReach,
      height * (lean * 1.6 + node.wind * 0.48) + (width * population.tuftWidthScale) / 2,
    )
    minY = Math.min(minY, rootY)
    maxY = Math.max(maxY, rootY + height)
  }
  if (!Number.isFinite(minY)) minY = maxY = 0
  const sphere = new Sphere(
    new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
    Math.hypot(maxX - minX, maxZ - minZ, maxY - minY) / 2 + maxReach,
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
  return {
    key: chunk.key,
    near,
    mid,
    count: chunk.count,
    midCount: chunk.midCount,
    sphere,
    tier: 'far',
  }
}

/** The two blade meshes of one chunk built on its own (`buildLawnChunk`), as the full build makes them. */
export function lawnChunkDetail(
  node: LawnNode,
  chunk: Pick<LawnChunk, 'key' | 'count' | 'midCount' | 'bounds'> & {
    rootHeight: Float32Array
    traits: Float32Array
  },
  material: MeshStandardNodeMaterial,
  tuftWidthScale: number,
): LawnDetailChunk {
  return detailChunk(
    node,
    {
      rootHeight: chunk.rootHeight,
      traits: chunk.traits,
      count: chunk.count,
      chunks: [],
      tuftWidthScale,
    },
    {
      key: chunk.key,
      start: 0,
      count: chunk.count,
      midCount: chunk.midCount,
      bounds: chunk.bounds,
    },
    material,
  )
}

export function lawnGroundGeometry(base: LawnBuild['base']): BufferGeometry {
  const geometry = lawnBufferGeometry(base)
  if (base.cover) geometry.setAttribute('lawnCover', new BufferAttribute(base.cover, 1))
  return geometry
}

export function buildLawnGeometry(node: LawnNode, ctx?: Partial<GeometryContext>): Group {
  const started = performance.now()
  const result = new Group()
  result.name = 'lawn-geometry'
  const built = buildVisibleLawn(node, ctx)
  if (!built) return result
  const group = new Group()
  group.name = 'lawn-detail'
  result.add(group)
  const turf = lawnGroundMaterial(node, !!built.base.cover)
  const ground = new Mesh(lawnGroundGeometry(built.base), turf.material)
  ground.name = 'lawn-ground'
  ground.receiveShadow = true
  group.add(ground)
  let blades: MeshStandardNodeMaterial | undefined
  const chunks: LawnDetailChunk[] = built.blades.chunks.map((chunk) => {
    blades ??= lawnBladeMaterial(node, built.blades.tuftWidthScale)
    const detail = detailChunk(node, built.blades, chunk, blades)
    group.add(detail.near, detail.mid)
    return detail
  })
  let flowers: Mesh | undefined
  if (built.flowers.count > 0) {
    const geometry = lawnFlowerGeometry(built.flowers)
    flowers = new Mesh(geometry, lawnFlowerMaterial())
    flowers.name = 'lawn-flowers'
    flowers.castShadow = flowers.receiveShadow = true
    flowers.visible = false
    group.add(flowers)
  }
  registerLawnDetail({
    group,
    groundDetail: turf.detailed,
    height: node.height,
    chunks,
    flowers,
    headIndexEnds: built.flowers.headIndexEnds,
    live: {
      nodeId: node.id,
      strokes: node.strokes,
      ground,
      groundPainted: !!built.base.cover,
      groundChunks: new Map(),
      groundMaterial: turf.material,
      blades,
      tuftWidthScale: built.blades.tuftWidthScale,
    },
  })
  result.userData.lawn = built.facts
  noteLawnBuild(node.id, performance.now() - started)
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
  for (const material of materials) {
    disposeLawnBakeTexture(material)
    material.dispose()
  }
}

export { updateLawnLOD } from './lod'
