import { describe, expect, test } from 'bun:test'
import { emitter, type GridEvent, type NodeEvent, ShelfNode, sceneRegistry } from '@pascal-app/core'
import { Object3D } from 'three'
import {
  getLevelLocalSnappedPosition,
  isForcePlacementEvent,
  resolveAlignedFloorPlacement,
  subscribeFloorPlacementClicks,
  subscribeFloorPlacementDoubleClicks,
} from './floor-placement'

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

  test('snaps against the world grid before converting into a translated level frame', () => {
    const level = new Object3D()
    level.position.set(0.2, 0, 0.15)
    sceneRegistry.nodes.set('translated-level', level)

    const event = {
      position: [0.32, 0, 0.32],
      localPosition: [0.12, 0, 0.17],
      nativeEvent,
    } as unknown as GridEvent

    try {
      expect(getLevelLocalSnappedPosition('translated-level', event, 0.5)).toEqual([0.3, 0, 0.35])
    } finally {
      sceneRegistry.nodes.delete('translated-level')
    }
  })

  test('recognizes Alt as force placement', () => {
    const event = {
      nativeEvent: { altKey: true },
    } as unknown as GridEvent

    expect(isForcePlacementEvent(event)).toBe(true)
    expect(
      isForcePlacementEvent({
        ...event,
        nativeEvent: { altKey: false } as GridEvent['nativeEvent'],
      }),
    ).toBe(false)
  })

  test('routes generic node clicks and double-clicks without enumerating node kinds', () => {
    const node = ShelfNode.parse({ position: [0, 0, 0] })
    const event: NodeEvent = {
      node,
      position: [0, 0, 0],
      localPosition: [0, 0, 0],
      object: new Object3D(),
      stopPropagation: () => {},
      nativeEvent,
    }
    let clicks = 0
    let doubleClicks = 0
    const unsubscribeClick = subscribeFloorPlacementClicks(() => {
      clicks += 1
    })
    const unsubscribeDoubleClick = subscribeFloorPlacementDoubleClicks(() => {
      doubleClicks += 1
    })

    emitter.emit('node:click', event)
    emitter.emit('node:double-click', event)
    unsubscribeClick()
    unsubscribeDoubleClick()
    emitter.emit('node:click', event)
    emitter.emit('node:double-click', event)

    expect(clicks).toBe(1)
    expect(doubleClicks).toBe(1)
  })
})
