import { describe, expect, it } from 'bun:test'
import { StairSegmentNode } from '../../schema'
import { computeSegmentTransforms, rotateXZ } from './stair-footprint'
import { type StairShape, stairShapeSegmentSpecs } from './stair-shape'

const PARAMS = { width: 1, length: 3, height: 2.5, stepCount: 10 }

/** Plan-view AABB of each segment in the stair's local frame, so a shape can
 * be asserted on where its flights actually land rather than on its spec. */
function planFootprints(shape: StairShape) {
  const segments = stairShapeSegmentSpecs(shape, PARAMS).map((spec, index) =>
    StairSegmentNode.parse({ ...spec, id: `sseg_${index}` }),
  )
  const transforms = computeSegmentTransforms(segments)
  return segments.map((segment, index) => {
    const transform = transforms[index]!
    const corners: [number, number][] = [
      [-segment.width / 2, 0],
      [segment.width / 2, 0],
      [segment.width / 2, segment.length],
      [-segment.width / 2, segment.length],
    ]
    const world = corners.map(([x, z]) => {
      const [rx, rz] = rotateXZ(x, z, transform.rotation)
      return [transform.position[0] + rx, transform.position[2] + rz] as const
    })
    return {
      elevation: transform.position[1],
      maxX: Math.max(...world.map(([x]) => x)),
      maxZ: Math.max(...world.map(([, z]) => z)),
      minX: Math.min(...world.map(([x]) => x)),
      minZ: Math.min(...world.map(([, z]) => z)),
      segment,
    }
  })
}

describe('stairShapeSegmentSpecs', () => {
  it('leaves a straight stair as a single flight', () => {
    expect(stairShapeSegmentSpecs('straight', PARAMS)).toEqual([
      {
        attachmentSide: 'front',
        height: 2.5,
        length: 3,
        segmentType: 'stair',
        stepCount: 10,
        width: 1,
      },
    ])
  })

  it('keeps riser and tread identical to the straight stair it splits', () => {
    for (const shape of ['l-shaped', 'u-shaped'] as const) {
      const flights = stairShapeSegmentSpecs(shape, PARAMS).filter(
        (spec) => spec.segmentType === 'stair',
      )
      expect(flights).toHaveLength(2)
      expect(flights.reduce((sum, f) => sum + f.height, 0)).toBeCloseTo(PARAMS.height, 10)
      expect(flights.reduce((sum, f) => sum + f.stepCount, 0)).toBe(PARAMS.stepCount)
      for (const flight of flights) {
        expect(flight.height / flight.stepCount).toBeCloseTo(PARAMS.height / PARAMS.stepCount, 10)
        expect(flight.length / flight.stepCount).toBeCloseTo(PARAMS.length / PARAMS.stepCount, 10)
      }
    }
  })

  it('turns the L 90° onto a full-width landing', () => {
    const [lower, landing, upper] = planFootprints('l-shaped')

    expect(landing!.segment.segmentType).toBe('landing')
    // The landing sits square on the end of the lower flight …
    expect(landing!.minZ).toBeCloseTo(lower!.maxZ, 10)
    expect([landing!.minX, landing!.maxX]).toEqual([lower!.minX, lower!.maxX])
    // … and the upper flight leaves its left edge, spanning exactly that edge.
    expect(upper!.minX).toBeCloseTo(landing!.maxX, 10)
    expect(upper!.minZ).toBeCloseTo(landing!.minZ, 10)
    expect(upper!.maxZ).toBeCloseTo(landing!.maxZ, 10)
    expect(upper!.elevation).toBeCloseTo(lower!.segment.height, 10)
  })

  it('brings the U back alongside its lower flight', () => {
    const [lower, first, second, upper] = planFootprints('u-shaped')

    // Two landings, side by side, together spanning both flights' width.
    expect(first!.segment.segmentType).toBe('landing')
    expect(second!.segment.segmentType).toBe('landing')
    expect(second!.minX).toBeCloseTo(first!.maxX, 10)
    expect([second!.minZ, second!.maxZ]).toEqual([first!.minZ, first!.maxZ])

    // 180°: the upper flight runs back toward the entry, flush beside the
    // lower one, at the same elevation the lower flight reached.
    expect(upper!.minX).toBeCloseTo(lower!.maxX, 10)
    expect(upper!.maxZ).toBeCloseTo(lower!.maxZ, 10)
    expect(upper!.minZ).toBeCloseTo(lower!.maxZ - upper!.segment.length, 10)
    expect(upper!.elevation).toBeCloseTo(lower!.segment.height, 10)
  })

  it('mirrors the turn when the chain turns right', () => {
    const left = stairShapeSegmentSpecs('u-shaped', PARAMS)
    const right = stairShapeSegmentSpecs('u-shaped', { ...PARAMS, turn: 'right' })

    expect(left.map((spec) => spec.attachmentSide)).toEqual(['front', 'front', 'left', 'left'])
    expect(right.map((spec) => spec.attachmentSide)).toEqual(['front', 'front', 'right', 'right'])
  })

  it('splits an odd step count without dropping a step', () => {
    const flights = stairShapeSegmentSpecs('u-shaped', { ...PARAMS, stepCount: 11 }).filter(
      (spec) => spec.segmentType === 'stair',
    )
    expect(flights.map((flight) => flight.stepCount)).toEqual([6, 5])
  })
})
