import { describe, expect, test } from 'bun:test'
import { readSiteBuildable, type SiteNode } from '@pascal-app/core'
import { setbacksAfterPolygonEdit } from './site-boundary'

/**
 * The polygon and its setbacks have to move together, and the only proof that
 * matters is that the buildable ground is unchanged by an edit that does not
 * change the parcel's shape. Splitting an edge at its own midpoint is exactly
 * such an edit — the ring is geometrically identical afterwards, so any drift
 * in the answer is the re-keying getting it wrong.
 */

const parcel: Array<[number, number]> = [
  [-20, -10],
  [20, -10],
  [20, 10],
  [-20, 10],
]

const setbacks: NonNullable<SiteNode['setbacks']> = {
  '0': { role: 'road', distance: 5 },
  '2': { role: 'rear', distance: 4 },
}

function buildableOf(points: Array<[number, number]>, rules: SiteNode['setbacks'] | null) {
  const reading = readSiteBuildable(points, { setbacks: rules ?? {}, defaultSetback: 3 })
  return { area: Math.round(reading.buildableArea * 1e6) / 1e6, rings: reading.rings }
}

describe('setbacksAfterPolygonEdit', () => {
  test('splitting an edge leaves the buildable ground exactly where it was', () => {
    const before = buildableOf(parcel, setbacks)

    for (let edgeIndex = 0; edgeIndex < parcel.length; edgeIndex++) {
      const start = parcel[edgeIndex]!
      const end = parcel[(edgeIndex + 1) % parcel.length]!
      const split: Array<[number, number]> = [...parcel]
      split.splice(edgeIndex + 1, 0, [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2])

      const rekeyed = setbacksAfterPolygonEdit(setbacks, { kind: 'insert', edgeIndex })
      expect(rekeyed).not.toBeNull()
      expect(buildableOf(split, rekeyed).area).toBe(before.area)
    }
  })

  test('removing a vertex that sits on a straight run changes nothing either', () => {
    // A five-point ring whose extra vertex is the midpoint of the road edge:
    // the same parcel, drawn with one redundant point.
    const withMidpoint: Array<[number, number]> = [
      [-20, -10],
      [0, -10],
      [20, -10],
      [20, 10],
      [-20, 10],
    ]
    const spread = setbacksAfterPolygonEdit(setbacks, { kind: 'insert', edgeIndex: 0 })
    expect(buildableOf(withMidpoint, spread).area).toBe(buildableOf(parcel, setbacks).area)

    const collapsed = setbacksAfterPolygonEdit(spread ?? {}, {
      kind: 'remove',
      pointCount: withMidpoint.length,
      vertexIndex: 1,
    })
    expect(buildableOf(parcel, collapsed).area).toBe(buildableOf(parcel, setbacks).area)
  })

  test('says nothing needs moving when there is nothing to move', () => {
    expect(setbacksAfterPolygonEdit(setbacks, undefined)).toBeNull()
    expect(setbacksAfterPolygonEdit({}, { kind: 'insert', edgeIndex: 0 })).toBeNull()
    expect(setbacksAfterPolygonEdit(undefined, { kind: 'insert', edgeIndex: 0 })).toBeNull()
  })
})
