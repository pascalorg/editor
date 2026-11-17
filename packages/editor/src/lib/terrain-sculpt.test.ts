import { beforeEach, describe, expect, test } from 'bun:test'
import {
  advanceStroke,
  applyHeightPatch,
  beginStroke,
  commitTerrainField,
  createTerrainField,
  DEFAULT_TERRAIN_SPACING,
  heightAt,
  minBrushRadius,
  persistedTerrainFieldOf,
  type SiteNode,
  terrainFieldOf,
  tileFieldOf,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'
import {
  brushRadiusRange,
  clampBrushRadius,
  clipTerrainPatchToSite,
  commitLiveStroke,
  commitStroke,
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

describe('sculptFieldForSite', () => {
  test('an oversized lot is refused before allocating a dense sculpt field', () => {
    const target = site([
      [0, 0],
      [10_000, 0],
      [10_000, 10_000],
      [0, 10_000],
    ])
    const NativeInt16Array = globalThis.Int16Array
    let largestAllocation = 0
    // Fail safely if the regression tries to allocate roughly 400 million samples.
    // The sentinel is deliberately not a RangeError: it cannot satisfy the refusal.
    globalThis.Int16Array = new Proxy(NativeInt16Array, {
      construct(target, args, newTarget) {
        if (typeof args[0] === 'number') {
          largestAllocation = Math.max(largestAllocation, args[0])
          if (args[0] > 1_000_000) throw new Error('Oversized terrain allocation reached')
        }
        return Reflect.construct(target, args, newTarget)
      },
    })
    try {
      expect(() => sculptFieldForSite(target, {})).toThrow(RangeError)
      expect(largestAllocation).toBeLessThanOrEqual(1_000_000)
    } finally {
      globalThis.Int16Array = NativeInt16Array
    }
  })

  test('a virgin site gets a fresh flat field sized to its lot', () => {
    const target = site([
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ])
    const field = sculptFieldForSite(target)
    expect(field.spacing).toBe(0.5)
    expect(field.origin[0]).toBeLessThanOrEqual(-10)
    expect(field.origin[0] + (field.cols - 1) * field.spacing).toBeGreaterThanOrEqual(10)
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

  test('the minimum follows the half-metre write lattice even on a large lot', () => {
    const [smallMin] = brushRadiusRange(smallLot)
    const [hugeMin] = brushRadiusRange(hugeLot)
    expect(smallMin).toBeCloseTo(minBrushRadius({ spacing: DEFAULT_TERRAIN_SPACING }), 6)
    expect(hugeMin).toBe(smallMin)
    expect(hugeMin).toBeCloseTo(minBrushRadius(sculptFieldForSite(hugeLot)), 6)
  })

  test('a coarse imported base does not coarsen the tile write lattice', () => {
    const existing = { ...smallLot, terrain: { spacing: 4 } } as unknown as SiteNode
    const [min] = brushRadiusRange(existing)
    expect(min).toBeCloseTo(minBrushRadius({ spacing: 0.5 }), 6)
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
    expect(heightAt(terrainFieldOf(written, useScene.getState().nodes) as never, 0, 0)).toBeCloseTo(
      3,
      6,
    )
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

/**
 * Pointer-up after an external terrain write.
 *
 * The sculpt tool holds the in-flight field in a ref and commits it on
 * pointer-up. A tool write landing mid-stroke ends the live stroke and
 * persists its own field — but that alone does not stop the ref: without a
 * staleness check, pointer-up commits the pre-write snapshot over the tool's
 * write, and the scene gains a second undo step that restores the old ground.
 * `commitLiveStroke` is the pointer-up path; these tests replay the exact
 * sequence: begin → dab → external end + write → pointer-up.
 */
describe('pointer-up after an external terrain write', () => {
  const siteId = 'site_pointer_up' as SiteNode['id']

  function fieldAt(metres: number): ReturnType<typeof createTerrainField> {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 0.5, origin: [-8, -8] })
    const heights = field.heights.slice()
    heights.fill(Math.round(metres / field.step))
    return { ...field, heights }
  }

  function persistedHeightAtCentre(): number {
    const written = useScene.getState().nodes[siteId] as SiteNode
    // The persisted field specifically: `terrainFieldOf` would prefer a live
    // stroke, which is the very confusion under test.
    return heightAt(persistedTerrainFieldOf(written, useScene.getState().nodes) as never, 0, 0)
  }

  beforeEach(() => {
    useLiveTerrain.getState().endAll()
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    const siteNode = {
      id: siteId,
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
      terrain: commitTerrainField(fieldAt(1)),
    } as unknown as SiteNode
    useScene.setState({ nodes: { [siteId]: siteNode }, rootNodeIds: [siteId] } as never)
  })

  test('a stroke ended by a tool write cannot commit over it on pointer-up', () => {
    // The stroke holds ground sculpted to 4 m over the persisted 1 m.
    const strokeId = useLiveTerrain.getState().begin(siteId, fieldAt(1))
    const strokeField = fieldAt(4)
    useLiveTerrain.getState().advance(siteId, strokeField, null as never)

    // The tool write: end the live stroke, persist 2 m in one undo step.
    useLiveTerrain.getState().end(siteId)
    commitStroke(siteId, fieldAt(2))
    const stepsAfterWrite = useScene.temporal.getState().pastStates.length

    // Pointer-up with the stale stroke in hand.
    expect(commitLiveStroke(siteId, strokeId, strokeField)).toBe(false)
    expect(persistedHeightAtCentre()).toBeCloseTo(2, 6)
    expect(useScene.temporal.getState().pastStates.length).toBe(stepsAfterWrite)
  })

  test('a stroke still live at pointer-up commits as one undo step', () => {
    const strokeId = useLiveTerrain.getState().begin(siteId, fieldAt(1))
    const strokeField = fieldAt(4)
    useLiveTerrain.getState().advance(siteId, strokeField, null as never)

    const stepsBefore = useScene.temporal.getState().pastStates.length
    expect(commitLiveStroke(siteId, strokeId, strokeField)).toBe(true)
    expect(persistedHeightAtCentre()).toBeCloseTo(4, 6)
    expect(useLiveTerrain.getState().fieldOf(siteId)).toBeUndefined()
    expect(useScene.temporal.getState().pastStates.length).toBe(stepsBefore + 1)
  })

  test('a superseding stroke invalidates the earlier stroke id', () => {
    const firstId = useLiveTerrain.getState().begin(siteId, fieldAt(1))
    useLiveTerrain.getState().begin(siteId, fieldAt(2))
    expect(commitLiveStroke(siteId, firstId, fieldAt(4))).toBe(false)
    expect(persistedHeightAtCentre()).toBeCloseTo(1, 6)
  })
})

describe('a tiled brush gesture', () => {
  function offLatticeSlopingSite(): SiteNode {
    const target = site([
      [1, 1],
      [63, 1],
      [63, 63],
      [1, 63],
    ])
    const legacy = createTerrainField({
      cols: 69,
      rows: 69,
      spacing: 0.95,
      origin: [0.13, 0.27],
    })
    // y = .996 + .2x + .4z; the legacy samples lie exactly on centimetres.
    for (let row = 0; row < legacy.rows; row++)
      for (let col = 0; col < legacy.cols; col++)
        legacy.heights[row * legacy.cols + col] = 113 + 19 * col + 38 * row
    target.terrain = commitTerrainField(legacy)
    return target
  }

  test('raises an off-origin .95 m legacy slope through one local overlay', () => {
    const original = useScene.getState()
    const target = offLatticeSlopingSite()
    const initialNodes = { [target.id]: target }
    const frozen = JSON.stringify(target.terrain)
    const before = persistedTerrainFieldOf(target, initialNodes)
    if (!before) throw new Error('Missing legacy slope')
    try {
      useScene.setState({ nodes: initialNodes, rootNodeIds: [target.id] } as never)
      useScene.temporal.getState().clear()
      useScene.temporal.getState().resume()
      const snapshot = sculptFieldForSite(target, initialNodes)
      const strokeId = useLiveTerrain.getState().begin(target.id, snapshot)
      const stroke = beginStroke({
        field: snapshot,
        verb: 'raise',
        settings: { radius: 1, falloff: 0, strength: 1 },
      })
      const patch = advanceStroke(stroke, 8, 8)
      if (!patch) throw new Error('The brush must raise ground at its centre')
      const clipped = clipTerrainPatchToSite(snapshot, patch, target)
      const next = applyHeightPatch(snapshot, clipped)
      useLiveTerrain.getState().advance(target.id, next, clipped)
      expect(commitLiveStroke(target.id, strokeId, next)).toBe(true)
      const nodes = useScene.getState().nodes
      const written = nodes[target.id] as SiteNode
      const after = persistedTerrainFieldOf(written, nodes)
      if (!after) throw new Error('Missing brush overlay')
      const tiles = Object.values(nodes).filter((node) => node.type === 'terrain-tile')
      expect(tiles).toHaveLength(1)
      expect(tiles[0]).toMatchObject({ parentId: target.id, ix: 0, iz: 0 })
      // The original 5.796 m rounds to 5.80 m, then a full-strength dab adds 1 m.
      expect(heightAt(before, 8, 8)).toBeCloseTo(5.796, 10)
      expect(heightAt(after, 8, 8)).toBeCloseTo(6.8, 10)
      for (const [x, z] of [
        [4.13, 4.27],
        [16.25, 12.75],
        [30.4, 30.1],
      ] as const)
        expect(Math.abs(heightAt(after, x, z) - heightAt(before, x, z))).toBeLessThanOrEqual(0.01)
      expect(heightAt(after, 48.13, 48.27)).toBe(heightAt(before, 48.13, 48.27))
      expect(JSON.stringify(written.terrain)).toBe(frozen)
      expect(useLiveTerrain.getState().fieldOf(target.id)).toBeUndefined()
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(initialNodes)
    } finally {
      useLiveTerrain.getState().end(target.id)
      useScene.setState(original)
      useScene.temporal.getState().clear()
    }
  })

  test('crosses a shared edge without a step, freezes legacy data and undoes as one gesture', () => {
    const original = useScene.getState()
    const target = site([
      [0, 0],
      [64, 0],
      [64, 32],
      [0, 32],
    ])
    const base = createTerrainField({ cols: 129, rows: 65, spacing: 0.5 })
    base.heights.fill(100)
    target.terrain = commitTerrainField(base)
    const frozen = JSON.stringify(target.terrain)
    try {
      useScene.setState({ nodes: { [target.id]: target }, rootNodeIds: [target.id] } as never)
      useScene.temporal.getState().clear()
      useScene.temporal.getState().resume()
      const initialNodes = structuredClone(useScene.getState().nodes)
      const strokeId = useLiveTerrain.getState().begin(target.id, base)
      // Full strength adds one metre per gesture, independent of dab count.
      const stroke = beginStroke({
        field: base,
        verb: 'raise',
        settings: { radius: 2, falloff: 0, strength: 1 },
      })
      let next = base
      for (const x of [31, 32, 33]) {
        const patch = advanceStroke(stroke, x, 16)
        if (patch) {
          next = applyHeightPatch(next, patch)
          useLiveTerrain.getState().advance(target.id, next, patch)
        }
      }
      expect(commitLiveStroke(target.id, strokeId, next)).toBe(true)
      const nodes = useScene.getState().nodes
      expect(JSON.stringify((nodes[target.id] as SiteNode).terrain)).toBe(frozen)
      const tiles = Object.values(nodes).filter((node) => node.type === 'terrain-tile')
      const left = tiles.find((node) => node.ix === 0 && node.iz === 0)
      const right = tiles.find((node) => node.ix === 1 && node.iz === 0)
      if (!left || !right) throw new Error('The seam stroke must persist both tiles')
      const a = tileFieldOf(left)
      const b = tileFieldOf(right)
      if (!a || !b) throw new Error('Persisted tiles did not decode')
      for (let row = 0; row < 65; row++) expect(a.heights[row * 65 + 64]).toBe(b.heights[row * 65])
      const field = persistedTerrainFieldOf(nodes[target.id] as SiteNode, nodes)
      if (!field) throw new Error('Missing committed terrain')
      for (const x of [31.5, 32, 32.5]) expect(heightAt(field, x, 16)).toBe(2)
      expect(heightAt(field, 32, 10)).toBe(1)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(initialNodes)
      useScene.temporal.getState().redo()
      expect(useScene.getState().nodes).toEqual(nodes)
    } finally {
      useLiveTerrain.getState().end(target.id)
      useScene.setState(original)
      useScene.temporal.getState().clear()
    }
  })
})
