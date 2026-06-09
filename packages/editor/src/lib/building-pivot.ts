/**
 * Rotation-invariant bbox pivot for a building group.
 *
 * Why this exists: `new Box3().setFromObject(mesh)` returns a world-AXIS-
 * aligned bbox. Its center is rotation-DEPENDENT — rotating the building
 * by R produces a different AABB shape, so the "center" derived from it
 * shifts every time. Pinning a pivot derived this way makes the building
 * drift across rotations.
 *
 * This helper walks descendant meshes and unions their geometry bounding
 * boxes expressed in the BUILDING'S LOCAL frame. The center of that
 * union is a fixed point in the local frame — genuinely rotation-
 * invariant — so any rotation around it leaves the building visually
 * pinned at the same world point (assuming the position compensation is
 * correct).
 *
 * Returns `null` if the building has no measurable geometry.
 */
import { Box3, Matrix4, type Mesh, type Object3D, Vector3 } from 'three'

export function getBuildingLocalBboxCenter(buildingMesh: Object3D): Vector3 | null {
  buildingMesh.updateMatrixWorld(true)
  const inverseBuildingWorld = buildingMesh.matrixWorld.clone().invert()
  const localBox = new Box3()
  const tmpBox = new Box3()
  const childToLocal = new Matrix4()

  buildingMesh.traverse((child) => {
    if (child === buildingMesh) return
    const m = child as Mesh
    if (!m.isMesh || !m.geometry) return
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
    const gbb = m.geometry.boundingBox
    if (!gbb) return
    tmpBox.copy(gbb)
    childToLocal.multiplyMatrices(inverseBuildingWorld, m.matrixWorld)
    tmpBox.applyMatrix4(childToLocal)
    localBox.union(tmpBox)
  })

  if (localBox.isEmpty()) return null
  return localBox.getCenter(new Vector3())
}
