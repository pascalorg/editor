import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  DEFAULT_TERRAIN_SPACING,
  heightAt,
  minBrushRadius,
  type SiteNode,
  terrainFieldOf,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'
import {
  brushRadiusRange,
  clampBrushRadius,
  clipTerrainPatchToSite,
  fieldExtentForSite,
  flattenSite,
  resetSiteTerrain,
  resolveFlattenTarget,
  sculptFieldForSite,
  terrainPointInsideSite,
} from './terrain-sculpt'

// `updateNode` batches its dirty-node flush through rAF, which bun's runtime does
// not provide. Running the callback synchronously is what the other scene-writing
// unit tests do (`handle-drag-history.test.ts`).
type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

function site(points: Array<[number, number]>): SiteNode {
  return {
    id: 'site_1',
    type: 'site',
    children: [],
    polygon: { type: 'polygon', points },
  } as unknown as SiteNode
}

describe('fieldExtentForSite', () => {
  test('covers the whole polygon with padding to spare', () => {
    const extent = fieldExtentForSite(
      site([
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ]),
    )
    const maxX = extent.origin[0] + (extent.cols - 1) * extent.spacing
    const maxZ = extent.origin[1] + (extent.rows - 1) * extent.spacing

    // Strictly outside the lot on all four sides: the field must not end at the
    // property line, or the terrain mesh stops exactly where the boundary is
    // drawn and leaves a visible cliff.
    expect(extent.origin[0]).toBeLessThan(-10)
    expect(extent.origin[1]).toBeLessThan(-10)
    expect(maxX).toBeGreaterThan(10)
    expect(maxZ).toBeGreaterThan(10)
  })

  test('is square and 2ⁿ+1 so a future LOD halving lands on real samples', () => {
    for (const half of [4, 12, 30, 80]) {
      const extent = fieldExtentForSite(
        site([
          [-half, -half],
          [half, -half],
          [half, half],
          [-half, half],
        ]),
      )
      expect(extent.cols).toBe(extent.rows)
      expect([33, 65, 129, 257]).toContain(extent.cols)
    }
  })

  test('centres on the lot even when the lot is off-origin', () => {
    const extent = fieldExtentForSite(
      site([
        [100, 40],
        [120, 40],
        [120, 60],
        [100, 60],
      ]),
    )
    const centerX = extent.origin[0] + ((extent.cols - 1) / 2) * extent.spacing
    const centerZ = extent.origin[1] + ((extent.rows - 1) / 2) * extent.spacing
    expect(centerX).toBeCloseTo(110, 6)
    expect(centerZ).toBeCloseTo(50, 6)
  })

  test('holds the default spacing while the lot fits in 257 samples', () => {
    const extent = fieldExtentForSite(
      site([
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ]),
    )
    expect(extent.spacing).toBeCloseTo(DEFAULT_TERRAIN_SPACING, 6)
  })

  test('stretches spacing rather than stopping short on a huge lot', () => {
    // A 400 m lot needs 801 samples at 0.5 m. Capping the sample count and
    // coarsening is the right trade: coarse ground everywhere beats fine ground
    // that ends mid-lot.
    const extent = fieldExtentForSite(
      site([
        [-200, -200],
        [200, -200],
        [200, 200],
        [-200, 200],
      ]),
    )
    expect(extent.cols).toBe(257)
    expect(extent.spacing).toBeGreaterThan(DEFAULT_TERRAIN_SPACING)
    const maxX = extent.origin[0] + (extent.cols - 1) * extent.spacing
    expect(maxX).toBeGreaterThan(200)
  })

  test('a degenerate polygon still yields a usable field', () => {
    for (const points of [[], [[0, 0]] as Array<[number, number]>]) {
      const extent = fieldExtentForSite(site(points as Array<[number, number]>))
      expect(extent.cols).toBe(65)
      expect(extent.spacing).toBeCloseTo(DEFAULT_TERRAIN_SPACING, 6)
    }
  })

  test('a null site does not throw', () => {
    expect(fieldExtentForSite(null).cols).toBe(65)
    expect(fieldExtentForSite(undefined).cols).toBe(65)
  })
})

describe('sculptFieldForSite', () => {
  test('a virgin site gets a fresh flat field sized to its lot', () => {
    const target = site([
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ])
    const field = sculptFieldForSite(target)
    expect(field.cols).toBe(fieldExtentForSite(target).cols)
    expect(heightAt(field, 0, 0)).toBeCloseTo(0, 6)
  })
})

describe('site footprint', () => {
  const concaveSite = site([
    [0, 0],
    [4, 0],
    [4, 2],
    [2, 2],
    [2, 4],
    [0, 4],
  ])

  test('includes the boundary but excludes the padded field and concave notch', () => {
    expect(terrainPointInsideSite(concaveSite, 0, 2)).toBe(true)
    expect(terrainPointInsideSite(concaveSite, 1, 3)).toBe(true)
    expect(terrainPointInsideSite(concaveSite, 3, 3)).toBe(false)
    expect(terrainPointInsideSite(concaveSite, -1, 2)).toBe(false)
  })

  test('a brush patch preserves samples outside the property polygon', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1, origin: [0, 0] })
    const heights = new Int16Array(25)
    heights.fill(100)
    const clipped = clipTerrainPatchToSite(
      field,
      { col0: 0, row0: 0, cols: 5, rows: 5, heights },
      concaveSite,
    )

    expect(clipped.heights[1 * 5 + 1]).toBe(100)
    expect(clipped.heights[3 * 5 + 3]).toBe(0)
    expect(clipped.heights[2 * 5 + 0]).toBe(100)
    expect(clipped.heights[2 * 5 + 4]).toBe(100)
  })
})

describe('brushRadiusRange', () => {
  const hugeLot = site([
    [-200, -200],
    [200, -200],
    [200, 200],
    [-200, 200],
  ])
  const smallLot = site([
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ])

  test('the low end is the field floor, not a constant', () => {
    // The bug: both the slider and the `[`/`]` keys hardcoded 0.5 m. On a lot big
    // enough that `fieldExtentForSite` stretches spacing, 0.5 m is under the
    // sample gap and the brush silently paints nothing. The floor has to move
    // with the lot.
    const [smallMin] = brushRadiusRange(smallLot)
    const [hugeMin] = brushRadiusRange(hugeLot)
    expect(smallMin).toBeCloseTo(minBrushRadius({ spacing: DEFAULT_TERRAIN_SPACING }), 6)
    expect(hugeMin).toBeGreaterThan(smallMin)
    expect(hugeMin).toBeCloseTo(minBrushRadius(sculptFieldForSite(hugeLot)), 6)
  })

  test('reads the spacing of terrain that already exists', () => {
    // A lot whose field was created earlier (or imported from a DEM at its own
    // resolution) must be measured by *that* field, not by what a fresh one
    // would get — otherwise the floor is wrong for exactly the sites that have
    // been sculpted.
    const existing = { ...smallLot, terrain: { spacing: 4 } } as unknown as SiteNode
    const [min] = brushRadiusRange(existing)
    expect(min).toBeCloseTo(minBrushRadius({ spacing: 4 }), 6)
  })

  test('a site with no lot yet still yields a usable range', () => {
    for (const target of [null, undefined]) {
      const [min, max] = brushRadiusRange(target)
      expect(min).toBeGreaterThan(0)
      expect(max).toBeGreaterThan(min)
    }
  })

  test('the range never inverts', () => {
    // Reachable: a lot coarse enough that the floor passes MAX_BRUSH_RADIUS would
    // otherwise give min > max, and a slider whose min exceeds its max clamps
    // every value to a different number depending on which bound is applied last.
    for (const spacing of [0.5, 4, 20, 100]) {
      const target = { ...smallLot, terrain: { spacing } } as unknown as SiteNode
      const [min, max] = brushRadiusRange(target)
      expect(max).toBeGreaterThanOrEqual(min)
      expect(clampBrushRadius(target, 1)).toBeGreaterThanOrEqual(min)
      expect(clampBrushRadius(target, 1e6)).toBeLessThanOrEqual(max)
    }
  })
})

describe('clampBrushRadius', () => {
  const lot = site([
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ])

  test('holds a radius already in range untouched', () => {
    expect(clampBrushRadius(lot, 5)).toBe(5)
  })

  test('the `[`/`]` ladder stays inside the range and reverses', () => {
    // The keys step multiplicatively (×1.25) and quantize to decimetres, which is
    // where a ratchet would hide: if `]` then `[` did not return, the pair would
    // walk the radius away from where the user left it. Only the clamp at the top
    // is allowed to be one-way.
    const step = (radius: number, up: boolean) =>
      clampBrushRadius(lot, Math.round(radius * (up ? 1.25 : 1 / 1.25) * 10) / 10)
    const [min, max] = brushRadiusRange(lot)

    let radius = min
    const visited: number[] = []
    for (let i = 0; i < 40 && radius < max; i++) {
      const next = step(radius, true)
      if (next === radius) break
      visited.push(next)
      radius = next
    }
    // The ladder has to actually traverse the range, or `]` is a dead key
    // somewhere in the middle.
    expect(visited.at(-1)).toBe(max)
    expect(visited.length).toBeGreaterThan(8)

    for (const value of visited) {
      expect(value).toBeGreaterThanOrEqual(min)
      expect(value).toBeLessThanOrEqual(max)
      // Below the top, up-then-down returns. At the ceiling it cannot: one step
      // down from the max is a genuine 20% reduction, which is correct.
      if (step(value, true) !== max) expect(step(step(value, true), false)).toBe(value)
    }
  })
})

describe('resolveFlattenTarget', () => {
  test('an explicit target wins over the ground under the cursor', () => {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 0.5, origin: [-8, -8] })
    expect(resolveFlattenTarget(field, 3.25, 0, 0)).toBeCloseTo(3.25, 6)
  })

  test('with no explicit target the first click samples the ground', () => {
    // This is what makes flatten usable without ever opening a number field.
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 0.5, origin: [-8, -8] })
    const raised = { ...field, heights: field.heights.slice() }
    // Sample [16,16] is world (0,0) — put it at 1.5 m.
    raised.heights[16 * 33 + 16] = Math.round(1.5 / raised.step)
    expect(resolveFlattenTarget(raised, null, 0, 0)).toBeCloseTo(1.5, 6)
  })

  test('an explicit target of 0 is honoured, not treated as absent', () => {
    // `?? ` rather than `||` — flatten-to-datum is the single most common
    // explicit target, and `||` would silently resample instead.
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 0.5, origin: [-8, -8] })
    const raised = { ...field, heights: field.heights.slice() }
    raised.heights[16 * 33 + 16] = Math.round(2 / raised.step)
    expect(resolveFlattenTarget(raised, 0, 0, 0)).toBe(0)
  })
})

/**
 * What Escape mid-stroke actually promises.
 *
 * The tool's `tool:cancel` handler ends the live stroke *without* calling
 * `commitStroke`, which is the whole mechanism: the live stroke is what every reader
 * prefers over the persisted terrain, so dropping it un-committed reverts the scene
 * by construction. The half worth asserting is that it reverts to the *right* place —
 * a site sculpted before the abandoned stroke must keep that earlier work — and that
 * the abandon leaves no live stroke behind for the next reader to pick up.
 */
describe('abandoning a stroke — the Escape contract', () => {
  const siteId = 'site_cancel' as SiteNode['id']

  function fieldAt(metres: number): ReturnType<typeof createTerrainField> {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 0.5, origin: [-8, -8] })
    const heights = field.heights.slice()
    heights.fill(Math.round(metres / field.step))
    return { ...field, heights }
  }

  test('ends the live stroke and commits nothing', () => {
    const committed = fieldAt(1.5)
    useLiveTerrain.getState().begin(siteId, committed)
    useLiveTerrain.getState().advance(siteId, fieldAt(9), null as never)
    expect(useLiveTerrain.getState().fieldOf(siteId)).toBeDefined()

    // Exactly what the tool's `onCancel` does: end, no `commitStroke`.
    useLiveTerrain.getState().end(siteId)

    // No stroke left armed — a leaked one shows ground the scene graph never had.
    expect(useLiveTerrain.getState().strokes.has(siteId)).toBe(false)
    expect(useLiveTerrain.getState().fieldOf(siteId)).toBeUndefined()
  })

  test('the snapshot taken at begin is never mutated by the dabs it survives', () => {
    // The anti-compounding invariant, from the cancel side: if a dab could write
    // through to the snapshot, Escape would revert to a *partially* sculpted field
    // rather than the baseline, and the user's earlier work would drift every stroke.
    const committed = fieldAt(1.5)
    const baseline = Array.from(committed.heights)
    useLiveTerrain.getState().begin(siteId, committed)
    useLiveTerrain.getState().advance(siteId, fieldAt(9), null as never)
    useLiveTerrain.getState().end(siteId)
    expect(Array.from(committed.heights)).toEqual(baseline)
  })
})

/**
 * The lot-wide writes have to win over a stroke in flight.
 *
 * Both replace the entire field, and every reader prefers the live stroke over the
 * persisted terrain — so landing one *under* a stroke is invisible twice over: the
 * ground keeps showing the stroke, and the stroke's commit (computed from a snapshot
 * predating the write) then overwrites it. A button that silently does nothing.
 *
 * Not a hypothetical race. On touch one finger holds a stroke while the other taps
 * the panel; with a mouse a stroke survives a wheel zoom's 500 ms `cameraDragging`
 * window and a held pointer that has left the canvas.
 */
describe('lot-wide terrain writes vs a stroke in flight', () => {
  const lotSiteId = 'site_lotwide' as SiteNode['id']

  function siteNodeWithTerrain(terrain: SiteNode['terrain']): SiteNode {
    return {
      id: lotSiteId,
      type: 'site',
      children: [],
      polygon: {
        type: 'polygon',
        points: [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
      },
      terrain,
    } as unknown as SiteNode
  }

  beforeEach(() => {
    useLiveTerrain.getState().endAll()
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  test('levelling the lot drops the stroke instead of hiding behind it', () => {
    const site = siteNodeWithTerrain(undefined)
    useScene.setState({ nodes: { [lotSiteId]: site }, rootNodeIds: [lotSiteId] } as never)
    useLiveTerrain.getState().begin(lotSiteId, sculptFieldForSite(site))

    flattenSite(site, 3)

    // The assertion that fails without the abandon: with a stroke still live,
    // `terrainFieldOf` — and so the mesh, the raycast and the next stroke's
    // snapshot — would keep reading the pre-flatten ground.
    expect(useLiveTerrain.getState().fieldOf(lotSiteId)).toBeUndefined()
    const written = useScene.getState().nodes[lotSiteId] as SiteNode
    expect(heightAt(terrainFieldOf(written) as never, 0, 0)).toBeCloseTo(3, 6)
  })

  test('clearing terrain drops the stroke even when there is nothing to clear', () => {
    // The early-return path: a first-ever stroke on a virgin site leaves
    // `site.terrain` undefined, so `resetSiteTerrain` returns before writing —
    // and a live stroke surviving that shows ground the scene graph has none of.
    const site = siteNodeWithTerrain(undefined)
    useScene.setState({ nodes: { [lotSiteId]: site }, rootNodeIds: [lotSiteId] } as never)
    useLiveTerrain.getState().begin(lotSiteId, sculptFieldForSite(site))

    resetSiteTerrain(site)

    expect(useLiveTerrain.getState().fieldOf(lotSiteId)).toBeUndefined()
    expect(terrainFieldOf(useScene.getState().nodes[lotSiteId] as SiteNode)).toBeNull()
  })
})
