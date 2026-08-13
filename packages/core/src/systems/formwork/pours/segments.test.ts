import { describe, expect, it } from 'bun:test'
import { WallNode } from '../../../schema/nodes/wall'
import type { CastableElement } from '../coverage/elements'
import { toCastableElement } from '../coverage/elements'
import { splitIntoSegments } from './segments'

function element(overrides: Partial<Parameters<typeof WallNode.parse>[0]> = {}): CastableElement {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [40, 0],
    thickness: 0.3,
    height: 3,
    formworkType: 'plywood',
    ...overrides,
  })
  const castable = toCastableElement(wall)
  if (!castable) throw new Error('not castable')
  return castable
}

function spans(segments: ReturnType<typeof splitIntoSegments>): Array<[number, number]> {
  return segments.map((s) => [s.startAlong, s.endAlong])
}

describe('no limit', () => {
  it('yields one segment spanning the element', () => {
    expect(spans(splitIntoSegments(element()))).toEqual([[0, 40]])
  })

  it('yields one segment when the element is shorter than the limit', () => {
    expect(spans(splitIntoSegments(element({ end: [8, 0] }), { maxPourLength: 12 }))).toEqual([
      [0, 8],
    ])
  })
})

describe('soft length limit', () => {
  it('divides into equal segments, not a greedy run plus a remainder', () => {
    // Greedy would give 12 + 12 + 12 + 4, and the 4 m bay still needs two
    // stop-ends and a full mobilisation.
    const segments = splitIntoSegments(element(), { maxPourLength: 12 })
    expect(segments.map((s) => s.endAlong - s.startAlong)).toEqual([10, 10, 10, 10])
  })

  it('records the reason on both sides of an internal cut', () => {
    const segments = splitIntoSegments(element(), { maxPourLength: 12 })
    expect(segments[0]?.startCutReason).toBeUndefined()
    expect(segments[0]?.endCutReason).toBe('MAX_POUR_LENGTH')
    expect(segments[1]?.startCutReason).toBe('MAX_POUR_LENGTH')
    expect(segments.at(-1)?.endCutReason).toBeUndefined()
  })
})

describe('soft volume limit', () => {
  it('converts a volume cap into a length through the cross-section', () => {
    // 0.3 × 3 = 0.9 m² of section, so 9 m³ buys 10 m of wall.
    const segments = splitIntoSegments(element(), { maxPourVolume: 9 })
    expect(segments).toHaveLength(4)
    expect(segments[0]?.endCutReason).toBe('MAX_POUR_VOLUME')
  })

  it('cuts once for the binding limit rather than once for each', () => {
    // Length allows 4 bays, volume allows 8. Applying both would give 8.
    const segments = splitIntoSegments(element(), { maxPourLength: 12, maxPourVolume: 4.5 })
    expect(segments).toHaveLength(8)
    expect(segments[0]?.endCutReason).toBe('MAX_POUR_VOLUME')
  })

  it('names the length limit when it is the binding one', () => {
    const segments = splitIntoSegments(element(), { maxPourLength: 12, maxPourVolume: 90 })
    expect(segments).toHaveLength(4)
    expect(segments[0]?.endCutReason).toBe('MAX_POUR_LENGTH')
  })
})

describe('per-element caps', () => {
  it('splits on the element’s own length cap with no project limit', () => {
    const segments = splitIntoSegments(element({ maxPourLength: 12 }))
    expect(segments.map((s) => s.endAlong - s.startAlong)).toEqual([10, 10, 10, 10])
  })

  it('honours the element’s cap when it is tighter than the project’s', () => {
    // A wall the engineer capped at 8 m is not permitted a 20 m bay because the
    // project allows one.
    const segments = splitIntoSegments(element({ maxPourLength: 8 }), { maxPourLength: 20 })
    expect(segments).toHaveLength(5)
  })

  it('keeps the project limit when the element’s cap is looser', () => {
    const segments = splitIntoSegments(element({ maxPourLength: 20 }), { maxPourLength: 8 })
    expect(segments).toHaveLength(5)
  })

  it('splits on the element’s own volume cap', () => {
    const segments = splitIntoSegments(element({ maxPourVolume: 9 }))
    expect(segments).toHaveLength(4)
    expect(segments[0]?.endCutReason).toBe('MAX_POUR_VOLUME')
  })
})

describe('hard cuts', () => {
  it('splits at a hard cut with no soft limit set', () => {
    const segments = splitIntoSegments(element(), {}, [{ along: 15 }])
    expect(spans(segments)).toEqual([
      [0, 15],
      [15, 40],
    ])
    expect(segments[0]?.endCutReason).toBe('HARD_JOINT')
  })

  it('keeps a hard cut exactly where it is and subdivides around it', () => {
    // The soft limit must not move the joint at 15: the two sides are
    // structurally independent.
    const segments = splitIntoSegments(element(), { maxPourLength: 12 }, [{ along: 15 }])
    expect(segments.some((s) => s.endAlong === 15)).toBe(true)
    expect(segments.some((s) => s.startAlong === 15)).toBe(true)
  })

  it('applies the soft limit within each bay, not across the element', () => {
    // Bay 0–15 needs 2 parts of 7.5; bay 15–40 needs 3 of 8.33. A limit applied
    // across the whole element would give 4 equal parts of 10 and lose the joint.
    const segments = splitIntoSegments(element(), { maxPourLength: 12 }, [{ along: 15 }])
    const lengths = segments.map((s) => s.endAlong - s.startAlong)
    expect(lengths).toHaveLength(5)
    for (const [index, expected] of [7.5, 7.5, 25 / 3, 25 / 3, 25 / 3].entries()) {
      expect(lengths[index]).toBeCloseTo(expected, 9)
    }
  })

  it('ignores hard cuts outside the element', () => {
    const segments = splitIntoSegments(element(), {}, [{ along: -3 }, { along: 55 }])
    expect(spans(segments)).toEqual([[0, 40]])
  })

  it('collapses two hard cuts at the same position', () => {
    const segments = splitIntoSegments(element(), {}, [{ along: 15 }, { along: 15 }])
    expect(segments).toHaveLength(2)
  })

  it('orders segments along the element whatever order the cuts arrive in', () => {
    const segments = splitIntoSegments(element(), {}, [{ along: 30 }, { along: 10 }])
    expect(spans(segments)).toEqual([
      [0, 10],
      [10, 30],
      [30, 40],
    ])
  })
})

describe('degenerate input', () => {
  it('yields one segment for a zero-length element', () => {
    // Built past the conversion on purpose: `unformable` refuses a zero-length wall now, so
    // this asserts the splitter is still safe if one ever reaches it another way.
    const zero = { ...element(), end: { x: 0, y: 0 } }
    const segments = splitIntoSegments(zero, { maxPourLength: 5 })
    expect(segments).toHaveLength(1)
  })

  it('ignores a zero volume cap rather than dividing forever', () => {
    const segments = splitIntoSegments(element(), { maxPourVolume: 0 })
    expect(segments).toHaveLength(1)
  })
})
