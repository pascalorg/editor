import { describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
  terrainBreaksOf,
} from '@pascal-app/core'
import { AGENT_OPERATIONS, applySceneChanges } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { type AnyNode, SiteNode } from '@pascal-app/core/schema'

/*
 * Failure modes this file pins (the stair-step of 15 Oct, on pads): a pad with no blend is a
 * vertical step, but it was written into the 0.5 m lattice, so the ground 3 cm inside its edge
 * was up to 0.78 m off the pad height and 3 cm outside up to 0.81 m off the original ground.
 */

type Nodes = Record<string, AnyNode>
type Point = [number, number]
const context = { activeLevelId: null }
const PAD_HEIGHT = -0.6

function hillside(): Nodes {
  const field = createTerrainField({ origin: [-20, -20], spacing: 0.5, cols: 81, rows: 81 })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++) {
      const x = -20 + col * 0.5
      const z = -20 + row * 0.5
      field.heights[row * field.cols + col] = Math.round((0.06 * x + 0.04 * z) * 100)
    }
  const site = SiteNode.parse({
    id: 'site_pad',
    polygon: {
      type: 'polygon',
      points: [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ],
    },
    terrain: encodeTerrainField(field),
  })
  return { [site.id]: site }
}

/** A rectangle turned `degrees`, so no edge lies on the lattice. */
function turned(centre: Point, width: number, depth: number, degrees: number): Point[] {
  const c = Math.cos((degrees * Math.PI) / 180)
  const s = Math.sin((degrees * Math.PI) / 180)
  return (
    [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [width / 2, depth / 2],
      [-width / 2, depth / 2],
    ] as Point[]
  ).map(([x, z]) => [centre[0] + x * c - z * s, centre[1] + x * s + z * c])
}

const ops = AGENT_OPERATIONS as unknown as Record<
  string,
  (
    nodes: Nodes,
    input: unknown,
    context: unknown,
  ) => {
    result: Record<string, unknown>
    changes?: Parameters<typeof applySceneChanges>[1]
  }
>

function carve(nodes: Nodes, input: Record<string, unknown>) {
  const outcome = ops.carve_terrain_pad!(nodes, input, context)
  return { outcome, after: applySceneChanges(nodes, outcome.changes) as Nodes }
}

function fieldOf(nodes: Nodes) {
  const site = nodes.site_pad
  if (site?.type !== 'site') throw new Error('Missing site')
  const field = persistedTerrainFieldOf(site, nodes)
  if (!field) throw new Error('Missing terrain')
  return field
}

function refusal(call: () => unknown): string | null {
  try {
    call()
  } catch (error) {
    return isAgentRefusal(error) ? error.code : `threw: ${String(error)}`
  }
  return null
}

/** Points a few centimetres to each side of the pad's edges, away from the corners. */
function besideTheEdges(pad: Point[], offset: number) {
  const inside: Point[] = []
  const outside: Point[] = []
  for (let i = 0; i < pad.length; i++) {
    const a = pad[i] as Point
    const b = pad[(i + 1) % pad.length] as Point
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    // The pad is counter-clockwise, so the left of a → b is inside.
    const nx = -(b[1] - a[1]) / length
    const nz = (b[0] - a[0]) / length
    for (let k = 1; k < 60; k++) {
      const t = k / 60
      const x = a[0] + (b[0] - a[0]) * t
      const z = a[1] + (b[1] - a[1]) * t
      inside.push([x + nx * offset, z + nz * offset])
      outside.push([x - nx * offset, z - nz * offset])
    }
  }
  return { inside, outside }
}

describe('a pad with blendM 0 is an exact soil face', () => {
  const nodes = hillside()
  const natural = fieldOf(nodes)
  const pad = turned([0, 0], 8, 6, 25)

  test('is written as one closed break of kind soil at the pad height, with no tile', () => {
    const { outcome, after } = carve(nodes, { pad, padHeightM: PAD_HEIGHT })
    const breaks = terrainBreaksOf(after.site_pad as SiteNode, after)
    expect(breaks).toHaveLength(1)
    expect(breaks[0]).toMatchObject({ kind: 'soil', left: PAD_HEIGHT, right: 'ground' })
    expect(Object.values(after).filter((node) => node.type === 'terrain-tile')).toEqual([])
    expect((after.site_pad as SiteNode).terrain).toEqual((nodes.site_pad as SiteNode).terrain)
    expect(outcome.result.changedSamples).toBe(0)
    expect(outcome.result.edge).toBeUndefined()
    expect(outcome.result.maxSlopeIntoPadDeg).toBe(90)
    expect(outcome.result.padHeightM).toBe(PAD_HEIGHT)
    expect((outcome.result.breaks as { kind: string; faceAreaM2: number }[])[0]).toMatchObject({
      kind: 'soil',
    })
  })

  test('the ground 3 cm inside the edge is the pad height, and 3 cm outside the original ground', () => {
    const { after } = carve(nodes, { pad, padHeightM: PAD_HEIGHT })
    const field = fieldOf(after)
    const { inside, outside } = besideTheEdges(pad, 0.03)
    for (const [x, z] of inside) expect(heightAt(field, x, z)).toBeCloseTo(PAD_HEIGHT, 9)
    for (const [x, z] of outside)
      expect(heightAt(field, x, z)).toBeCloseTo(heightAt(natural, x, z), 9)
  })

  test('volumes are plan-area integrals, and padFromHighestM gives the same face', () => {
    const { outcome } = carve(nodes, { pad, padHeightM: PAD_HEIGHT })
    const { cutVolumeM3, fillVolumeM3, netM3, padAreaM2 } = outcome.result as Record<string, number>
    expect(padAreaM2).toBeCloseTo(48, 6)
    // The ground is a plane, so the integral is the mean height over the pad against the pad.
    const mean = 0.06 * 0 + 0.04 * 0
    expect(netM3).toBeCloseTo((mean - PAD_HEIGHT) * 48, 1)
    expect(netM3).toBeCloseTo(cutVolumeM3 - fillVolumeM3, 6)
    const highest = carve(nodes, { pad, padFromHighestM: 0 })
    expect((highest.outcome.result.breaks as { kind: string }[])[0]).toMatchObject({ kind: 'soil' })
  })

  test('a pad that already stands on the ground writes nothing', () => {
    const flat = createTerrainField({ origin: [-20, -20], spacing: 0.5, cols: 81, rows: 81 })
    const site = SiteNode.parse({
      id: 'site_pad',
      polygon: {
        type: 'polygon',
        points: [
          [-20, -20],
          [20, -20],
          [20, 20],
          [-20, 20],
        ],
      },
      terrain: encodeTerrainField(flat),
    })
    expect(
      refusal(() => ops.carve_terrain_pad!({ [site.id]: site }, { pad, padHeightM: 0 }, context)),
    ).toBe('no_change')
  })

  test('a pad within half a centimetre of the ground is the lattice’s no_change too', () => {
    const flat = createTerrainField({ origin: [-20, -20], spacing: 0.5, cols: 81, rows: 81 })
    const site = SiteNode.parse({
      id: 'site_pad',
      polygon: {
        type: 'polygon',
        points: [
          [-20, -20],
          [20, -20],
          [20, 20],
          [-20, 20],
        ],
      },
      terrain: encodeTerrainField(flat),
    })
    expect(
      refusal(() =>
        ops.carve_terrain_pad!({ [site.id]: site }, { pad, padHeightM: 0.004 }, context),
      ),
    ).toBe('no_change')
  })

  test('a pad holding no lattice sample is still too small', () => {
    const tiny: Point[] = [
      [2.1, 2.1],
      [2.3, 2.1],
      [2.3, 2.3],
      [2.1, 2.3],
    ]
    expect(
      refusal(() => ops.carve_terrain_pad!(nodes, { pad: tiny, padHeightM: 0 }, context)),
    ).toBe('pad_too_small')
  })
})

describe('what stays on the lattice, and says so', () => {
  const nodes = hillside()

  test('blendM above 0 is the blend ring on the lattice, as before', () => {
    const { outcome, after } = carve(nodes, {
      pad: turned([0, 0], 8, 6, 25),
      padHeightM: PAD_HEIGHT,
      blendM: 2,
    })
    expect(terrainBreaksOf(after.site_pad as SiteNode, after)).toHaveLength(0)
    expect(
      Object.values(after).filter((node) => node.type === 'terrain-tile').length,
    ).toBeGreaterThan(0)
    expect(outcome.result.changedSamples).toBeGreaterThan(0)
    expect(outcome.result.edge).toBeUndefined()
  })

  test('cliff and retaining edges are still exact breaks of their own kind', () => {
    for (const edges of ['cliff', 'retaining'] as const) {
      const { after } = carve(nodes, {
        pad: turned([0, 0], 8, 6, 25),
        padHeightM: PAD_HEIGHT,
        edges,
      })
      expect(terrainBreaksOf(after.site_pad as SiteNode, after)[0]).toMatchObject({ kind: edges })
    }
  })

  test('a pad that is not convex keeps the lattice write and states it as a fact', () => {
    const lShape: Point[] = [
      [-4, -4],
      [4, -4],
      [4, 0],
      [0, 0],
      [0, 4],
      [-4, 4],
    ]
    const { outcome, after } = carve(nodes, { pad: lShape, padHeightM: PAD_HEIGHT })
    expect(terrainBreaksOf(after.site_pad as SiteNode, after)).toHaveLength(0)
    expect(outcome.result.changedSamples).toBeGreaterThan(0)
    expect(outcome.result.edge).toMatchObject({
      kind: 'lattice_step',
      exact: false,
      reason: 'non_convex_pad',
      resolutionM: 0.5,
    })
  })

  test('a pad whose break would cross another keeps the lattice write and says why', () => {
    const first = carve(nodes, {
      pad: turned([0, 0], 8, 6, 25),
      padHeightM: PAD_HEIGHT,
      edges: 'retaining',
    })
    const second = carve(first.after, { pad: turned([3, 2], 8, 6, 10), padHeightM: -1.2 })
    expect(terrainBreaksOf(second.after.site_pad as SiteNode, second.after)).toHaveLength(1)
    expect(second.outcome.result.changedSamples).toBeGreaterThan(0)
    expect(second.outcome.result.edge).toMatchObject({
      kind: 'lattice_step',
      exact: false,
      reason: 'crossing_breaks',
    })
  })
})
