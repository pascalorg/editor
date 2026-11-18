import { BufferAttribute, BufferGeometry, type Group, Mesh, type MeshStandardMaterial } from 'three'

export type LawnBakeMesh = {
  positions: Float32Array
  normals: Float32Array
  uv: Float32Array
  indices: Uint32Array | Uint16Array
}

export function addLawnBakeMesh(
  group: Group,
  data: LawnBakeMesh,
  material: MeshStandardMaterial,
  name: string,
) {
  const add = (chunk: LawnBakeMesh, suffix: string) => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(chunk.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(chunk.normals, 3))
    geometry.setAttribute('uv', new BufferAttribute(chunk.uv, 2))
    geometry.setIndex(new BufferAttribute(new Uint16Array(chunk.indices), 1))
    geometry.computeBoundingSphere()
    const mesh = new Mesh(geometry, material)
    mesh.name = name + suffix
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }
  if (data.positions.length / 3 <= 65535) {
    add(data, '')
    return
  }
  // Split only on complete triangle boundaries. Some portable consumers require uint16 indices.
  for (let start = 0; start < data.indices.length; start += 65535) {
    const count = Math.min(65535, data.indices.length - start)
    const positions = new Float32Array(count * 3),
      normals = new Float32Array(count * 3),
      uv = new Float32Array(count * 2),
      indices = new Uint16Array(count)
    for (let i = 0; i < count; i++) {
      const source = data.indices[start + i] ?? 0
      positions.set(data.positions.subarray(source * 3, source * 3 + 3), i * 3)
      normals.set(data.normals.subarray(source * 3, source * 3 + 3), i * 3)
      uv.set(data.uv.subarray(source * 2, source * 2 + 2), i * 2)
      indices[i] = i
    }
    add({ positions, normals, uv, indices }, `-${start}`)
  }
}
