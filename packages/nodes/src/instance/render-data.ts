import {
  Box3,
  type BufferGeometry,
  type Material,
  Matrix4,
  type Mesh,
  type Object3D,
  Vector3,
} from 'three'

export type DefinitionRenderPart = {
  key: string
  geometry: BufferGeometry
  material: Material | Material[]
  matrix: Matrix4
  castShadow: boolean
  receiveShadow: boolean
  renderOrder: number
  name: string
}

export type DefinitionRenderData = {
  signature: string
  parts: DefinitionRenderPart[]
  bounds: {
    center: [number, number, number]
    size: [number, number, number]
  }
}

function isVisibleBelow(object: Object3D, source: Object3D): boolean {
  let current: Object3D | null = object
  while (current && current !== source) {
    if (!current.visible) return false
    current = current.parent
  }
  return current === source
}

function hasRenderableMaterial(material: Material | Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material]
  return materials.some((entry) => entry.visible && entry.colorWrite)
}

function materialSignature(material: Material | Material[]): string {
  return (Array.isArray(material) ? material : [material])
    .map((entry) => `${entry.uuid}:${entry.version}:${entry.visible}:${entry.colorWrite}`)
    .join(',')
}

export function captureDefinitionRenderData(source: Object3D): DefinitionRenderData {
  source.updateWorldMatrix(true, true)
  const sourceInverse = new Matrix4().copy(source.matrixWorld).invert()
  const bounds = new Box3()
  const parts: DefinitionRenderPart[] = []

  source.traverse((object) => {
    const mesh = object as Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean }
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh) return
    if (!isVisibleBelow(mesh, source) || !hasRenderableMaterial(mesh.material)) return
    if (!mesh.geometry.attributes.position || mesh.geometry.attributes.position.count === 0) return

    const matrix = new Matrix4().multiplyMatrices(sourceInverse, mesh.matrixWorld)
    const key = `${mesh.uuid}:${mesh.geometry.uuid}`
    parts.push({
      key,
      geometry: mesh.geometry,
      material: mesh.material,
      matrix,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      renderOrder: mesh.renderOrder,
      name: mesh.name,
    })

    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    if (mesh.geometry.boundingBox) {
      bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(matrix))
    }
  })

  const center = new Vector3(0, 0.5, 0)
  const size = new Vector3(1, 1, 1)
  if (!bounds.isEmpty()) {
    bounds.getCenter(center)
    bounds.getSize(size)
  }

  const signature = parts
    .map(
      (part) =>
        `${part.key}:${materialSignature(part.material)}:${part.matrix.elements.join(',')}:${part.castShadow}:${part.receiveShadow}:${part.renderOrder}`,
    )
    .join('|')

  return {
    signature,
    parts,
    bounds: {
      center: [center.x, center.y, center.z],
      size: [Math.max(0.05, size.x), Math.max(0.05, size.y), Math.max(0.05, size.z)],
    },
  }
}
