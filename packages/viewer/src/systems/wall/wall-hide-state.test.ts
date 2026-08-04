// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { Mesh, Vector3 } from 'three/webgpu'
import { getWallHideState } from './wall-cutout'

const wall = (frontSide: string, backSide: string) =>
  WallNode.parse({ start: [0, 0], end: [4, 0], frontSide, backSide })

/** Faces +Z, so `getWorldDirection` returns (0, 0, 1). */
const facingPositiveZ = () => new Mesh()

const towardsPositiveZ = new Vector3(0, 0, 1)
const towardsNegativeZ = new Vector3(0, 0, -1)

describe('getWallHideState', () => {
  test("'up' always shows the wall, even when both sides are interior", () => {
    expect(
      getWallHideState(wall('interior', 'interior'), facingPositiveZ(), 'up', towardsPositiveZ),
    ).toBe(false)
  })

  test("'down' always hides the wall, even when both sides are exterior", () => {
    expect(
      getWallHideState(wall('exterior', 'exterior'), facingPositiveZ(), 'down', towardsPositiveZ),
    ).toBe(true)
  })

  test("'cutaway' hides the near exterior face and keeps the far one", () => {
    const exteriorFront = wall('exterior', 'interior')
    expect(getWallHideState(exteriorFront, facingPositiveZ(), 'cutaway', towardsNegativeZ)).toBe(
      true,
    )
    expect(getWallHideState(exteriorFront, facingPositiveZ(), 'cutaway', towardsPositiveZ)).toBe(
      false,
    )
  })

  test("'cutaway' keeps walls that are exterior on both sides visible from either direction", () => {
    const both = wall('exterior', 'exterior')
    expect(getWallHideState(both, facingPositiveZ(), 'cutaway', towardsNegativeZ)).toBe(false)
    expect(getWallHideState(both, facingPositiveZ(), 'cutaway', towardsPositiveZ)).toBe(false)
  })

  test("'cutaway' hides walls that are interior on both sides", () => {
    expect(
      getWallHideState(
        wall('interior', 'interior'),
        facingPositiveZ(),
        'cutaway',
        towardsPositiveZ,
      ),
    ).toBe(true)
  })
})
