import { describe, expect, test } from 'bun:test'
import { type GridEvent, type NodeEvent, ShelfNode } from '@pascal-app/core'
import { Object3D } from 'three'
import { getLevelLocalSnappedPosition, resolveAlignedFloorPlacement } from './floor-placement'

const nativeEvent = {} as GridEvent['nativeEvent']

describe('floor placement helpers', () => {
  test('resolveAlignedFloorPlacement snaps to the provided grid step', () => {
    const node = ShelfNode.parse({ position: [0, 0, 0] })

    const { guides, position } = resolveAlignedFloorPlacement({
      node,
      rawX: 0.13,
      rawZ: 0.37,
      gridStep: 0.25,
      candidates: [],
    })

    expect(position).toEqual([0.25, 0, 0.25])
    expect(guides).toEqual([])
  })

  test('getLevelLocalSnappedPosition falls back to node world position for node events', () => {
    const node = ShelfNode.parse({ position: [0, 0, 0] })
    const event: NodeEvent = {
      node,
      position: [0.13, 0, 0.37],
      localPosition: [42, 0, 42],
      object: new Object3D(),
      stopPropagation: () => {},
      nativeEvent,
    }

    expect(getLevelLocalSnappedPosition('missing-level', event, 0.25)).toEqual([0.25, 0, 0.25])
  })
})
