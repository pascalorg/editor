import type { GeometryContext, LawnNode } from '@pascal-app/core'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three'
import { buildLawnBladeBakeColors } from './bake-blade-colors'
import { LAWN_NEAR_INDICES, LAWN_NEAR_POSITIONS, lawnBladePoint } from './blade-shape'
import { type LawnMeshArrays, lawnBufferGeometry } from './geometry'
import { buildVisibleLawn } from './render-build'

const BLADES_PER_MESH = 8192

function portableChunks(data: LawnMeshArrays): LawnMeshArrays[] {
  if (data.positions.length / 3 <= 65535) return [data]
  const chunks: LawnMeshArrays[] = []
  for (let start = 0; start < data.indices.length; start += 65535) {
    const count = Math.min(65535, data.indices.length - start)
    const positions = new Float32Array(count * 3)
    const normals = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const indices = new Uint32Array(count)
    for (let index = 0; index < count; index++) {
      const source = (data.indices[start + index] ?? 0) * 3
      positions.set(data.positions.subarray(source, source + 3), index * 3)
      normals.set(data.normals.subarray(source, source + 3), index * 3)
      colors.set(data.colors.subarray(source, source + 3), index * 3)
      indices[index] = index
    }
    chunks.push({ positions, normals, colors, indices })
  }
  return chunks
}

function expandBlades(roots: Float32Array, traits: Float32Array, start: number, count: number) {
  const positions = new Float32Array(count * 7 * 3)
  const normals = new Float32Array(positions.length)
  const indices = new Uint16Array(count * 15)
  for (let blade = 0; blade < count; blade++) {
    const input = (start + blade) * 4
    const [x = 0, y = 0, z = 0, height = 0] = roots.subarray(input, input + 4)
    const [yaw = 0, lean = 0, , width = 0] = traits.subarray(input, input + 4)
    for (let vertex = 0; vertex < 7; vertex++) {
      const progress = LAWN_NEAR_POSITIONS[vertex * 3 + 1] ?? 0
      const side = (LAWN_NEAR_POSITIONS[vertex * 3] ?? 0) * width
      const point = lawnBladePoint(side, progress, height, yaw, lean, 0, 0, x, z)
      const offset = (blade * 7 + vertex) * 3
      positions.set([x + point[0], y + point[1], z + point[2]], offset)
      const normal = new Vector3(
        Math.sin(yaw),
        -2 * progress * lean * 1.6,
        Math.cos(yaw),
      ).normalize()
      normal.y += 1.25
      normal.normalize()
      normals.set([normal.x, normal.y, normal.z], offset)
    }
    for (let index = 0; index < 15; index++)
      indices[blade * 15 + index] = blade * 7 + (LAWN_NEAR_INDICES[index] ?? 0)
  }
  return { positions, normals, indices }
}

function addBlades(
  group: Group,
  node: LawnNode,
  roots: Float32Array,
  traits: Float32Array,
  start: number,
  count: number,
) {
  const data = expandBlades(roots, traits, start, count)
  const { material, uv } = buildLawnBladeBakeColors(node, traits, start, count)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.setIndex(new BufferAttribute(data.indices, 1))
  geometry.computeBoundingSphere()
  const mesh = new Mesh(geometry, material)
  mesh.name = `lawn-blades-static-${start}`
  mesh.castShadow = mesh.receiveShadow = true
  group.add(mesh)
}

/** The portable tree uses the canonical population, never a camera's runtime subset. */
export function buildLawnBakeGeometry(node: LawnNode, ctx?: Partial<GeometryContext>): Group {
  const group = new Group()
  group.name = 'lawn-geometry'
  const built = buildVisibleLawn(node, ctx)
  if (!built) return group
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    side: DoubleSide,
  })
  const add = (data: LawnMeshArrays, name: string) => {
    portableChunks(data).forEach((chunk, index) => {
      const geometry = lawnBufferGeometry(chunk)
      geometry.setIndex(new BufferAttribute(new Uint16Array(chunk.indices), 1))
      const mesh = new Mesh(geometry, material)
      mesh.name = index ? `${name}-${index}` : name
      mesh.castShadow = mesh.receiveShadow = true
      group.add(mesh)
    })
  }
  add(built.base, 'lawn-ground')
  for (let start = 0; start < built.blades.count; start += BLADES_PER_MESH) {
    const count = Math.min(BLADES_PER_MESH, built.blades.count - start)
    addBlades(group, node, built.blades.rootHeight, built.blades.traits, start, count)
  }
  if (built.flowers.count) add(built.flowers, 'lawn-flowers')
  group.userData.lawn = built.facts
  return group
}
