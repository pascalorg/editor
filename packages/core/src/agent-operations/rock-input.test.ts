import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AGENT_TOOL_CONTRACTS } from '../agent-tools'
import { isAgentRefusal } from '../agent-tools/refusal'
import { buildRock } from '../index'
import { encodeTerrainField } from '../lib/terrain-codec'
import { createTerrainField } from '../lib/terrain-field'
import { BuildingNode, RockNode, SiteNode } from '../schema'
import { applySceneChanges } from './apply-changes'
import { AGENT_OPERATIONS } from './index'
import type { AgentOperationOutcome, SceneNodes } from './types'

const outline: [number, number][] = [
  [0, -2],
  [4, -2],
  [4, 3],
  [0, 3],
]
const context = { activeLevelId: null }
const call = (nodes: SceneNodes, input: Record<string, unknown>) =>
  AGENT_OPERATIONS.add_rock(nodes, input as never, context)

function scene() {
  // Preserve the independently captured datum-zero outcome hashes, not main's -0.05
  // terrain-absent render plane. Main's actual fallback is covered in main-ground.test.ts.
  const site = SiteNode.parse({
    id: 'site_rock_input_baseline',
    terrain: encodeTerrainField(createTerrainField()),
  })
  return { site, nodes: { [site.id]: site } as SceneNodes }
}

function created(outcome: AgentOperationOutcome) {
  expect(outcome.changes?.create).toHaveLength(1)
  return RockNode.parse(outcome.changes?.create?.[0]?.node)
}

function normalized(outcome: AgentOperationOutcome, rockId: string) {
  return JSON.stringify(outcome).replaceAll(rockId, 'rock_baseline')
}

function meshSignature(rock: RockNode) {
  const built = buildRock(rock)
  return [built.near, built.far].map((level) => {
    if (!level) return null
    return Object.fromEntries(
      Object.entries(level).map(([key, values]) => [
        key,
        createHash('sha256')
          .update(Buffer.from(values.buffer, values.byteOffset, values.byteLength))
          .digest('hex'),
      ]),
    )
  })
}

function expectBounds(polygon: RockNode['polygon'], bounds: [number, number, number, number]) {
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  const actual = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(bounds[index]!, 9)
  })
}

function refusedWithoutMutation(nodes: SceneNodes, input: Record<string, unknown>) {
  const before = JSON.stringify(nodes)
  let refusal: unknown
  try {
    call(nodes, input)
  } catch (error) {
    refusal = error
  }
  expect(JSON.stringify(nodes)).toBe(before)
  expect(isAgentRefusal(refusal)).toBe(true)
  if (!isAgentRefusal(refusal)) throw new Error('Expected an actionable agent refusal')
  return refusal
}

// Oracle: captured before the input feature changed, at 59eeeafe71993f0b52504ae7bd6e0a9835908bf9
// with Bun 1.4.4. Hash the COMPLETE operation outcome (only its random rock id normalized),
// and actual public buildRock near/far typed-array bytes. Gen 1 has no far mesh.
// This deliberately protects the requested byte-identical legacy path, not a new generator algorithm.
const legacy = [
  {
    gen: 1,
    result: '2c5ee2c03232cd019d781c8f56ca0ad91a0f11f5d071088bb8c9cb576b5ff48f',
    mesh: [
      {
        position: '098d0bee1453d94d4edc38cfcd0e8d83ec42228e348da14a58d7be283848ff9f',
        index: '008f1d81ab879cf0c03054e0d0e44a0f0b8db2383200865031f8e18ab358ddbe',
      },
      null,
    ],
  },
  {
    gen: 2,
    result: 'aedb8531df6794e0274f53175de0eb3acc54e7ddaa181f3291a9aaad710145a9',
    mesh: [
      {
        position: '7f90d29b3d3e2226efd65537b33ea9c5c6e9a7f4501a928091812decb20b4279',
        index: '6042db0167e27673025d327eadcb5741a6f2f4cb3f44ffd071fd0a83a581a76b',
      },
      {
        position: '7d3e5a17b5571c76717e93650764a235e3ebb7b76c38099f72d75d3c54faeecb',
        index: 'c7bc5f2b56306e447710fd0c1a93691b364e452928e8340370effcef5f28cb57',
      },
    ],
  },
] as const

describe('add_rock footprint inputs', () => {
  for (const baseline of legacy) {
    test(`generator ${baseline.gen}: both polygon spellings preserve the complete legacy result and mesh`, () => {
      const { nodes } = scene()
      for (const footprint of [{ outline }, { polygon: outline }]) {
        const outcome = call(nodes, {
          ...footprint,
          height: 3,
          seed: 42,
          gen: baseline.gen,
          form: 'weathered',
          strata: true,
          lichen: 0.3,
        })
        const rock = created(outcome)
        expect(rock.polygon).toEqual(outline)
        expect(createHash('sha256').update(normalized(outcome, rock.id)).digest('hex')).toBe(
          baseline.result,
        )
        expect(meshSignature(rock)).toEqual(baseline.mesh)
      }
    })
  }

  // Analytical bounds, not copied vertices: any deterministic natural outline is allowed.
  // These checks reject diameter/radius confusion, swapped axes, lost centre, and width caps.
  for (const sample of [
    { label: 'scalar', size: 4, bounds: [5, -7, 9, -3] },
    { label: 'rectangle', size: [6, 2], bounds: [4, -6, 10, -4] },
    { label: 'small supported scalar', size: 0.6, bounds: [6.7, -5.3, 7.3, -4.7] },
    { label: 'wide rectangle', size: [120, 2], bounds: [-53, -6, 67, -4] },
  ]) {
    test(`${sample.label} is centred at at with exactly the requested footprint bounds`, () => {
      const { nodes, site } = scene()
      const outcome = call(nodes, { at: [7, -5], size: sample.size })
      const rock = created(outcome)
      expectBounds(rock.polygon, sample.bounds as [number, number, number, number])
      expect(rock).toMatchObject({ parentId: site.id, seed: 1, height: 2.4, gen: 2 })
      expect(outcome.result).toMatchObject({ rockId: rock.id, siteId: site.id })
      expect(buildRock(rock).near).not.toBeNull()
    })
  }

  test('generates in the building plan frame before translating and rotating into the Site', () => {
    const { site, nodes } = scene()
    const building = BuildingNode.parse({
      id: 'building_rock_input',
      parentId: site.id,
      position: [10, 0, 20],
      rotation: [0, Math.PI / 2, 0],
    })
    const withBuilding = {
      ...nodes,
      [site.id]: { ...site, children: [building.id] },
      [building.id]: building,
    }
    for (const size of [4, [6, 2]]) {
      const input = { at: [3, -2], size, seed: 19 }
      const local = created(call(nodes, input))
      const placed = created(call(withBuilding, { ...input, buildingId: building.id }))
      expect(placed.parentId).toBe(site.id)
      expect(placed.polygon).toHaveLength(local.polygon.length)
      // Positive quarter-turn about Y: (x,z) -> (z,-x), then translation.
      local.polygon.forEach(([x, z], index) => {
        expect(placed.polygon[index]![0]).toBeCloseTo(10 + z, 9)
        expect(placed.polygon[index]![1]).toBeCloseTo(20 - x, 9)
      })
      expectBounds(placed.polygon, typeof size === 'number' ? [6, 15, 10, 19] : [7, 14, 9, 20])
    }
  })

  test('explicit and default seeds reproduce the full result and mesh, while a new seed varies the footprint', () => {
    const { nodes } = scene()
    const input = { at: [-4, 8], size: [5, 3] }
    const first = call(nodes, input)
    const firstRock = created(first)
    for (const repeated of [call(nodes, input), call(nodes, { ...input, seed: 1 })]) {
      const rock = created(repeated)
      expect(normalized(repeated, rock.id)).toBe(normalized(first, firstRock.id))
      expect(meshSignature(rock)).toEqual(meshSignature(firstRock))
    }
    const seeded = call(nodes, { ...input, seed: -19 })
    const seededRock = created(seeded)
    const repeatedSeed = call(nodes, { ...input, seed: -19 })
    expect(normalized(repeatedSeed, created(repeatedSeed).id)).toBe(
      normalized(seeded, seededRock.id),
    )
    expect(meshSignature(created(repeatedSeed))).toEqual(meshSignature(seededRock))
    expect(seededRock.polygon).not.toEqual(firstRock.polygon)
    expect(meshSignature(seededRock)).not.toEqual(meshSignature(firstRock))
    expectBounds(seededRock.polygon, [-6.5, 6.5, -1.5, 9.5])
  })

  test('existing rocks need no footprint; generated reshapes retain stored seed, height and generator', () => {
    const { nodes } = scene()
    const initial = call(nodes, { outline, gen: 1, seed: 37, height: 3, strata: true })
    const original = created(initial)
    const existing = applySceneChanges(nodes, initial.changes)
    const edited = call(existing, { rockId: original.id, lichen: 0.4 })
    const afterEdit = RockNode.parse(applySceneChanges(existing, edited.changes)[original.id])
    expect(afterEdit).toEqual({ ...original, lichen: 0.4 })
    expect(edited.changes?.create).toBeUndefined()

    const reshape = call(existing, { rockId: original.id, at: [2, -3], size: [4, 2] })
    const reshaped = RockNode.parse(applySceneChanges(existing, reshape.changes)[original.id])
    expect(reshaped).toMatchObject({ id: original.id, height: 3, seed: 37, gen: 1, strata: true })
    expectBounds(reshaped.polygon, [0, -4, 4, -2])
    const explicit = created(call(nodes, { at: [2, -3], size: [4, 2], seed: 37, gen: 1 }))
    expect(reshaped.polygon).toEqual(explicit.polygon)

    for (const footprint of [{ outline }, { polygon: outline }]) {
      const restored = call(existing, { rockId: original.id, ...footprint, height: 4 })
      expect(RockNode.parse(applySceneChanges(existing, restored.changes)[original.id])).toEqual({
        ...original,
        height: 4,
      })
    }
  })

  test('creation requires exactly one complete footprint source; edits reject ambiguous or partial sources too', () => {
    const { nodes } = scene()
    const initial = call(nodes, { outline })
    const rock = created(initial)
    const existing = applySceneChanges(nodes, initial.changes)
    refusedWithoutMutation(nodes, {})
    for (const invalid of [
      { outline, polygon: outline },
      { outline, at: [0, 0], size: 2 },
      { polygon: outline, at: [0, 0], size: 2 },
      { outline, at: [0, 0] },
      { outline, size: 2 },
      { polygon: outline, at: [0, 0] },
      { polygon: outline, size: 2 },
      { at: [0, 0] },
      { size: 2 },
    ]) {
      refusedWithoutMutation(nodes, invalid)
      refusedWithoutMutation(existing, { rockId: rock.id, ...invalid })
    }
  })

  test('invalid dimensions, coordinates, seeds and heights refuse atomically on creation and edit', () => {
    const { nodes } = scene()
    const initial = call(nodes, { outline })
    const rock = created(initial)
    const existing = applySceneChanges(nodes, initial.changes)
    const invalidInputs = [
      ...[
        0,
        -1,
        NaN,
        Infinity,
        -Infinity,
        [0, 2],
        [2, -1],
        [Infinity, 2],
        [2, NaN],
        [],
        [2],
        [2, 3, 4],
      ].map((size) => ({ size })),
      ...[[0], [0, 0, 0], [NaN, 0], [0, Infinity]].map((at) => ({ at })),
      ...[0, -1, 60.01, NaN, Infinity].map((height) => ({ height })),
      ...[0.5, NaN, Infinity].map((seed) => ({ seed })),
    ]
    for (const invalid of invalidInputs) {
      const input = { at: [0, 0], size: 2, ...invalid }
      refusedWithoutMutation(nodes, input)
      refusedWithoutMutation(existing, { rockId: rock.id, ...input })
    }
    const maximum = created(call(nodes, { at: [0, 0], size: 2, height: 60, seed: 0 }))
    expect(maximum).toMatchObject({ height: 60, seed: 0 })
  })

  test('tiny explicit and generated footprints retain the 0.25 m² minimum with actionable numeric recovery', () => {
    const { nodes } = scene()
    const tiny = [
      [0, 0],
      [0.2, 0],
      [0.2, 0.2],
      [0, 0.2],
    ]
    for (const input of [{ outline: tiny }, { polygon: tiny }, { at: [0, 0], size: 0.3 }]) {
      const refusal = refusedWithoutMutation(nodes, input)
      expect(refusal.message).toMatch(/0\.25\s*m(?:²|2|\^2)/)
      expect(refusal.message).toMatch(/\bat\b/)
      expect(refusal.message).toMatch(/\bsize\b/)
    }
    const minimum = [
      [0, 0],
      [0.5, 0],
      [0.5, 0.5],
      [0, 0.5],
    ]
    expect(created(call(nodes, { polygon: minimum })).polygon).toEqual(minimum)
    expectBounds(created(call(nodes, { at: [0, 0], size: 0.6 })).polygon, [-0.3, -0.3, 0.3, 0.3])
  })

  test('the shared tool input remains a raw Zod shape, leaving footprint relationships to the operation', () => {
    const contract = AGENT_TOOL_CONTRACTS.find((tool) => tool.name === 'add_rock')!
    const schema = z.object(contract.input)
    for (const key of ['outline', 'polygon', 'at', 'size']) {
      expect(schema.shape).toHaveProperty(key)
    }
    expect(schema.safeParse({ at: [1, 2], size: 3 }).success).toBe(true)
    expect(schema.safeParse({ at: [1, 2], size: [3, 4] }).success).toBe(true)
    expect(schema.safeParse({ rockId: 'rock_existing', height: 3 }).success).toBe(true)
  })
})
