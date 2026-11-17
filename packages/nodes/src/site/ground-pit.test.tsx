import { expect, test } from 'bun:test'
import { create } from '@react-three/test-renderer'
import type { Mesh, Object3D } from 'three'
import { float } from 'three/tsl'
import type { NodeMaterial } from 'three/webgpu'
import { GroundPit } from './ground-pit'
import { buildPitWalls } from './ground-pit-geometry'

// The pit's walls hang from the ground, and the ground is not always the flat grade: on a slope
// each wall starts at its own height, and on a lot that stands above the datum every one of them
// starts above it.

/** A flat grade no other number of the pit comes near, so a shader that reads it is found. */
const FLAT_GRADE = 123.25

/** A round hole of 4 m radius in ground that climbs 0.3 m a metre, well over the datum. */
const walls = buildPitWalls({
  originX: -8,
  originZ: -8,
  span: 16,
  distanceAt: (x, z) => Math.hypot(x, z) - 3,
  radiusAt: () => 1,
  topAt: (x) => 6 + 0.3 * x,
  radiusMin: 1,
  radiusMax: 1,
  cell: 0.5,
})

/** Every number a material's node reads as a uniform. */
function uniformsRead(root: unknown): number[] {
  const values: number[] = []
  ;(root as { traverse: (visit: (node: unknown) => void) => void }).traverse((node) => {
    const uniform = node as { isUniformNode?: boolean; value?: unknown }
    if (uniform.isUniformNode === true && typeof uniform.value === 'number')
      values.push(uniform.value)
  })
  return values
}

test('a wall of the pit is measured from the ground it hangs from: only the floor travels from the flat grade', async () => {
  expect(walls).not.toBeNull()
  const renderer = await create(
    <GroundPit
      box={{ originX: -8, originZ: -8, span: 16 }}
      drawnFloorY={2.95}
      floorY={3}
      inHole={float(1)}
      topsoil="#8a8a8a"
      topY={FLAT_GRADE}
      walls={walls}
    />,
  )
  await renderer.advanceFrames(1, 0.05)
  const parts = new Map<string, NodeMaterial>()
  ;(renderer.scene.instance as Object3D).traverse((object) => {
    const part = object.userData.groundPit as string | undefined
    if (part) parts.set(part, (object as Mesh).material as NodeMaterial)
  })
  const wall = parts.get('walls')!
  const floor = parts.get('floor')!
  // The floor slides from the flat grade down (or up) to its place as the hole opens.
  expect(uniformsRead(floor.positionNode)).toContain(FLAT_GRADE)
  // A wall's shape and its section (the topsoil band, the line at grade) know nothing of it: on
  // sloping ground, or on a lot above the datum, the band would be as deep as the flat grade is
  // far, or cover the whole wall.
  expect(uniformsRead(wall.positionNode)).not.toContain(FLAT_GRADE)
  expect(uniformsRead(wall.colorNode)).not.toContain(FLAT_GRADE)
  await renderer.unmount()
})
