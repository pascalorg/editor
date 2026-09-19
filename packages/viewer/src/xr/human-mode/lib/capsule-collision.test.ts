// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Mesh, Vector3 } from 'three'
import { computeBoundsTree } from 'three-mesh-bvh'
import { resolveCapsuleTranslation, resolveRoomScaleOriginCorrection } from './capsule-collision'

function createWallCollider() {
  const geometry = new BoxGeometry(4, 3, 0.1)
  ;(geometry as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree =
    computeBoundsTree
  ;(geometry as unknown as { computeBoundsTree(): void }).computeBoundsTree()
  const wall = new Mesh(geometry)
  wall.position.y = 1.5
  wall.updateWorldMatrix(true, false)
  return wall
}

describe('Human capsule collision', () => {
  test('stops a large movement before tunneling through a rendered wall', () => {
    const wall = createWallCollider()
    const movement = resolveCapsuleTranslation(
      [wall],
      new Vector3(0, 1.65, -1),
      new Vector3(0, 0, 2),
      new Vector3(),
    )

    expect(movement.z).toBeCloseTo(0.7, 2)
    wall.geometry.dispose()
  })

  test('corrects room-scale walking that crosses a rendered wall', () => {
    const wall = createWallCollider()
    const correction = resolveRoomScaleOriginCorrection(
      [wall],
      new Vector3(0, 1.65, -1),
      new Vector3(0, 1.65, 1),
      new Vector3(),
    )

    expect(correction.z).toBeCloseTo(-1.3, 2)
    wall.geometry.dispose()
  })
})
