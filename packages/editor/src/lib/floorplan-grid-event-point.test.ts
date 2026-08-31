import { describe, expect, test } from 'bun:test'
import { resolveGenericFloorplanGridEventPoint } from './floorplan-grid-event-point'

const snapHalf = ([x, z]: [number, number]): [number, number] => [
  Math.round(x / 0.5) * 0.5,
  Math.round(z / 0.5) * 0.5,
]

describe('resolveGenericFloorplanGridEventPoint', () => {
  test('passes the raw pointer to registry tools so attachment can win before grid', () => {
    expect(
      resolveGenericFloorplanGridEventPoint({
        point: [0.73, 0.32],
        registryToolOwnsSnapping: true,
        snap: snapHalf,
      }),
    ).toEqual([0.73, 0.32])
  })

  test('keeps the floorplan snap for interactions without a registry-owned resolver', () => {
    expect(
      resolveGenericFloorplanGridEventPoint({
        point: [0.73, 0.32],
        registryToolOwnsSnapping: false,
        snap: snapHalf,
      }),
    ).toEqual([0.5, 0.5])
  })
})
