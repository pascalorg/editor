import { type Object3D, Vector3 } from 'three'

type WallSide = 'front' | 'back'
type Point = readonly [number, number]

/** Keep the grabbed point only on its original face; new hosts follow the cursor. */
export function createWallPointerTracker(source?: {
  wallId: string | null
  side?: WallSide
  position: readonly number[]
}) {
  let forgotten = !source
  let anchor: { wallId: string; side: WallSide; x: number; y: number } | null = null
  return {
    resolve(wallId: string, side: WallSide, point: Point): [number, number] {
      if (!anchor || anchor.wallId !== wallId || anchor.side !== side) {
        const preserve =
          !forgotten && source?.wallId === wallId && (!source.side || source.side === side)
        if (!preserve) forgotten = true
        anchor = {
          wallId,
          side,
          x: preserve ? source!.position[0]! - point[0] : 0,
          y: preserve ? source!.position[1]! - point[1] : 0,
        }
      }
      return [point[0] + anchor.x, point[1] + anchor.y]
    },
    leave() {
      anchor = null
      forgotten = true
    },
  }
}

/** Measure the hit in the same parent frame that renders the placed child. */
export function wallPointerInParent(
  worldPoint: readonly number[],
  parent: Object3D,
): [number, number, number] {
  parent.updateWorldMatrix(true, false)
  const point = parent.worldToLocal(new Vector3(worldPoint[0], worldPoint[1], worldPoint[2]))
  return [point.x, point.y, point.z]
}

/** Collision mesh winding can differ from the wall frame; the hit identifies the touched side. */
export function wallSideAtPointer(point: readonly number[]): WallSide {
  return point[2]! >= 0 ? 'front' : 'back'
}
