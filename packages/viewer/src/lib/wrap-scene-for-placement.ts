import { Box3, Group, Vector3 } from 'three'
import type { Object3D } from 'three'

/** CAD exports often leave geometry hundreds of meters from the glTF origin. */
const FAR_FROM_ORIGIN_THRESHOLD = 10

/**
 * Wraps a loaded glTF scene so geometry sits near the placement origin.
 * Used for floor, wall, and ceiling items when CAD exports are far from the glTF origin.
 * Skips correction when the model is already near the origin (built-in catalog assets).
 */
export function wrapSceneForFloorPlacement(scene: Object3D): Group {
  const root = new Group()
  root.add(scene)

  const box = new Box3().setFromObject(root)
  if (box.isEmpty()) return root

  const center = new Vector3()
  box.getCenter(center)

  const extent = Math.max(
    Math.abs(box.min.x),
    Math.abs(box.min.y),
    Math.abs(box.min.z),
    Math.abs(box.max.x),
    Math.abs(box.max.y),
    Math.abs(box.max.z),
  )

  const needsCorrection =
    center.length() > FAR_FROM_ORIGIN_THRESHOLD || extent > FAR_FROM_ORIGIN_THRESHOLD * 5

  if (needsCorrection) {
    root.position.set(-center.x, -box.min.y, -center.z)
  }

  return root
}
