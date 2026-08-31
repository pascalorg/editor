import { describe, expect, test } from 'bun:test'
import { BoxGeometry, CylinderGeometry, SphereGeometry } from 'three'
import {
  applyCylinderWorldUvs,
  applyPlanarWorldUvs,
  applySphereWorldUvs,
  cumulativeProfileDistances,
  planarMetricUvs,
} from './primitive-uv'

function span(values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

describe('primitive world-scale UVs', () => {
  test('measures sampled curved profiles in metres', () => {
    expect(
      cumulativeProfileDistances([
        [0, 0, 0],
        [0.3, 0.4, 0],
        [0.3, 0.4, 1],
      ]),
    ).toEqual([0, 0.5, 1.5])
  })

  test('projects trapezoids at their physical size', () => {
    expect(
      planarMetricUvs(
        [
          [0, 0, 0],
          [2, 0, 0],
          [1.5, 1, 0],
          [0.5, 1, 0],
        ],
        [0, 0, 1],
      ),
    ).toEqual([
      [0, 0],
      [2, 0],
      [1.5, 1],
      [0.5, 1],
    ])
  })

  test('maps an axis-aligned box in metres', () => {
    const geometry = new BoxGeometry(2, 3, 4).toNonIndexed()
    applyPlanarWorldUvs(geometry)
    const position = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')

    for (let triangle = 0; triangle < position.count; triangle += 3) {
      for (const [from, to] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ] as const) {
        const a = triangle + from
        const b = triangle + to
        const worldLength = Math.hypot(
          position.getX(b) - position.getX(a),
          position.getY(b) - position.getY(a),
          position.getZ(b) - position.getZ(a),
        )
        const uvLength = Math.hypot(uv.getX(b) - uv.getX(a), uv.getY(b) - uv.getY(a))
        expect(uvLength).toBeCloseTo(worldLength)
      }
    }
  })

  test('unwraps cylinder sides by circumference and height', () => {
    const radius = 0.5
    const height = 3
    const geometry = new CylinderGeometry(radius, radius, height, 16).toNonIndexed()
    applyCylinderWorldUvs(geometry, radius, height)
    const normal = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')
    const sideU: number[] = []
    const sideV: number[] = []
    for (let index = 0; index < normal.count; index += 1) {
      if (Math.abs(normal.getY(index)) >= 0.5) continue
      sideU.push(uv.getX(index))
      sideV.push(uv.getY(index))
    }

    expect(span(sideU)).toBeCloseTo(Math.PI * 2 * radius)
    expect(span(sideV)).toBeCloseTo(height)
  })

  test('unwraps a sphere by circumference and pole distance', () => {
    const radius = 0.5
    const geometry = new SphereGeometry(radius, 12, 8).toNonIndexed()
    applySphereWorldUvs(geometry, radius)
    const uv = geometry.getAttribute('uv')
    const u = Array.from({ length: uv.count }, (_, index) => uv.getX(index))
    const v = Array.from({ length: uv.count }, (_, index) => uv.getY(index))

    expect(span(u)).toBeCloseTo(Math.PI * 2 * radius)
    expect(span(v)).toBeCloseTo(Math.PI * radius)
  })
})
