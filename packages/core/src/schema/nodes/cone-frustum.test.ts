import { describe, expect, test } from 'bun:test'
import { ConeNode } from './cone'
import { FrustumNode } from './frustum'

describe('cone and frustum node schemas', () => {
  test('allow four radial segments for pyramid geometry', () => {
    const cone = ConeNode.parse({
      radius: 1,
      height: 1.5,
      radialSegments: 4,
    })
    const frustum = FrustumNode.parse({
      radiusBottom: 1,
      radiusTop: 0.35,
      height: 1.5,
      radialSegments: 4,
    })

    expect(cone.radialSegments).toBe(4)
    expect(frustum.radialSegments).toBe(4)
  })
})
