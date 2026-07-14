// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { type AnyNode, type RoofNode, RoofSegmentNode } from '@pascal-app/core'
import { getMergeableRoofSegments } from './roof-system'

describe('getMergeableRoofSegments', () => {
  test('ignores measurement children attached under a roof', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_1',
      parentId: 'roof_1',
      position: [1, 0, 2],
    })
    const measurement = {
      id: 'measurement_1',
      parentId: 'roof_1',
      type: 'measurement',
    } as unknown as AnyNode
    const roof = {
      children: [segment.id, measurement.id],
      id: 'roof_1',
      position: [0, 0, 0],
      rotation: 0,
      type: 'roof',
    } as unknown as RoofNode

    expect(
      getMergeableRoofSegments(roof, {
        [measurement.id]: measurement,
        [segment.id]: segment,
      }),
    ).toEqual([segment])
  })
})
