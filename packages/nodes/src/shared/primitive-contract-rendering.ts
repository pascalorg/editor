import type { PrimitiveShapeContract, Vec3 } from '@pascal-app/core'
import * as THREE from 'three'

export type PrimitivePatternInstance = {
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  name?: string
}

export type RenderPrimitiveContract = Omit<PrimitiveShapeContract, 'pattern'> & {
  pattern?: NonNullable<PrimitiveShapeContract['pattern']> & {
    instances?: PrimitivePatternInstance[]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function primitiveContractFromMetadata(
  metadata: unknown,
): RenderPrimitiveContract | undefined {
  if (!isRecord(metadata)) return undefined
  const contract = metadata.primitiveContract
  return isRecord(contract) ? (contract as RenderPrimitiveContract) : undefined
}

export function primitivePatternInstances(metadata: unknown): PrimitivePatternInstance[] {
  const instances = primitiveContractFromMetadata(metadata)?.pattern?.instances
  return Array.isArray(instances) && instances.length > 1 ? instances : []
}

export function applyInstanceMatrices(
  mesh: THREE.InstancedMesh | null,
  instances: readonly PrimitivePatternInstance[],
) {
  if (!mesh || instances.length === 0) return
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const rotation = new THREE.Euler()
  const scale = new THREE.Vector3()

  instances.forEach((instance, index) => {
    const [x = 0, y = 0, z = 0] = instance.position ?? [0, 0, 0]
    const [rx = 0, ry = 0, rz = 0] = instance.rotation ?? [0, 0, 0]
    const [sx = 1, sy = 1, sz = 1] = instance.scale ?? [1, 1, 1]
    position.set(x, y, z)
    rotation.set(rx, ry, rz)
    quaternion.setFromEuler(rotation)
    scale.set(sx, sy, sz)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingBox()
  mesh.computeBoundingSphere()
}
