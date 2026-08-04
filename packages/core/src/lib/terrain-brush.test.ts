import { describe, expect, test } from 'bun:test'
import {
  advanceStroke,
  beginStroke,
  DEFAULT_BRUSH_SETTINGS,
  detachStrokeAnchor,
  highestOver,
  MIN_BRUSH_RADIUS_IN_SPACINGS,
  maxCoverage,
  minBrushRadius,
  RAISE_METRES_PER_STROKE,
  sampleTarget,
  weightAt,
} from './terrain-brush'
import {
  applyHeightPatch,
  createTerrainField,
  heightAt,
  isFlatOver,
  quantize,
  type TerrainField,
} from './terrain-field'

function field(): TerrainField {
  return createTerrainField({ cols: 33, rows: 33, spacing: 0.5, origin: [-8, -8] })
}

/** Run a whole stroke and return the resulting field. */
function stroke(
  start: TerrainField,
  options: Omit<Parameters<typeof beginStroke>[0], 'field'>,
  path: Array<[number, number]>,
): TerrainField {
  const active = beginStroke({ field: start, ...options })
  let result = start
  for (const [x, z] of path) {
    const patch = advanceStroke(active, x, z)
    if (patch) result = applyHeightPatch(result, patch)
  }
  return result
}

describe('weightAt', () => {
  test('is 1 at the centre and 0 at the rim', () => {
    const settings = { ...DEFAULT_BRUSH_SETTINGS, radius: 2 }
    expect(weightAt(settings, 0, 0)).toBeCloseTo(1, 6)
    expect(weightAt(settings, 2, 0)).toBe(0)
    expect(weightAt(settings, 3, 0)).toBe(0)
  })

  test('has zero derivative at both ends — the anti-ridge property', () => {
    // A kernel that is only C¹ at the centre leaves a visible crease at the
    // brush boundary. Approximate the derivative just inside the rim: it must be
    // vanishing, not merely small.
    const settings = { ...DEFAULT_BRUSH_SETTINGS, radius: 2, falloff: 1 }
    const nearRim = weightAt(settings, 1.99, 0) - weightAt(settings, 1.98, 0)
    const midway = weightAt(settings, 1.01, 0) - weightAt(settings, 1.0, 0)
    expect(Math.abs(nearRim)).toBeLessThan(Math.abs(midway) / 10)
  })

  test('falloff 0 is a hard stamp — full coverage right up to the rim', () => {
    const settings = { ...DEFAULT_BRUSH_SETTINGS, radius: 2, falloff: 0 }
    expect(weightAt(settings, 1.99, 0)).toBe(1)
    expect(weightAt(settings, 2.01, 0)).toBe(0)
  })

  test('square uses Chebyshev distance so the corners are covered', () => {
    const round = { ...DEFAULT_BRUSH_SETTINGS, radius: 2, falloff: 0, shape: 'round' as const }
    const square = { ...DEFAULT_BRUSH_SETTINGS, radius: 2, falloff: 0, shape: 'square' as const }
    // A point at the corner of the 2 m box is 2.8 m away: outside the circle,
    // inside the square.
    expect(weightAt(round, 1.9, 1.9)).toBe(0)
    expect(weightAt(square, 1.9, 1.9)).toBe(1)
  })
})

describe('raise', () => {
  test('a single dab raises the ground under the brush and nothing outside it', () => {
    const base = field()
    const result = stroke(base, { verb: 'raise', settings: { radius: 2, falloff: 0.5 } }, [[0, 0]])

    expect(heightAt(result, 0, 0)).toBeGreaterThan(0)
    // 3 m out is well past the 2 m radius.
    expect(heightAt(result, 3.5, 0)).toBeCloseTo(0, 6)
  })

  test('dwelling in one spot does not compound — the saturating invariant', () => {
    // The naive `h += strength * falloff` model makes this test's height grow
    // linearly with the number of events, which is the documented cause of
    // "hash edges and jagged". Here, twenty events at the same point produce
    // exactly what one produces.
    const base = field()
    const once = stroke(base, { verb: 'raise', settings: { radius: 2 } }, [[0, 0]])
    const twenty = stroke(
      base,
      { verb: 'raise', settings: { radius: 2 } },
      Array.from({ length: 20 }, () => [0, 0] as [number, number]),
    )
    expect(heightAt(twenty, 0, 0)).toBeCloseTo(heightAt(once, 0, 0), 6)
  })

  test('re-crossing your own stroke does not compound either', () => {
    const base = field()
    const oneWay = stroke(base, { verb: 'raise', settings: { radius: 1.5 } }, [
      [-3, 0],
      [3, 0],
    ])
    const backAndForth = stroke(base, { verb: 'raise', settings: { radius: 1.5 } }, [
      [-3, 0],
      [3, 0],
      [-3, 0],
      [3, 0],
    ])
    expect(heightAt(backAndForth, 0, 0)).toBeCloseTo(heightAt(oneWay, 0, 0), 6)
  })

  test('one full-strength pass is bounded by RAISE_METRES_PER_STROKE', () => {
    const base = field()
    const result = stroke(
      base,
      { verb: 'raise', settings: { radius: 2, strength: 1, falloff: 0 } },
      [[0, 0]],
    )
    expect(heightAt(result, 0, 0)).toBeCloseTo(RAISE_METRES_PER_STROKE, 2)
  })

  test('a second stroke goes further — repeats are how you get more', () => {
    // Bounded per stroke, not bounded overall. Press again to keep going.
    const base = field()
    const first = stroke(
      base,
      { verb: 'raise', settings: { radius: 2, strength: 1, falloff: 0 } },
      [[0, 0]],
    )
    const second = stroke(
      first,
      { verb: 'raise', settings: { radius: 2, strength: 1, falloff: 0 } },
      [[0, 0]],
    )
    expect(heightAt(second, 0, 0)).toBeCloseTo(2 * RAISE_METRES_PER_STROKE, 2)
  })

  test('lower is raise with the sign inverted', () => {
    const base = field()
    const up = stroke(base, { verb: 'raise', settings: { radius: 2, strength: 1, falloff: 0 } }, [
      [0, 0],
    ])
    const down = stroke(base, { verb: 'lower', settings: { radius: 2, strength: 1, falloff: 0 } }, [
      [0, 0],
    ])
    expect(heightAt(down, 0, 0)).toBeCloseTo(-heightAt(up, 0, 0), 6)
  })

  test('lower digs below the datum — basements need negative ground', () => {
    const base = field()
    const result = stroke(
      base,
      { verb: 'lower', settings: { radius: 2, strength: 1, falloff: 0 } },
      [[0, 0]],
    )
    expect(heightAt(result, 0, 0)).toBeLessThan(0)
  })
})

describe('arc-length spacing', () => {
  test('a fast drag and a slow drag deposit the same material', () => {
    // Same path, different event density. Without arc-length spacing the
    // 40-event version would deposit far more, making stroke strength a
    // function of frame rate.
    const base = field()
    const settings = { radius: 1.5, strength: 0.8 }
    const coarse = stroke(base, { verb: 'raise', settings }, [
      [-4, 0],
      [4, 0],
    ])
    const fine = stroke(
      base,
      { verb: 'raise', settings },
      Array.from({ length: 40 }, (_, i) => [-4 + (8 * i) / 39, 0] as [number, number]),
    )
    expect(heightAt(fine, 0, 0)).toBeCloseTo(heightAt(coarse, 0, 0), 2)
  })

  test('motion shorter than one dab spacing deposits nothing new', () => {
    const base = field()
    const active = beginStroke({ verb: 'raise', field: base, settings: { radius: 4 } })
    expect(advanceStroke(active, 0, 0)).not.toBeNull()
    // Spacing is radius/4 = 1 m; 0.1 m is well under it.
    expect(advanceStroke(active, 0.1, 0)).toBeNull()
    expect(advanceStroke(active, 0.2, 0)).toBeNull()
    // Accumulated motion eventually crosses the threshold.
    expect(advanceStroke(active, 1.5, 0)).not.toBeNull()
  })

  test('a click with no drag still deposits one dab', () => {
    const active = beginStroke({ verb: 'raise', field: field() })
    const patch = advanceStroke(active, 0, 0)
    expect(patch).not.toBeNull()
    expect(maxCoverage(active)).toBeCloseTo(1, 6)
  })
})

describe('detachStrokeAnchor', () => {
  // The gap a camera zoom leaves in the pointer stream. The tool skips dabs while
  // `cameraDragging`, and arc-length spacing means the *skip alone* is not enough:
  // the next real dab would interpolate all the way back to the pre-zoom centre.
  const settings = { radius: 1.5, strength: 0.8 }
  const jump = (detach: boolean): TerrainField => {
    const base = field()
    const active = beginStroke({ verb: 'raise', field: base, settings })
    let result = applyHeightPatch(base, advanceStroke(active, -4, 0)!)
    if (detach) detachStrokeAnchor(active)
    const patch = advanceStroke(active, 4, 0)
    if (patch) result = applyHeightPatch(result, patch)
    return result
  }

  test('the skipped stretch stays unpainted', () => {
    // Midway between the two ends — nowhere the pointer was while painting.
    expect(heightAt(jump(true), 0, 0)).toBe(0)
  })

  test('without it the same gap is bridged, which is the bug', () => {
    // Not a redundant inverse: this is the assertion that fails if someone
    // "simplifies" the tool by dropping the detach and keeping only the skip.
    expect(heightAt(jump(false), 0, 0)).toBeGreaterThan(0)
  })

  test('both ends of the jump are still painted', () => {
    const detached = jump(true)
    expect(heightAt(detached, -4, 0)).toBeGreaterThan(0)
    expect(heightAt(detached, 4, 0)).toBeGreaterThan(0)
  })

  test('the stroke stays saturating across the break', () => {
    // The mask survives, so re-crossing painted ground does not stack a ridge —
    // the property that makes a stroke one gesture rather than N dabs.
    const base = field()
    const active = beginStroke({ verb: 'raise', field: base, settings })
    let result = base
    for (const [x, z] of [
      [0, 0],
      [2, 0],
    ] as Array<[number, number]>) {
      const patch = advanceStroke(active, x, z)
      if (patch) result = applyHeightPatch(result, patch)
    }
    const beforeBreak = heightAt(result, 0, 0)
    detachStrokeAnchor(active)
    // Straight back over the start: a fresh stroke would deposit again.
    const patch = advanceStroke(active, 0, 0)
    if (patch) result = applyHeightPatch(result, patch)
    expect(heightAt(result, 0, 0)).toBeCloseTo(beforeBreak, 6)
  })
})

describe('flatten', () => {
  test('converges on the absolute target without overshoot', () => {
    const base = field()
    let result = base
    for (let pass = 0; pass < 12; pass++) {
      result = stroke(
        result,
        { verb: 'flatten', target: 2.5, settings: { radius: 2, strength: 1, falloff: 0 } },
        [[0, 0]],
      )
      // Never past the target, at any pass count — the property freehand
      // raise/lower cannot offer.
      expect(heightAt(result, 0, 0)).toBeLessThanOrEqual(2.5 + 1e-9)
    }
    expect(heightAt(result, 0, 0)).toBeCloseTo(2.5, 6)
  })

  test('a full-strength hard-edged pass lands exactly on the target', () => {
    const base = field()
    const result = stroke(
      base,
      { verb: 'flatten', target: 1.75, settings: { radius: 2, strength: 1, falloff: 0 } },
      [[0, 0]],
    )
    expect(heightAt(result, 0, 0)).toBeCloseTo(1.75, 6)
  })

  test('two disjoint pads flattened to the same target are exactly equal', () => {
    // This is the whole reason flatten-to-absolute exists: quantized heights
    // plus an absolute target means `isFlatOver` is a true integer equality
    // across pads that never touched each other.
    let result = createTerrainField({ cols: 65, rows: 65, spacing: 0.5, origin: [-16, -16] })
    const settings = { radius: 2, strength: 1, falloff: 0 }
    result = stroke(result, { verb: 'flatten', target: 1.2, settings }, [[-8, 0]])
    result = stroke(result, { verb: 'flatten', target: 1.2, settings }, [[8, 0]])

    expect(isFlatOver(result, -9, -1, -7, 1)).toBe(true)
    expect(isFlatOver(result, 7, -1, 9, 1)).toBe(true)
    expect(quantize(result, heightAt(result, -8, 0))).toBe(quantize(result, heightAt(result, 8, 0)))
  })

  test('flatten pulls a raised hill back down as readily as it pushes up', () => {
    const base = field()
    const raised = stroke(
      base,
      { verb: 'raise', settings: { radius: 3, strength: 1, falloff: 0 } },
      [[0, 0]],
    )
    const flattened = stroke(
      raised,
      { verb: 'flatten', target: 0, settings: { radius: 3, strength: 1, falloff: 0 } },
      [[0, 0]],
    )
    expect(heightAt(flattened, 0, 0)).toBeCloseTo(0, 6)
  })

  test('sampleTarget reads the height the user clicked', () => {
    const base = field()
    const raised = stroke(
      base,
      { verb: 'raise', settings: { radius: 2, strength: 1, falloff: 0 } },
      [[4, 0]],
    )
    expect(sampleTarget(raised, 4, 0)).toBeCloseTo(heightAt(raised, 4, 0), 6)
  })
})

describe('smooth', () => {
  test('reduces the peak of a spike without moving flat ground', () => {
    const base = field()
    const spiked = stroke(
      base,
      { verb: 'raise', settings: { radius: 1, strength: 1, falloff: 0 } },
      [[0, 0]],
    )
    const peak = heightAt(spiked, 0, 0)
    const smoothed = stroke(
      spiked,
      { verb: 'smooth', settings: { radius: 3, strength: 1, falloff: 0.2 } },
      [[0, 0]],
    )

    expect(heightAt(smoothed, 0, 0)).toBeLessThan(peak)
    // Far from the spike the ground was already flat, so diffusion has nothing
    // to do — a smooth brush that dents flat ground is a broken smooth brush.
    expect(heightAt(smoothed, 7, 7)).toBeCloseTo(0, 2)
  })

  test('repeated smoothing converges instead of oscillating', () => {
    // λ = 0.25 on a 4-neighbour stencil is the stability bound. Above it the
    // filter rings; this asserts monotone decay of the peak.
    const base = field()
    let result = stroke(base, { verb: 'raise', settings: { radius: 1, strength: 1, falloff: 0 } }, [
      [0, 0],
    ])
    let previous = heightAt(result, 0, 0)
    for (let pass = 0; pass < 6; pass++) {
      result = stroke(
        result,
        { verb: 'smooth', settings: { radius: 3, strength: 1, falloff: 0.2 } },
        [[0, 0]],
      )
      const current = heightAt(result, 0, 0)
      expect(current).toBeLessThanOrEqual(previous + 1e-9)
      previous = current
    }
  })
})

describe('field bounds', () => {
  test('a stroke entirely off the field returns no patch', () => {
    const active = beginStroke({ verb: 'raise', field: field(), settings: { radius: 1 } })
    expect(advanceStroke(active, 500, 500)).toBeNull()
  })

  test('a stroke straddling the edge clips instead of throwing', () => {
    const base = field()
    // The field spans -8..8; a brush at the corner half-overhangs it.
    const result = stroke(
      base,
      { verb: 'raise', settings: { radius: 2, strength: 1, falloff: 0 } },
      [[8, 8]],
    )
    expect(heightAt(result, 8, 8)).toBeGreaterThan(0)
  })
})

describe('minBrushRadius', () => {
  /**
   * The floor exists because a dab only moves samples *inside* its radius, so a
   * brush narrower than the sample gap can land between four of them and do
   * nothing — silently: no patch, no error, no mark. These assert the floor is
   * actually above that cliff at every spacing, which matters because
   * `fieldExtentForSite` stretches spacing on large lots, so the failure appears
   * only on a big site.
   */
  const worstCaseDab = (spacing: number, radius: number) => {
    const target = createTerrainField({
      cols: 33,
      rows: 33,
      spacing,
      origin: [-16 * spacing, -16 * spacing],
    })
    // Centred between four samples — the position that misses by the most.
    const x = spacing / 2
    const z = spacing / 2
    const active = beginStroke({ verb: 'raise', field: target, settings: { radius } })
    const patch = advanceStroke(active, x, z)
    // Height, not the patch: a dab whose samples all weigh 0 still returns a
    // patch (of unchanged heights), so "did the ground move" is the only question
    // that matches what the user sees.
    const moved = patch ? heightAt(applyHeightPatch(target, patch), x, z) : 0
    return { moved, coverage: maxCoverage(active) }
  }

  // 0.5 is the default; the rest are spacings `fieldExtentForSite` produces once
  // a lot outgrows 257² samples at the default.
  const SPACINGS = [0.5, 1.18, 1.57, 3.13]

  test('a brush at the floor still bites, at every spacing', () => {
    for (const spacing of SPACINGS) {
      const { moved, coverage } = worstCaseDab(spacing, minBrushRadius({ spacing }))
      expect(moved).toBeGreaterThan(0)
      // Not merely non-zero: the dab has to land with real authority, or the
      // brush "works" only when it happens to straddle a sample.
      expect(coverage).toBeGreaterThan(0.9)
    }
  })

  test('below the floor the ground does not move at all', () => {
    // The bug this guards: the radius minimum used to be a flat 0.5 m, which at
    // stretched spacing is below this cliff — the user drags and *nothing*
    // happens. Documenting the cliff's existence is the point: if the footprint
    // math ever covers sub-spacing brushes, this failing is the signal that the
    // floor can be lowered.
    for (const spacing of SPACINGS) {
      const { moved, coverage } = worstCaseDab(spacing, minBrushRadius({ spacing }) / 3)
      expect(moved).toBe(0)
      expect(coverage).toBe(0)
    }
  })

  test('the floor scales with spacing rather than being a constant', () => {
    expect(minBrushRadius({ spacing: 2 })).toBeCloseTo(2 * minBrushRadius({ spacing: 1 }), 6)
    expect(minBrushRadius({ spacing: 1 })).toBe(MIN_BRUSH_RADIUS_IN_SPACINGS)
  })
})

describe('highestOver', () => {
  test('returns the tallest sample in the rect', () => {
    const base = field()
    const raised = stroke(
      base,
      { verb: 'raise', settings: { radius: 1.5, strength: 1, falloff: 0 } },
      [[2, 2]],
    )
    expect(highestOver(raised, 0, 0, 4, 4)).toBeCloseTo(RAISE_METRES_PER_STROKE, 2)
    // A rect away from the hill sees only the datum.
    expect(highestOver(raised, -8, -8, -6, -6)).toBeCloseTo(0, 6)
  })
})
