import { describe, expect, test } from 'bun:test'
import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import { SlabNode, WallNode } from '../../schema'
import { computeWallSlabSupport } from '../slab/slab-support'
import golden from './__fixtures__/wall-frame-golden.json'
import { getWallCurveFrameAt } from './wall-curve'
import { getWallPlanFootprint } from './wall-footprint'
import {
  getWallBodyCenterOffset,
  getWallBodyLine,
  getWallFaceLine,
  getWallFaceOffsets,
  getWallLocalFaceZ,
  reverseWallDirection,
} from './wall-frame'
import { calculateLevelMiters } from './wall-mitering'

describe('wall reference frame', () => {
  for (const justification of [undefined, 'a', 'b'] as const) {
    test(`offsets, face lines and body line: ${justification ?? 'center'}`, () => {
      const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2, justification })
      const a = justification === 'a' ? 0.2 : justification === 'b' ? 0 : 0.1
      const b = justification === 'a' ? 0 : justification === 'b' ? -0.2 : -0.1
      expect(getWallFaceOffsets(wall)).toEqual({ a, b })
      expect(a - b).toBe(wall.thickness!)
      expect(getWallBodyCenterOffset(wall)).toBe((a + b) / 2)
      expect(getWallBodyLine(wall)).toEqual({
        start: { x: 0, y: (a + b) / 2 },
        end: { x: 4, y: (a + b) / 2 },
      })
      for (const face of ['a', 'b'] as const) {
        const offset = face === 'a' ? a : b
        expect(getWallFaceLine(wall, face)).toEqual({
          start: { x: 0, y: offset },
          end: { x: 4, y: offset },
        })
        expect(getWallLocalFaceZ(wall, face)).toBe(offset)
      }
    })

    test(`reversal preserves the body and round-trips sparse data: ${justification ?? 'center'}`, () => {
      const wall = WallNode.parse({
        start: [1, 2],
        end: [5, 4],
        thickness: 0.2,
        ...(justification ? { justification } : {}),
        frontSide: 'interior',
        backSide: 'exterior',
        slots: { a: 'library:left', b: 'library:right', aSkirting: 'library:trim' },
        legacyFaceMaterials: { a: { materialPreset: 'library:legacy-left' } },
        faceRegions: [{ id: 'r', face: 'a', u0: 1, v1: 0.9, finish: 'library:wainscot' }],
        skirting: { enabled: true, sides: 'a' },
      })
      for (const original of [wall, { ...wall, curveOffset: 0.4 }]) {
        const reversed = { ...original, ...reverseWallDirection(original) }
        expect({ ...reversed, ...reverseWallDirection(reversed) }).toEqual(original)
        // Face-keyed data follows the faces; stations are re-measured from the new start.
        expect(reversed.slots).toEqual({
          b: 'library:left',
          a: 'library:right',
          bSkirting: 'library:trim',
        })
        expect(reversed.legacyFaceMaterials).toEqual({
          b: { materialPreset: 'library:legacy-left' },
        })
        const length = Math.hypot(4, 2)
        expect(reversed.faceRegions).toEqual([
          { id: 'r', face: 'b', u1: length - 1, v1: 0.9, finish: 'library:wainscot' },
        ])
        expect(reversed.skirting?.sides).toBe('b')
        expect(reversed.frontSide).toBe(original.backSide)
        expect(reversed.backSide).toBe(original.frontSide)
        expect('justification' in reversed).toBe('justification' in original)
        expect('curveOffset' in reversed).toBe('curveOffset' in original)
        for (const t of [0, 0.25, 0.5, 1]) {
          const before = getWallCurveFrameAt(original, t)
          const after = getWallCurveFrameAt(reversed, 1 - t)
          expect(after.point.x).toBeCloseTo(before.point.x, 12)
          expect(after.point.y).toBeCloseTo(before.point.y, 12)
        }
        const before = getWallFaceOffsets(original)
        const after = getWallFaceOffsets(reversed)
        expect(after.a).toBeCloseTo(-before.b, 12)
        expect(after.b).toBeCloseTo(-before.a, 12)
      }
    })
  }

  test('local face z matches the viewer world-to-local rotation', () => {
    for (const end of [
      [4, 0],
      [0, 4],
      [3, -4],
      [-3, -4],
    ] as [number, number][]) {
      for (const justification of [undefined, 'a', 'b'] as const) {
        const wall = WallNode.parse({ start: [0, 0], end, thickness: 0.2, justification })
        const angle = Math.atan2(end[1], end[0])
        for (const face of ['a', 'b'] as const) {
          const point = getWallFaceLine(wall, face).start
          expect(point.x * Math.sin(-angle) + point.y * Math.cos(-angle)).toBeCloseTo(
            getWallLocalFaceZ(wall, face),
            14,
          )
        }
      }
    }
  })

  test('absence remains absent and degenerate lines stay finite', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [0, 0] })
    expect('justification' in wall).toBe(false)
    expect(getWallFaceOffsets(wall)).toEqual({ a: 0.05, b: -0.05 })
    expect(getWallBodyLine({ ...wall, justification: 'a' })).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
    })
  })
})

test('centered walls match the pre-kernel golden byte for byte', () => {
  const serialize = (value: unknown) =>
    JSON.stringify(value, (_, entry) => (entry instanceof Map ? [...entry.entries()] : entry))
  for (const fixture of golden) {
    const walls = fixture.walls.map((wall) => WallNode.parse(wall))
    const slabs = fixture.slabs.map((slab) => SlabNode.parse(slab))
    const miters = calculateLevelMiters(walls)
    expect(
      serialize({
        miters,
        footprints: walls.map((wall) => getWallPlanFootprint(wall, miters)),
        polygons: slabs.map((slab) =>
          getRenderableSlabPolygon(slab, {
            walls,
            siblingSlabs: slabs.filter((other) => other.id !== slab.id),
          }),
        ),
        support: walls.map((wall) => {
          const {
            faceDatum,
            faceBottom: _bottom,
            ...legacy
          } = computeWallSlabSupport(wall, slabs, walls)
          expect(faceDatum.a).toEqual(legacy.baseSegments)
          expect(faceDatum.b).toEqual(legacy.baseSegments)
          return legacy
        }),
      }),
    ).toBe(serialize(fixture.output))
  }
})
