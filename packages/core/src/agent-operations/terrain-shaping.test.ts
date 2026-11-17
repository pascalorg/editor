import { describe, expect, test } from 'bun:test'
import {
  clearSceneHistory,
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
  type TerrainField,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'
import {
  AGENT_OPERATIONS,
  applySceneChanges,
  carveTerrainPad,
  describeTerrainUnderHouse,
  shapeSiteTerrain,
  UNGUARDED_DROP_THRESHOLD_M,
} from '@pascal-app/core/agent-operations'
import {
  AGENT_TOOL_CONTRACTS,
  carveTerrainPadTool,
  describeTerrainUnderHouseTool,
  isAgentRefusal,
  shapeSiteTerrainTool,
} from '@pascal-app/core/agent-tools'
import { type AnyNode, BuildingNode, LevelNode, SiteNode, SlabNode } from '@pascal-app/core/schema'
import type { AgentOperationOutcome } from './types'

type Nodes = Record<string, AnyNode>
const context = { activeLevelId: null }
const MAX_OPERATION_BYTES = 64 * 1024
/** The pad used across the ramp tests: samples at cols/rows 2..4 of the 9×9 field. */
const PAD: [number, number][] = [
  [2, 2],
  [4, 2],
  [4, 4],
  [2, 4],
]

/** y = x − 3 on a 9 × 9 field at 1 m spacing; the lot is [1,1]–[7,7]. */
function rampField(): TerrainField {
  const field = createTerrainField({ cols: 9, rows: 9, spacing: 1, step: 0.01 })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++)
      field.heights[row * field.cols + col] = (col - 3) * 100
  return field
}

function rampScene(field: TerrainField = rampField()): Nodes {
  const site = SiteNode.parse({
    id: 'site_terrain',
    polygon: {
      type: 'polygon',
      points: [
        [1, 1],
        [7, 1],
        [7, 7],
        [1, 7],
      ],
    },
    terrain: encodeTerrainField(field),
  })
  return { [site.id]: site }
}

function refusalCode(call: () => unknown): string | null {
  try {
    call()
  } catch (error) {
    return isAgentRefusal(error) ? error.code : `threw: ${String(error)}`
  }
  return null
}

function applied(nodes: Nodes, outcome: AgentOperationOutcome): Nodes {
  return outcome.changes ? (applySceneChanges(nodes, outcome.changes) as Nodes) : nodes
}

function fieldOf(nodes: Nodes): TerrainField {
  const site = nodes.site_terrain as SiteNode
  const field = persistedTerrainFieldOf(site, nodes)
  if (!field) throw new Error('expected a persisted field after the write')
  return field
}

const sampleAt = (field: TerrainField, x: number, z: number) =>
  Math.round(heightAt(field, x, z) / field.step)

describe('terrain shaping contracts', () => {
  for (const operation of ['shape', 'pad'] as const)
    test(`${operation} overlays arbitrary legacy grids without rewriting their bytes`, () => {
      for (const grid of [
        { spacing: 1, origin: [0, 0] as [number, number] },
        { spacing: 0.5, origin: [0.1, 0.1] as [number, number] },
        { spacing: 0.95, origin: [0.13, 0.27] as [number, number] },
      ]) {
        const legacy = createTerrainField({ cols: 69, rows: 69, ...grid })
        for (let row = 0; row < legacy.rows; row++)
          for (let col = 0; col < legacy.cols; col++)
            legacy.heights[row * legacy.cols + col] = 113 + 19 * col + 38 * row
        const nodes = rampScene(legacy)
        const frozen = JSON.stringify(nodes)
        const before = fieldOf(nodes)
        const outcome =
          operation === 'shape'
            ? shapeSiteTerrain(nodes, { verb: 'flatten', area: PAD, heightM: 0.25 }, context)
            : carveTerrainPad(nodes, { pad: PAD, padHeightM: 0.25, blendM: 1 }, context)
        const after = applied(nodes, outcome)
        const field = fieldOf(after)
        for (let z = 2; z <= 4; z += 0.5)
          for (let x = 2; x <= 4; x += 0.5) expect(heightAt(field, x, z)).toBe(0.25)
        const tiles = Object.values(after).filter((node) => node.type === 'terrain-tile')
        expect(tiles).toHaveLength(1)
        expect(tiles[0]).toMatchObject({ parentId: 'site_terrain', ix: 0, iz: 0 })
        for (const [x, z] of [
          [6.25, 5.75],
          [20.13, 20.27],
        ] as const)
          expect(Math.abs(heightAt(field, x, z) - heightAt(before, x, z))).toBeLessThanOrEqual(0.01)
        expect(heightAt(field, 32.75, 8.25)).toBe(heightAt(before, 32.75, 8.25))
        expect(JSON.stringify((after.site_terrain as SiteNode).terrain)).toBe(
          JSON.stringify((nodes.site_terrain as SiteNode).terrain),
        )
        expect(JSON.stringify(nodes)).toBe(frozen)
      }
    })

  test('exports one contract and operation per new tool', () => {
    const contracts = AGENT_TOOL_CONTRACTS.map((tool) => tool.name)
    expect(contracts).toContain('shape_site_terrain')
    expect(contracts).toContain('carve_terrain_pad')
    expect(contracts).toContain('describe_terrain_under_house')
    expect(AGENT_OPERATIONS.shape_site_terrain).toBe(shapeSiteTerrain)
    expect(AGENT_OPERATIONS.carve_terrain_pad).toBe(carveTerrainPad)
    expect(AGENT_OPERATIONS.describe_terrain_under_house).toBe(describeTerrainUnderHouse)
    expect(describeTerrainUnderHouseTool.annotations?.readOnlyHint).toBe(true)
    expect(shapeSiteTerrainTool.name).toBe('shape_site_terrain')
    expect(carveTerrainPadTool.name).toBe('carve_terrain_pad')
  })

  test('the guard advisory reuses the verify_scene unguarded_drop threshold', () => {
    expect(UNGUARDED_DROP_THRESHOLD_M).toBe(0.5)
  })
})

describe('carve_terrain_pad', () => {
  test('a context pad leaves the legacy bytes alone and excludes outside-lot soil from cut/fill facts', () => {
    const nodes = rampScene()
    const outside: [number, number][] = [
      [40, 2],
      [42, 2],
      [42, 4],
      [40, 4],
    ]
    expect(
      refusalCode(() => carveTerrainPad(nodes, { pad: outside, padHeightM: 2 }, context)),
    ).toBe('outside_property')
    const outcome = carveTerrainPad(
      nodes,
      { pad: outside, padHeightM: 2, scope: 'context' },
      context,
    )
    const after = applied(nodes, outcome)
    expect(heightAt(fieldOf(after), 41, 3)).toBe(2)
    expect(outcome.result.cutVolumeM3).toBe(0)
    expect(outcome.result.fillVolumeM3).toBe(0)
    expect(outcome.result.netM3).toBe(0)
    expect((after.site_terrain as SiteNode).terrain).toEqual(
      (nodes.site_terrain as SiteNode).terrain,
    )
  })

  test('pad samples equal the target height exactly, in quantized units', () => {
    const nodes = rampScene()
    const outcome = carveTerrainPad(nodes, { pad: PAD, padHeightM: 0, blendM: 2 }, context)
    const field = fieldOf(applied(nodes, outcome))
    for (let row = 2; row <= 4; row++)
      for (let col = 2; col <= 4; col++) expect(sampleAt(field, col, row)).toBe(0)
    expect(outcome.result.padHeightM).toBe(0)
    expect(outcome.result.padAreaM2).toBe(4)
  })

  // The pad is an exact soil face, so its volumes are the plan-area integral of the ground against
  // the pad height: the ground is y = x − 3, the pad [2,4]² at 0, so each of the two halves of
  // the pad holds ∫₃⁴ (x − 3) dx × 2 m = 1 m³ of cut, and 1 m³ of fill.
  test('cut, fill and net match the hand-computed ramp and cut − fill = net', () => {
    const outcome = carveTerrainPad(rampScene(), { pad: PAD, padHeightM: 0, blendM: 0 }, context)
    const { cutVolumeM3, fillVolumeM3, netM3 } = outcome.result as {
      cutVolumeM3: number
      fillVolumeM3: number
      netM3: number
    }
    expect(cutVolumeM3).toBeCloseTo(1, 6)
    expect(fillVolumeM3).toBeCloseTo(1, 6)
    expect(netM3).toBeCloseTo(cutVolumeM3 - fillVolumeM3, 6)
    expect(netM3).toBeCloseTo(0, 6)
    expect(outcome.result.sampling).toMatchObject({
      approximate: true,
      method: 'midpoint_plan_area_integral',
    })
  })

  test('blend-ring cut volume includes axial and diagonal half-metre samples', () => {
    const flat = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    flat.heights.fill(100)
    const outcome = carveTerrainPad(
      rampScene(flat),
      { pad: PAD, padHeightM: 0, blendM: 1 },
      context,
    )
    // 25 pad samples cut 1 m, 20 axial samples cut .5 m, four diagonals
    // cut .29 m after centimetre quantization. Each sample represents .25 m².
    expect(outcome.result.cutVolumeM3).toBeCloseTo(9.04, 6)
    expect(outcome.result.fillVolumeM3).toBe(0)
    expect(outcome.result.netM3).toBeCloseTo(9.04, 6)
  })

  test('the blend is monotone along a row and never overshoots pad or original height', () => {
    const nodes = rampScene()
    const before = fieldOf(nodes)
    const after = fieldOf(
      applied(nodes, carveTerrainPad(nodes, { pad: PAD, padHeightM: 0, blendM: 2 }, context)),
    )
    const row = Array.from({ length: 9 }, (_, col) => sampleAt(after, col, 3))
    expect(row).toEqual([...row].sort((a, b) => a - b))
    for (let z = 0; z <= 8; z += 0.5) {
      for (let x = 0; x <= 8; x += 0.5) {
        const original = sampleAt(before, x, z)
        const next = sampleAt(after, x, z)
        expect(next).toBeLessThanOrEqual(Math.max(original, 0))
        expect(next).toBeGreaterThanOrEqual(Math.min(original, 0))
      }
    }
    // Beyond the blend ring the ground is untouched.
    expect(sampleAt(after, 0, 3)).toBe(sampleAt(before, 0, 3))
    expect(sampleAt(after, 8, 3)).toBe(sampleAt(before, 8, 3))
  })

  test('the blend ring never raises ground outside the pad', () => {
    // Flat 1 m ground with one dip at (5,3), just outside the pad's east edge.
    // Blending that sample toward the 0 m pad height would raise it to −1 m —
    // a cubic metre of fill outside a pad that only cuts. The ring may only
    // cut: outside the pad, ground never ends up higher than it started.
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1, step: 0.01 })
    field.heights.fill(100)
    field.heights[3 * 9 + 5] = -200
    const nodes = rampScene(field)
    const outcome = carveTerrainPad(nodes, { pad: PAD, padHeightM: 0, blendM: 2 }, context)
    const after = fieldOf(applied(nodes, outcome))
    expect(sampleAt(after, 5, 3)).toBe(-200)
    for (let row = 0; row < 9; row++)
      for (let col = 0; col < 9; col++) {
        const inPad = col >= 2 && col <= 4 && row >= 2 && row <= 4
        if (!inPad) expect(sampleAt(after, col, row)).toBeLessThanOrEqual(sampleAt(field, col, row))
      }
    expect(outcome.result.fillVolumeM3).toBe(0)
    expect(outcome.result.netM3).toBe(outcome.result.cutVolumeM3)
  })

  test('retaining height is the original ground above the pad at each edge', () => {
    const outcome = carveTerrainPad(rampScene(), { pad: PAD, padHeightM: 0, blendM: 2 }, context)
    const heights = (outcome.result.retainingHeightM as { heightM: number }[]).map(
      (edge) => edge.heightM,
    )
    // The ramp is 1 m above the pad at x=4 and 1 m below it at x=2.
    expect(heights).toEqual([1, 1, 1, 0])
    const slope = outcome.result.maxSlopeIntoPadDeg as number
    // At x=5.5, the half-metre central difference spans y=1 to y=3:
    // a roughly 2:1 grade (63.4°), steeper than the original 45° hill.
    expect(slope).toBeGreaterThan(60)
    expect(slope).toBeLessThan(65)
  })

  test('padFromHighestM cuts below the highest ground under the pad', () => {
    const nodes = rampScene()
    const outcome = carveTerrainPad(nodes, { pad: PAD, padFromHighestM: 1.2 }, context)
    // Highest sample under the pad is 1 m (col 4); 1 − 1.2 = −0.2 m = −20 units.
    expect(outcome.result.padHeightM).toBeCloseTo(-0.2, 6)
    const field = fieldOf(applied(nodes, outcome))
    expect(sampleAt(field, 3, 3)).toBe(-20)
  })

  test('a pad reaching outside the property is refused', () => {
    const outside: [number, number][] = [
      [6, 2],
      [8, 2],
      [8, 4],
      [6, 4],
    ]
    expect(
      refusalCode(() => carveTerrainPad(rampScene(), { pad: outside, padHeightM: 0 }, context)),
    ).toBe('outside_property')
  })

  test('a pad sharing the property line is inside the property', () => {
    const nodes = rampScene()
    // Shares the lot's left and bottom edges ([1,1]–[7,7]) in part.
    const outcome = carveTerrainPad(
      nodes,
      {
        pad: [
          [1, 1],
          [4, 1],
          [4, 4],
          [1, 4],
        ],
        padHeightM: 0,
      },
      context,
    )
    expect(outcome.result.padHeightM).toBe(0)
    expect(sampleAt(fieldOf(applied(nodes, outcome)), 1, 1)).toBe(0)
    // And a pad over the whole lot.
    const whole = carveTerrainPad(
      rampScene(),
      {
        pad: [
          [1, 1],
          [7, 1],
          [7, 7],
          [1, 7],
        ],
        padHeightM: 0.25,
      },
      context,
    )
    expect(whole.result.padAreaM2).toBe(36)
  })

  test('a pad holding no field sample is too small', () => {
    const tiny: [number, number][] = [
      [2.2, 2.2],
      [2.4, 2.2],
      [2.4, 2.4],
      [2.2, 2.4],
    ]
    expect(
      refusalCode(() => carveTerrainPad(rampScene(), { pad: tiny, padHeightM: 0 }, context)),
    ).toBe('pad_too_small')
  })

  test('giving both pad heights, or neither, is refused', () => {
    expect(
      refusalCode(() =>
        carveTerrainPad(rampScene(), { pad: PAD, padHeightM: 0, padFromHighestM: 1 }, context),
      ),
    ).toBe('invalid_input')
    expect(refusalCode(() => carveTerrainPad(rampScene(), { pad: PAD }, context))).toBe(
      'invalid_input',
    )
  })

  test('a scene without a site is refused', () => {
    expect(refusalCode(() => carveTerrainPad({}, { pad: PAD, padHeightM: 0 }, context))).toBe(
      'no_site',
    )
  })

  test('undo restores site.terrain byte for byte in one history step', () => {
    const original = useScene.getState()
    try {
      const before = rampScene()
      const beforeTerrain = JSON.stringify((before.site_terrain as SiteNode).terrain)
      useScene.setState({ nodes: before, rootNodeIds: ['site_terrain'] } as never)
      clearSceneHistory()
      const outcome = carveTerrainPad(before, { pad: PAD, padHeightM: 0, blendM: 2 }, context)
      useScene.setState({ nodes: applied(before, outcome) } as never)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      const restored = useScene.getState().nodes as Nodes
      expect(JSON.stringify((restored.site_terrain as SiteNode).terrain)).toBe(beforeTerrain)
    } finally {
      useScene.setState(original)
      clearSceneHistory()
    }
  })

  test('a live sculpt stroke is ended before the write, and refused calls keep it', () => {
    const nodes = rampScene()
    const liveField = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    useLiveTerrain.getState().begin('site_terrain', liveField)
    try {
      expect(
        refusalCode(() =>
          carveTerrainPad(
            nodes,
            {
              pad: [
                [2.2, 2.2],
                [2.4, 2.2],
                [2.4, 2.4],
                [2.2, 2.4],
              ],
              padHeightM: 0,
            },
            context,
          ),
        ),
      ).toBe('pad_too_small')
      expect(useLiveTerrain.getState().strokeOf('site_terrain')).toBeDefined()
      const outcome = carveTerrainPad(nodes, { pad: PAD, padHeightM: 0 }, context)
      expect(outcome.changes).toBeDefined()
      expect(useLiveTerrain.getState().strokeOf('site_terrain')).toBeUndefined()
      // The write was computed from the persisted ramp, not the flat live field.
      expect(sampleAt(fieldOf(applied(nodes, outcome)), 0, 0)).toBe(-300)
    } finally {
      useLiveTerrain.getState().end('site_terrain')
    }
  })

  test('a large pad writes bounded tiles instead of sending the frozen oversized legacy field', () => {
    const field = createTerrainField({ cols: 129, rows: 129, spacing: 0.5, step: 0.01 })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++) field.heights[row * field.cols + col] = col
    const site = SiteNode.parse({
      id: 'site_terrain',
      polygon: {
        type: 'polygon',
        points: [
          [2, 2],
          [62, 2],
          [62, 62],
          [2, 62],
        ],
      },
      terrain: encodeTerrainField(field),
    })
    const nodes: Nodes = { [site.id]: site }
    const write = () =>
      carveTerrainPad(
        nodes,
        {
          pad: [
            [10, 10],
            [54, 10],
            [54, 54],
            [10, 54],
          ],
          padHeightM: 0.2,
          blendM: 4,
        },
        context,
      )

    const outcome = write()
    const after = applied(nodes, outcome)
    expect((after.site_terrain as SiteNode).terrain).toEqual(site.terrain)
    const tiles = Object.values(after).filter((node) => node.type === 'terrain-tile')
    expect(tiles.length).toBeGreaterThan(1)
    for (const tile of tiles)
      expect(
        new TextEncoder().encode(JSON.stringify({ from: tile, to: tile })).length,
      ).toBeLessThan(MAX_OPERATION_BYTES)
    expect(heightAt(fieldOf(after), 32, 32)).toBe(0.2)
  })
})

describe('shape_site_terrain', () => {
  test('flatten sets every sample in a polygon to the height, exactly', () => {
    const nodes = rampScene()
    const outcome = shapeSiteTerrain(nodes, { verb: 'flatten', area: PAD, heightM: 0.5 }, context)
    const field = fieldOf(applied(nodes, outcome))
    for (let row = 2; row <= 4; row++)
      for (let col = 2; col <= 4; col++) expect(sampleAt(field, col, row)).toBe(50)
    expect(outcome.result).toMatchObject({
      changedSamples: 20,
      beforeMinMaxM: { minM: -1, maxM: 1 },
      afterMinMaxM: { minM: 0.5, maxM: 0.5 },
      touchedM2: 6.25,
    })
    // Samples outside the polygon keep the ramp.
    expect(sampleAt(field, 1, 3)).toBe(-200)
  })

  test('raise over a circle moves only the samples inside the radius', () => {
    const nodes = rampScene()
    const outcome = shapeSiteTerrain(
      nodes,
      { verb: 'raise', area: { x: 3, z: 3, radiusM: 1 }, heightM: 0.5 },
      context,
    )
    const field = fieldOf(applied(nodes, outcome))
    expect(outcome.result.changedSamples).toBe(13)
    expect(sampleAt(field, 3, 3)).toBe(50)
    expect(sampleAt(field, 2, 3)).toBe(-50)
    // The diagonal sample is √2 away: outside a 1 m circle.
    expect(sampleAt(field, 2, 2)).toBe(-100)
  })

  test('lower over a polygon subtracts the height', () => {
    const nodes = rampScene()
    const outcome = shapeSiteTerrain(nodes, { verb: 'lower', area: PAD, heightM: 0.25 }, context)
    const field = fieldOf(applied(nodes, outcome))
    expect(sampleAt(field, 3, 3)).toBe(-25)
    expect(sampleAt(field, 4, 4)).toBe(75)
  })

  test('raise without a height moves the ground by the brush stroke metre', () => {
    const nodes = rampScene()
    const outcome = shapeSiteTerrain(nodes, { verb: 'raise', area: PAD }, context)
    expect(sampleAt(fieldOf(applied(nodes, outcome)), 3, 3)).toBe(100)
  })

  test('strength scales a flatten toward its target', () => {
    const nodes = rampScene()
    const outcome = shapeSiteTerrain(
      nodes,
      { verb: 'flatten', area: PAD, heightM: 1, strength: 0.5 },
      context,
    )
    // Col 2 sits at −1 m; halfway to 1 m is 0.
    expect(sampleAt(fieldOf(applied(nodes, outcome)), 2, 3)).toBe(0)
  })

  test('softness fades the effect over that many metres inside the edge', () => {
    const nodes = rampScene()
    const outcome = shapeSiteTerrain(
      nodes,
      { verb: 'raise', area: { x: 4, z: 4, radiusM: 2 }, heightM: 1, softness: 2 },
      context,
    )
    const field = fieldOf(applied(nodes, outcome))
    // Centre is 2 m inside the edge: full metre. One metre in: half a metre.
    expect(sampleAt(field, 4, 4)).toBe(200)
    expect(sampleAt(field, 3, 4)).toBe(50)
  })

  test('smooth diffuses a step into its neighbours without exceeding it', () => {
    // A step (not a spike): the brush diffusion this mirrors is a Jacobi
    // filter, which oscillates on a single-sample spike but settles a step.
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1, step: 0.01 })
    for (let row = 0; row < field.rows; row++)
      for (let col = 4; col < field.cols; col++) field.heights[row * field.cols + col] = 100
    const nodes = rampScene(field)
    const outcome = shapeSiteTerrain(
      nodes,
      { verb: 'smooth', area: { x: 4, z: 4, radiusM: 2 } },
      context,
    )
    const after = fieldOf(applied(nodes, outcome))
    // The last low sample before the step rises; the first high one falls.
    expect(sampleAt(after, 3, 4)).toBeGreaterThan(0)
    expect(sampleAt(after, 4, 4)).toBeLessThan(100)
    expect(sampleAt(after, 4, 4)).toBeGreaterThan(sampleAt(after, 3, 4))
    for (let z = 0; z <= 8; z += 0.5)
      for (let x = 0; x <= 8; x += 0.5) {
        expect(sampleAt(after, x, z)).toBeLessThanOrEqual(100)
        expect(sampleAt(after, x, z)).toBeGreaterThanOrEqual(0)
      }
  })

  test('flatten without a height is refused; an area outside the property too', () => {
    expect(
      refusalCode(() => shapeSiteTerrain(rampScene(), { verb: 'flatten', area: PAD }, context)),
    ).toBe('invalid_input')
    expect(
      refusalCode(() =>
        shapeSiteTerrain(
          rampScene(),
          { verb: 'raise', area: { x: 6.5, z: 4, radiusM: 1 }, heightM: 1 },
          context,
        ),
      ),
    ).toBe('outside_property')
  })

  test('explicit context shaping writes outside the property without changing the frozen base', () => {
    const nodes = rampScene()
    const snapshot = structuredClone(nodes)
    const input = { verb: 'flatten', area: { x: 40, z: 3, radiusM: 1 }, heightM: 2 } as const
    expect(refusalCode(() => shapeSiteTerrain(nodes, input, context))).toBe('outside_property')
    expect(nodes).toEqual(snapshot)
    const outcome = shapeSiteTerrain(nodes, { ...input, scope: 'context' }, context)
    const after = applied(nodes, outcome)
    expect(heightAt(fieldOf(after), 40, 3)).toBe(2)
    expect((after.site_terrain as SiteNode).terrain).toEqual(
      (nodes.site_terrain as SiteNode).terrain,
    )
    expect(heightAt(fieldOf(after), 3, 3)).toBe(0)
    expect(nodes).toEqual(snapshot)
  })

  test('a write that changes nothing is a no_change refusal with no changes', () => {
    // Only the col-3 samples fall in this strip, and the ramp there is already 0 m.
    const flatArea: [number, number][] = [
      [2.8, 2],
      [3.2, 2],
      [3.2, 4],
      [2.8, 4],
    ]
    expect(
      refusalCode(() =>
        shapeSiteTerrain(rampScene(), { verb: 'flatten', area: flatArea, heightM: 0 }, context),
      ),
    ).toBe('no_change')
    expect(
      refusalCode(() =>
        shapeSiteTerrain(rampScene(), { verb: 'raise', area: PAD, heightM: 0 }, context),
      ),
    ).toBe('no_change')
  })

  test('shaping back to the datum persists a zero override without erasing the legacy base', () => {
    const flat = createTerrainField({ cols: 9, rows: 9, spacing: 1, step: 0.01 })
    flat.heights[3 * 9 + 3] = 40
    const nodes = rampScene(flat)
    const outcome = shapeSiteTerrain(
      nodes,
      { verb: 'flatten', area: { x: 3, z: 3, radiusM: 0.6 }, heightM: 0 },
      context,
    )
    const after = applied(nodes, outcome)
    expect((after.site_terrain as SiteNode).terrain).toEqual(
      (nodes.site_terrain as SiteNode).terrain,
    )
    expect(Object.values(after).some((node) => node.type === 'terrain-tile')).toBe(true)
    expect(heightAt(fieldOf(after), 3, 3)).toBe(0)
  })
})

type HouseOptions = {
  flat?: boolean
  elevation?: number
  buildingPosition?: [number, number, number]
  slabPolygon?: [number, number][]
  withSlab?: boolean
}

function houseScene(options: HouseOptions = {}): Nodes {
  const field = options.flat
    ? createTerrainField({ cols: 9, rows: 9, spacing: 1, step: 0.01 })
    : rampField()
  const site = SiteNode.parse({
    id: 'site_terrain',
    polygon: {
      type: 'polygon',
      points: [
        [1, 1],
        [7, 1],
        [7, 7],
        [1, 7],
      ],
    },
    terrain: encodeTerrainField(field),
    children: ['building_house'],
  })
  const building = BuildingNode.parse({
    id: 'building_house',
    parentId: site.id,
    position: options.buildingPosition ?? [0, 0, 0],
    children: ['level_house'],
  })
  const withSlab = options.withSlab ?? true
  const level = LevelNode.parse({
    id: 'level_house',
    parentId: building.id,
    level: 0,
    height: 3,
    children: withSlab ? ['slab_house'] : [],
  })
  const nodes: Nodes = { [site.id]: site, [building.id]: building, [level.id]: level }
  if (withSlab) {
    const slab = SlabNode.parse({
      id: 'slab_house',
      parentId: level.id,
      boundary: 'auto',
      polygon: options.slabPolygon ?? PAD,
      elevation: options.elevation ?? 1.6,
    })
    nodes[slab.id] = slab
  }
  return nodes
}

describe('describe_terrain_under_house', () => {
  test('edge drops on a wedge, with clearance under the raised slab', () => {
    const outcome = describeTerrainUnderHouse(houseScene(), {}, context)
    expect(outcome.changes).toBeUndefined()
    expect(outcome.result).toMatchObject({
      levelId: 'level_house',
      slabId: 'slab_house',
      slabTopM: 1.6,
      highestM: 1,
      lowestM: -1,
      reliefM: 2,
    })
    expect(outcome.result.clearanceUnderSlabM).toBeCloseTo(0.6, 9)
    const drops = (outcome.result.dropAtEdges as { dropM: number }[]).map((edge) => edge.dropM)
    // Slab top 1.6 over ground falling 1 → −1 along +x edges; the x=4 edge
    // stands 0.6 m over its ground.
    expect(drops.map((drop) => Math.round(drop * 100))).toEqual([260, 60, 260, 260])
  })

  test('needsGuardAt flags edges over the shared 0.5 m threshold, as advisory', () => {
    const outcome = describeTerrainUnderHouse(houseScene(), {}, context)
    const guarded = outcome.result.needsGuardAt as { dropM: number }[]
    expect(guarded).toHaveLength(4)
    expect(Math.min(...guarded.map((edge) => edge.dropM))).toBeGreaterThan(
      UNGUARDED_DROP_THRESHOLD_M,
    )
    expect(outcome.result.guardAdvisory).toMatchObject({
      advisory: true,
      thresholdM: UNGUARDED_DROP_THRESHOLD_M,
    })
    expect(
      (outcome.result.guardAdvisory as { typicalRequirement: string }).typicalRequirement,
    ).toContain('0.76')
  })

  test('a flat lot under a slab at grade reports zero drops and no guard edges', () => {
    const outcome = describeTerrainUnderHouse(houseScene({ flat: true, elevation: 0 }), {}, context)
    expect(outcome.result).toMatchObject({ reliefM: 0, clearanceUnderSlabM: 0 })
    expect((outcome.result.dropAtEdges as { dropM: number }[]).every((e) => e.dropM === 0)).toBe(
      true,
    )
    expect(outcome.result.needsGuardAt).toEqual([])
  })

  test('the footprint is reported in the site frame, through the building offset', () => {
    const outcome = describeTerrainUnderHouse(
      houseScene({
        buildingPosition: [1, 0, 0],
        slabPolygon: [
          [1, 2],
          [3, 2],
          [3, 4],
          [1, 4],
        ],
      }),
      {},
      context,
    )
    expect(outcome.result.footprint).toEqual(PAD)
    expect(outcome.result.highestM).toBe(1)
  })

  test('an explicit level is honoured and a missing one refused', () => {
    const nodes = houseScene()
    expect(
      describeTerrainUnderHouse(nodes, { levelId: 'level_house' }, context).result.levelId,
    ).toBe('level_house')
    expect(
      refusalCode(() => describeTerrainUnderHouse(nodes, { levelId: 'level_missing' }, context)),
    ).toBe('level_not_found')
    expect(
      refusalCode(() => describeTerrainUnderHouse(nodes, { levelId: 'slab_house' }, context)),
    ).toBe('not_a_level')
  })

  test('refuses no_site and a level with no slab footprint', () => {
    expect(refusalCode(() => describeTerrainUnderHouse({}, {}, context))).toBe('no_site')
    expect(
      refusalCode(() => describeTerrainUnderHouse(houseScene({ withSlab: false }), {}, context)),
    ).toBe('footprint_empty')
  })

  test('sampling counts every measured point, interior and boundary', () => {
    const outcome = describeTerrainUnderHouse(houseScene(), {}, context)
    // 2×2 m footprint at 1 m spacing: 4 cell-midpoint interior samples plus
    // 3 sampled points along each of the 4 edges.
    expect((outcome.result.sampling as { sampleCount: number }).sampleCount).toBe(16)
  })

  test('slabs are ranked by total area, and a disconnected largest slab is refused', () => {
    const nodes = houseScene({ withSlab: false })
    // 6×4 m slab cut through by a 1 m strip: two 10 m² components, 20 m² in
    // total. The separate solid slab is 12 m² — larger than either component,
    // smaller than the slab it would silently replace.
    const split = SlabNode.parse({
      id: 'slab_split',
      parentId: 'level_house',
      boundary: 'auto',
      polygon: [
        [1, 1],
        [7, 1],
        [7, 5],
        [1, 5],
      ],
      holes: [
        [
          [3.5, 0.5],
          [4.5, 0.5],
          [4.5, 5.5],
          [3.5, 5.5],
        ],
      ],
      elevation: 1.6,
    })
    const solid = SlabNode.parse({
      id: 'slab_solid',
      parentId: 'level_house',
      boundary: 'auto',
      polygon: [
        [1, 5],
        [5, 5],
        [5, 8],
        [1, 8],
      ],
      elevation: 1.6,
    })
    nodes[split.id] = split
    nodes[solid.id] = solid
    ;(nodes.level_house as LevelNode).children = [split.id, solid.id]
    expect(refusalCode(() => describeTerrainUnderHouse(nodes, {}, context))).toBe(
      'disconnected_footprint',
    )
  })

  test('guard edges are terrain-only drops, and the advisory says so', () => {
    const nodes = houseScene({ withSlab: false })
    const primary = SlabNode.parse({
      id: 'slab_primary',
      parentId: 'level_house',
      boundary: 'auto',
      polygon: [
        [1, 2],
        [4, 2],
        [4, 5],
        [1, 5],
      ],
      elevation: 2,
    })
    const landing = SlabNode.parse({
      id: 'slab_landing',
      parentId: 'level_house',
      boundary: 'auto',
      polygon: [
        [4, 2],
        [6, 2],
        [6, 5],
        [4, 5],
      ],
      elevation: 1.8,
    })
    nodes[primary.id] = primary
    nodes[landing.id] = landing
    ;(nodes.level_house as LevelNode).children = [primary.id, landing.id]
    const outcome = describeTerrainUnderHouse(nodes, {}, context)
    expect(outcome.result.slabId).toBe('slab_primary')
    // The shared edge at x=4 stands 1 m over the terrain, so the terrain-only
    // fact flags it — even though a landing, not open ground, lies beyond it
    // and verify_scene would not. Only the threshold is shared.
    const guarded = outcome.result.needsGuardAt as { from: number[]; to: number[] }[]
    expect(guarded.some((edge) => edge.from[0] === 4 && edge.to[0] === 4)).toBe(true)
    const basis = (outcome.result.guardAdvisory as { basis: string }).basis
    expect(basis).toContain('Only the threshold is shared')
    expect(basis).not.toContain('both flag the same')
  })
})
