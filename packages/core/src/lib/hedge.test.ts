import { describe, expect, test } from 'bun:test'
import {
  AnyNode,
  buildHedge,
  FLAT_GROUND,
  type GroundRead,
  groundReadOf,
  HEDGE_EMBED,
  HEDGE_LIMITS,
  HEDGE_MAX_STATIONS,
  HEDGE_MAX_TRIANGLES,
  type HedgeMesh,
  HedgeNode,
  hedgeBands,
  hedgeCentreline,
  hedgeFormFor,
  hedgeLateral,
  hedgeLine,
  hedgeNormal,
  planHedge,
  registerHedgeForm,
  standHedgeLine,
} from '../index'

type Point = [number, number]

const wavy: Point[] = [
  [0, 0],
  [3, 0.4],
  [5.5, 1.6],
  [7.6, 1.7],
]
const hedge = (extra: Partial<HedgeNode> = {}) =>
  HedgeNode.parse({ id: 'hedge_test', path: wavy, seed: 7, ...extra })

/** FNV-1a over every array a build returns: the same bytes, the same number. */
function fingerprint(meshes: HedgeMesh[]): string {
  let hash = 0x811c9dc5
  for (const mesh of meshes)
    for (const array of [mesh.position, mesh.normal, mesh.color, mesh.index]) {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193)
    }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const trianglesOf = (meshes: HedgeMesh[]) =>
  meshes.reduce((sum, mesh) => sum + mesh.index.length / 3, 0)
const verticesOf = (meshes: HedgeMesh[]) =>
  meshes.reduce((sum, mesh) => sum + mesh.position.length / 3, 0)

describe('the stored hedge', () => {
  test('is its line and a few numbers, and survives a save and a load unchanged', () => {
    const node = hedge({ gaps: [{ at: 3, width: 1.2 }], clip: 0.4 })
    const loaded = HedgeNode.parse(JSON.parse(JSON.stringify(node)))

    expect(loaded).toEqual(node)
    expect(AnyNode.parse(JSON.parse(JSON.stringify(node)))).toEqual(node)
    expect(Object.keys(node).sort()).toEqual(
      [
        'clip',
        'closed',
        'curve',
        'gaps',
        'gen',
        'height',
        'id',
        'leafColor',
        'leafSize',
        'metadata',
        'name',
        'object',
        'parentId',
        'path',
        'seed',
        'type',
        'visible',
        'width',
      ].filter((key) => key !== 'name'),
    )
    const {
      id: _id,
      object: _object,
      parentId: _parent,
      metadata: _meta,
      visible: _v,
      ...own
    } = node
    expect(JSON.stringify(own).length).toBeLessThan(220)
  })

  test('a hedge saved before a field existed loads with the first generator', () => {
    expect(HedgeNode.parse({ path: wavy }).gen).toBe(1)
  })

  test.each([
    ['one point', { path: [[0, 0]] }],
    ['65 points', { path: Array.from({ length: 65 }, (_, i) => [i, 0]) }],
    [
      'a point that is not a number',
      {
        path: [
          [0, 0],
          [Number.NaN, 1],
        ],
      },
    ],
    [
      'a point beyond the bound',
      {
        path: [
          [0, 0],
          [HEDGE_LIMITS.maxCoordinate + 1, 0],
        ],
      },
    ],
    ['a height over the bound', { height: HEDGE_LIMITS.maxHeight + 1 }],
    ['no width', { width: 0 }],
    ['a leaf of no size', { leafSize: 0 }],
    ['a clip over 1', { clip: 1.5 }],
    ['a colour that is not one', { leafColor: 'green' }],
    ['17 openings', { gaps: Array.from({ length: 17 }, (_, i) => ({ at: i, width: 0.5 })) }],
    ['a generator below the first', { gen: 0 }],
  ])('refuses %s', (_label, extra) => {
    expect(HedgeNode.safeParse({ path: wavy, ...extra }).success).toBe(false)
  })
})

describe('the line of a hedge', () => {
  test('a straight line is its own length, cut into stations a hand apart', () => {
    const line = hedgeLine(
      hedge({
        path: [
          [0, 0],
          [10, 0],
        ],
      }),
    )

    expect(line.length).toBeCloseTo(10, 9)
    expect(line.planted).toBeCloseTo(10, 9)
    expect(line.runs).toHaveLength(1)
    const stations = line.runs[0]?.stations ?? []
    expect(stations.length).toBeGreaterThan(60)
    expect(stations.length).toBeLessThan(120)
    for (const station of stations) {
      expect(station.tx).toBeCloseTo(1, 9)
      expect(station.tz).toBeCloseTo(0, 9)
      expect(station.k).toBeCloseTo(0, 9)
    }
  })

  test('curve bends through the points with the fence’s spline; without it the sides stay straight', () => {
    const corner: Point[] = [
      [0, 0],
      [6, 0],
      [6, 6],
    ]
    const straight = hedgeLine(hedge({ path: corner }))
    const curved = hedgeLine(hedge({ path: corner, curve: true }))
    const onFirstSide = (line: typeof straight) =>
      (line.runs[0]?.stations ?? []).filter((s) => s.x < 4).every((s) => Math.abs(s.z) < 1e-9)

    expect(onFirstSide(straight)).toBe(true)
    expect(onFirstSide(curved)).toBe(false)
    expect(straight.length).toBeLessThan(12)
    expect(straight.length).toBeGreaterThan(11)
  })

  test('a right angle is turned without folding the band: each edge keeps going the way the line goes', () => {
    for (const curve of [false, true]) {
      const node = hedge({
        path: [
          [0, 0],
          [5, 0],
          [5, 5],
        ],
        curve,
        width: 1.2,
      })
      const line = hedgeLine(node)
      const stations = line.runs[0]?.stations ?? []
      for (const side of [1, -1]) {
        const edge = stations.map((station): Point => {
          const [nx, nz] = hedgeNormal(station)
          const offset = hedgeLateral(station, (side * node.width) / 2)
          return [station.x + nx * offset, station.z + nz * offset]
        })
        for (let i = 1; i < edge.length; i++) {
          const [a, b] = [edge[i - 1] as Point, edge[i] as Point]
          const station = stations[i - 1]
          expect(
            (b[0] - a[0]) * (station?.tx ?? 0) + (b[1] - a[1]) * (station?.tz ?? 0),
          ).toBeGreaterThan(-1e-6)
        }
      }
    }
  })

  test.each([
    [
      'a right angle',
      [
        [0, 0],
        [5, 0],
        [5, 5],
      ],
    ],
    [
      'a hairpin, whose two legs lie in each other',
      [
        [0, 0],
        [5, 0],
        [0.4, 0.5],
      ],
    ],
    [
      'a zigzag of sides shorter than the hedge is wide',
      [
        [0, 0],
        [0.5, 0.4],
        [1, 0],
        [1.5, 0.4],
        [2, 0],
      ],
    ],
  ] as [string, Point[]][])(
    '%s: the band stays within half the width of the line, and the mesh is sound',
    (_label, path) => {
      for (const curve of [false, true]) {
        const node = hedge({ path, curve, width: 1.2 })
        const line = hedgeLine(node)
        const centre = hedgeCentreline(node).points
        const away = ([x, z]: Point) =>
          Math.min(
            ...centre.slice(1).map((b, i) => {
              const a = centre[i] as Point
              const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
              const t = Math.min(
                1,
                Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)),
              )
              return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)
            }),
          )
        for (const rings of hedgeBands(line, node.width))
          for (const ring of rings)
            for (const point of ring) expect(away(point)).toBeLessThan(node.width / 2 + 1e-6)
        const { plan, meshes } = buildHedge(node, FLAT_GROUND)
        expect(trianglesOf(meshes)).toBe(plan.estimate.triangles)
        for (const mesh of meshes) {
          expect(mesh.position.every(Number.isFinite)).toBe(true)
          expect(mesh.normal.every(Number.isFinite)).toBe(true)
          // Nothing is thrown far from the line: the body, its bulge and a leaf at most.
          for (let i = 0; i < mesh.position.length; i += 3)
            expect(away([mesh.position[i] ?? 0, mesh.position[i + 2] ?? 0])).toBeLessThan(
              node.width / 2 + 0.45,
            )
        }
      }
    },
  )

  test('openings cut the line into planted runs and say what became of each', () => {
    const node = hedge({
      path: [
        [0, 0],
        [20, 0],
      ],
      gaps: [
        { at: 5, width: 1.2 },
        { at: 5.8, width: 1 },
        { at: 19.8, width: 1 },
        { at: 40, width: 1 },
      ],
    })
    const line = hedgeLine(node)

    expect(line.runs.map((run) => [run.from, run.to])).toEqual([
      [0, 4.4],
      [6.3, 19.3],
    ])
    expect(line.planted).toBeCloseTo(17.4, 9)
    expect(line.gaps.map((gap) => [gap.left, gap.note])).toEqual([
      [true, undefined],
      [true, 'joined with the opening before it'],
      [true, 'cut at an end of the line'],
      [false, 'outside the line'],
    ])
  })

  test('a stretch too short to plant between two openings is left open and named', () => {
    const line = hedgeLine(
      hedge({
        path: [
          [0, 0],
          [10, 0],
        ],
        gaps: [
          { at: 4, width: 1 },
          { at: 5.2, width: 1 },
        ],
      }),
    )

    expect(line.tooShort).toEqual([{ fromM: 4.5, toM: 4.7 }])
    expect(line.runs).toHaveLength(2)
  })

  test('a ring with no opening has no end; an opening over its seam leaves one run', () => {
    const square: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    const ring = hedgeLine(hedge({ path: square, closed: true }))
    const gated = hedgeLine(hedge({ path: square, closed: true, gaps: [{ at: 0.2, width: 1.5 }] }))

    expect(ring.closed).toBe(true)
    expect(ring.runs).toHaveLength(1)
    expect(ring.runs[0]?.ring).toBe(true)
    expect(hedgeBands(ring, 0.7)[0]).toHaveLength(2)
    expect(gated.runs).toHaveLength(1)
    expect(gated.runs[0]?.ring).toBe(false)
    expect(gated.planted).toBeCloseTo(gated.length - 1.5, 6)
  })

  test('two points on each other are no line', () => {
    const line = hedgeLine(
      hedge({
        path: [
          [1, 1],
          [1, 1],
        ],
      }),
    )
    expect(line.length).toBe(0)
    expect(line.runs).toEqual([])
    expect(
      buildHedge(
        hedge({
          path: [
            [1, 1],
            [1, 1],
          ],
        }),
        FLAT_GROUND,
      ).meshes,
    ).toEqual([])
  })
})

describe('the bounds of a hedge, whatever the node holds', () => {
  const far = HEDGE_LIMITS.maxCoordinate
  const longest = hedge({
    path: Array.from({ length: 64 }, (_, i) => [i % 2 ? far : -far, (i / 63) * 2 * far - far]),
    height: HEDGE_LIMITS.maxHeight,
    width: HEDGE_LIMITS.maxWidth,
    leafSize: HEDGE_LIMITS.minLeafSize,
    clip: 0,
    gaps: Array.from({ length: 16 }, (_, i) => ({ at: 1000 + i * 5000, width: 20 })),
  })

  test('the longest line a node can hold is cut into no more stations than the cap', () => {
    const line = hedgeLine(longest)
    const stations = line.runs.reduce((sum, run) => sum + run.stations.length, 0)

    expect(line.length).toBeGreaterThan(1_000_000)
    expect(stations).toBeLessThanOrEqual(HEDGE_MAX_STATIONS)
  })

  test('and is thinned to stay within the triangle cap, not cut short', () => {
    const { plan, meshes } = buildHedge(longest, FLAT_GROUND)

    expect(plan.withinBudget).toBe(true)
    expect(plan.estimate.triangles).toBeLessThanOrEqual(HEDGE_MAX_TRIANGLES)
    expect(trianglesOf(meshes)).toBe(plan.estimate.triangles)
    expect(plan.line.runs.at(-1)?.to).toBeCloseTo(plan.line.length, 3)
  })

  test('a generator whose own count is over the cap is not run', () => {
    let built = false
    registerHedgeForm({
      gen: 998,
      estimate: () => ({
        triangles: HEDGE_MAX_TRIANGLES + 1,
        vertices: 0,
        bodyTriangles: 0,
        leaves: 0,
        meshes: 1,
      }),
      build: () => {
        built = true
        return []
      },
    })
    const { plan, meshes } = buildHedge(hedge({ gen: 998 }), FLAT_GROUND)

    expect(plan.withinBudget).toBe(false)
    expect(meshes).toEqual([])
    expect(built).toBe(false)
    expect(() => registerHedgeForm(hedgeFormFor(998))).toThrow('already registered')
  })

  test('a hedge that names a generator this build does not know is drawn by the newest known', () => {
    expect(planHedge(hedge({ gen: 500 }), FLAT_GROUND).form.gen).toBe(998)
  })
})

describe('the form (generator 1)', () => {
  const samples: [string, Partial<HedgeNode>][] = [
    ['clipped', {}],
    ['loose', { clip: 0 }],
    ['half clipped, large leaves', { clip: 0.5, leafSize: 0.2 }],
    [
      'a ring',
      {
        path: [
          [0, 0],
          [8, 0],
          [8, 6],
          [0, 6],
        ],
        closed: true,
      },
    ],
    [
      'a ring with a gate',
      {
        path: [
          [0, 0],
          [8, 0],
          [8, 6],
          [0, 6],
        ],
        closed: true,
        gaps: [{ at: 4, width: 1.2 }],
      },
    ],
    [
      'long',
      {
        path: [
          [0, 0],
          [60, 0],
        ],
      },
    ],
    ['tall and wide', { height: 3, width: 1.6 }],
    ['curved', { curve: true }],
  ]

  test.each(samples)('%s: the count before building is exactly what is built', (_label, extra) => {
    const { plan, meshes } = buildHedge(hedge(extra), FLAT_GROUND)

    expect(trianglesOf(meshes)).toBe(plan.estimate.triangles)
    expect(verticesOf(meshes)).toBe(plan.estimate.vertices)
    expect(meshes.length).toBe(plan.estimate.meshes)
    expect(plan.estimate.triangles).toBeGreaterThan(0)
  })

  test('the same numbers and seed give the same bytes; another seed, another hedge', () => {
    const once = fingerprint(buildHedge(hedge(), FLAT_GROUND).meshes)

    expect(fingerprint(buildHedge(hedge(), FLAT_GROUND).meshes)).toBe(once)
    expect(fingerprint(buildHedge(hedge({ clip: 0 }), FLAT_GROUND).meshes)).toBe(
      fingerprint(buildHedge(hedge({ clip: 0 }), FLAT_GROUND).meshes),
    )
    expect(fingerprint(buildHedge(hedge({ seed: 8 }), FLAT_GROUND).meshes)).not.toBe(once)
    // Not the node's identity: the same hedge under another id is the same mesh.
    expect(fingerprint(buildHedge(hedge({ id: 'hedge_other' }), FLAT_GROUND).meshes)).toBe(once)
  })

  test('about 1,500 triangles a metre at the reference section', () => {
    const { plan } = buildHedge(
      hedge({
        path: [
          [0, 0],
          [20, 0],
        ],
      }),
      FLAT_GROUND,
    )
    const perMetre = plan.estimate.triangles / plan.line.planted

    expect(perMetre).toBeGreaterThan(1300)
    expect(perMetre).toBeLessThan(1700)
  })

  test('every mesh is position, normal and colour: finite, unit normals, colours within 0 to 1', () => {
    for (const [, extra] of samples) {
      for (const mesh of buildHedge(hedge(extra), FLAT_GROUND).meshes) {
        expect(Object.keys(mesh).sort()).toEqual([
          'bodyIndexCount',
          'color',
          'index',
          'normal',
          'position',
        ])
        expect(mesh.normal.length).toBe(mesh.position.length)
        expect(mesh.color.length).toBe(mesh.position.length)
        expect(mesh.position.every(Number.isFinite)).toBe(true)
        expect(mesh.color.every((value) => value >= 0 && value <= 1.0001)).toBe(true)
        for (let i = 0; i < mesh.normal.length; i += 3)
          expect(
            Math.hypot(mesh.normal[i] ?? 0, mesh.normal[i + 1] ?? 0, mesh.normal[i + 2] ?? 0),
          ).toBeCloseTo(1, 4)
        const vertices = mesh.position.length / 3
        expect(mesh.index.every((index) => index < vertices)).toBe(true)
      }
    }
  })

  test('the body comes first in the index, is one shared surface, and faces outward', () => {
    const [mesh] = buildHedge(
      hedge({
        path: [
          [0, 0],
          [4, 0],
        ],
      }),
      FLAT_GROUND,
    ).meshes
    if (!mesh) throw new Error('A hedge builds a mesh')
    const body = Array.from(mesh.index.slice(0, mesh.bodyIndexCount))
    const bodyVertices = new Set(body).size

    // Shared: far fewer vertices than three a triangle.
    expect(bodyVertices).toBeLessThan(body.length / 4)
    const at = (index: number) => [0, 1, 2].map((axis) => mesh.position[index * 3 + axis] ?? 0)
    for (let i = 0; i < body.length; i += 3) {
      const [a, b, c] = [at(body[i] ?? 0), at(body[i + 1] ?? 0), at(body[i + 2] ?? 0)]
      const [u, v] = [
        b.map((value, k) => value - (a[k] ?? 0)),
        c.map((value, k) => value - (a[k] ?? 0)),
      ]
      const face = [
        (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
        (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
        (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
      ]
      // Away from the centreline (z = 0) or upward: never toward the inside.
      const centre = a.map((value, k) => (value + (b[k] ?? 0) + (c[k] ?? 0)) / 3)
      const outward = (face[2] ?? 0) * (centre[2] ?? 0) + Math.max(0, face[1] ?? 0)
      const size = Math.hypot(face[0] ?? 0, face[1] ?? 0, face[2] ?? 0)
      if (size > 1e-9 && Math.abs(centre[2] ?? 0) > 0.05) expect(outward).toBeGreaterThan(-1e-9)
    }
  })

  test('two chunks of one run meet on the same ring of points and normals', () => {
    const { meshes } = buildHedge(
      hedge({
        path: [
          [0, 0],
          [30, 0],
        ],
      }),
      FLAT_GROUND,
    )
    expect(meshes.length).toBeGreaterThan(2)
    const [first, second] = meshes as [HedgeMesh, HedgeMesh]
    const columns = 13
    const bodyVertices = first.bodyIndexCount / 6 / (columns - 1) + 1
    const lastRing = (bodyVertices - 1) * columns * 3

    for (let i = 0; i < columns * 3; i++) {
      expect(second.position[i]).toBe(first.position[lastRing + i] as number)
      expect(second.normal[i]).toBe(first.normal[lastRing + i] as number)
    }
  })

  test('it is not a box: battered sides, a rounded arris, rounded ends, darker toward the base', () => {
    const node = hedge({
      path: [
        [0, 0],
        [6, 0],
      ],
      height: 1.2,
      width: 0.8,
    })
    const [mesh] = buildHedge(node, FLAT_GROUND).meshes
    if (!mesh) throw new Error('A hedge builds a mesh')
    const body = [...new Set(mesh.index.slice(0, mesh.bodyIndexCount))].map((index) => ({
      x: mesh.position[index * 3] ?? 0,
      y: mesh.position[index * 3 + 1] ?? 0,
      z: mesh.position[index * 3 + 2] ?? 0,
      light: mesh.color[index * 3 + 1] ?? 0,
    }))
    const middle = body.filter((vertex) => vertex.x > 2 && vertex.x < 4)
    const reach = (from: number, to: number) =>
      Math.max(...middle.filter((v) => v.y >= from && v.y <= to).map((v) => Math.abs(v.z)))

    // Narrower at the top than at the foot, and the top edge is not a square corner.
    expect(reach(0.9, 1.1)).toBeLessThan(reach(0, 0.3) - 0.02)
    expect(reach(1.15, 2)).toBeLessThan(reach(0.9, 1.1) - 0.03)
    // The ends close to almost nothing instead of ending in a wall.
    const reachBefore = (x: number) =>
      Math.max(...body.filter((vertex) => vertex.x < x).map((vertex) => Math.abs(vertex.z)))
    expect(reachBefore(0.004)).toBeLessThan(0.03)
    expect(reachBefore(0.05)).toBeLessThan(0.3)
    // Shade toward the base.
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    expect(mean(middle.filter((v) => v.y < 0.2).map((v) => v.light))).toBeLessThan(
      mean(middle.filter((v) => v.y > 0.9).map((v) => v.light)) * 0.8,
    )
  })

  test('loose is fuller and uneven where clipped is straight', () => {
    const tops = (clip: number) => {
      const { meshes } = buildHedge(
        hedge({
          path: [
            [0, 0],
            [12, 0],
          ],
          clip,
        }),
        FLAT_GROUND,
      )
      const heights = new Map<number, number>()
      for (const mesh of meshes)
        for (const index of new Set(mesh.index.slice(0, mesh.bodyIndexCount))) {
          const x = Math.round((mesh.position[index * 3] ?? 0) * 2)
          if (x < 4 || x > 20) continue
          heights.set(x, Math.max(heights.get(x) ?? 0, mesh.position[index * 3 + 1] ?? 0))
        }
      const values = [...heights.values()]
      return Math.max(...values) - Math.min(...values)
    }

    expect(tops(1)).toBeLessThan(0.05)
    expect(tops(0)).toBeGreaterThan(0.1)
  })
})

describe('a hedge on the ground', () => {
  const slope: GroundRead = { heightAt: (x) => x * 0.25 }
  const crossSlope: GroundRead = { heightAt: (_x, z) => z * 0.5 }

  /** The lowest body vertex near a station of a straight hedge along x, by side. */
  function feet(meshes: HedgeMesh[], x: number) {
    const near: { y: number; z: number }[] = []
    for (const mesh of meshes)
      for (const index of new Set(mesh.index.slice(0, mesh.bodyIndexCount)))
        if (Math.abs((mesh.position[index * 3] ?? 0) - x) < 0.12)
          near.push({ y: mesh.position[index * 3 + 1] ?? 0, z: mesh.position[index * 3 + 2] ?? 0 })
    const lowest = (side: 1 | -1) =>
      Math.min(...near.filter((vertex) => vertex.z * side > 0.2).map((vertex) => vertex.y))
    return { left: lowest(-1), right: lowest(1), top: Math.max(...near.map((vertex) => vertex.y)) }
  }

  test('follows a slope along its line: the base sits in the ground, the top rises with it', () => {
    const node = hedge({
      path: [
        [0, 0],
        [12, 0],
      ],
      height: 1.2,
      width: 0.8,
    })
    const { meshes } = buildHedge(node, slope)

    for (const x of [2, 6, 10]) {
      const { left, right, top } = feet(meshes, x)
      expect(left).toBeGreaterThan(x * 0.25 - HEDGE_EMBED - 0.04)
      expect(left).toBeLessThan(x * 0.25 + 0.04)
      expect(right).toBeCloseTo(left, 1)
      expect(top).toBeCloseTo(x * 0.25 + 1.2, 0)
    }
  })

  test('sits on a cross slope by both edges: neither floats, the top stays level across', () => {
    const node = hedge({
      path: [
        [0, 0],
        [8, 0],
      ],
      height: 1.2,
      width: 1,
    })
    const { left, right } = feet(buildHedge(node, crossSlope).meshes, 4)

    expect(left).toBeCloseTo(-0.25 - HEDGE_EMBED, 1)
    expect(right).toBeCloseTo(0.25 - HEDGE_EMBED, 1)
  })

  test('steps across a GroundRead discontinuity, with a station on each side of the face', () => {
    // Analytical two-plane oracle: no lab terrain nodes or terrain implementation.
    const ground: GroundRead = {
      heightAt: (x) => (x < 6 ? 2 : 0),
      regionAt: (x) => (x < 6 ? 'upper' : 'lower'),
    }
    const node = hedge({
      path: [
        [0, 0],
        [12, 0],
      ],
      width: 0.8,
    })
    const [run] = standHedgeLine(hedgeLine(node), node.width, ground)
    const stations = run?.stations ?? []
    const jump = stations.findIndex(
      (station, i) => i > 0 && Math.abs(station.yC - (stations[i - 1]?.yC ?? 0)) > 1,
    )
    const [before, after] = [stations[jump - 1], stations[jump]]

    expect(ground.regionAt).toBeDefined()
    expect(jump).toBeGreaterThan(0)
    // The whole height changes between two stations a few centimetres apart, at the face.
    expect(Math.abs((after?.yC ?? 0) - (before?.yC ?? 0))).toBeCloseTo(2, 6)
    expect((after?.x ?? 0) - (before?.x ?? 0)).toBeLessThan(0.05)
    expect(before?.x).toBeCloseTo(6, 1)
    // No station stands part of the way up the face, and the top steps with the ground.
    for (const station of stations) expect([0, 2]).toContain(Math.round(station.yC * 1000) / 1000)
    expect(Math.abs((after?.yTop ?? 0) - (before?.yTop ?? 0))).toBeCloseTo(2, 6)
  })

  test('an edge that would hang over a break keeps the ground under the centre', () => {
    const ground: GroundRead = {
      heightAt: (_x, z) => (z < 0.3 ? 1.5 : 0),
      regionAt: (_x, z) => (z < 0.3 ? 'upper' : 'lower'),
    }
    // A hedge 1 m wide whose centre is 30 cm from the top of the wall: one edge overhangs it.
    const node = hedge({
      path: [
        [-5, 0],
        [5, 0],
      ],
      width: 1,
    })
    const [run] = standHedgeLine(hedgeLine(node), node.width, ground)
    const middle = (run?.stations ?? []).filter((station) => Math.abs(station.x) < 3)
    const heights = new Set(middle.flatMap(({ yC, yL, yR }) => [yC, yL, yR]))

    expect(ground.heightAt(0, 0)).not.toBe(ground.heightAt(0, 0.5))
    expect(heights.size).toBe(1)
  })

  test('a supplied GroundRead preserves heights and regions; a missing reader uses the synthetic datum', () => {
    const source: GroundRead = {
      heightAt: (x) => x + 3,
      regionAt: (x) => (x < 0 ? 'west' : 'east'),
    }
    const ground = groundReadOf(source)
    expect([ground.heightAt(-1, 0), ground.heightAt(1, 0)]).toEqual([2, 4])
    expect([ground.regionAt?.(-1, 0), ground.regionAt?.(1, 0)]).toEqual(['west', 'east'])
    expect(groundReadOf(null).heightAt(20, -5)).toBe(0)
  })
})
