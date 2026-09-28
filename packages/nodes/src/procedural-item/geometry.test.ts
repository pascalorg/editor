import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import {
  bedRecipe,
  evaluateRecipe,
  ProceduralItemNode,
  parseRecipe,
  revolveIsClosed,
  shapeTriangles,
  shelfRecipe,
} from '@pascal-app/core/procedural-items'
import { Vector3 } from 'three'
import cabinetJson from '../../../core/src/procedural-items/__fixtures__/cabinet_two_doors_drawer.json'
import chandelierJson from '../../../core/src/procedural-items/__fixtures__/chandelier_six_arms.json'
import deskJson from '../../../core/src/procedural-items/__fixtures__/desk_fan.json'
import {
  acquireProceduralGeometry,
  buildProceduralGeometry,
  partAtFace,
  proceduralMetrics,
} from './geometry'

test('slot batching preserves pickable parts and dimensions', () => {
  for (const recipe of [shelfRecipe, bedRecipe]) {
    const node = ProceduralItemNode.parse({ recipe }),
      built = buildProceduralGeometry(node)
    expect(built.batches.length).toBe(recipe.slots.length)
    expect(built.triangles).toBeLessThan(100000)
    for (const batch of built.batches) {
      expect(partAtFace(batch.ranges, 0)).not.toBeNull()
      expect(batch.geometry.boundingBox!.isEmpty()).toBe(false)
      batch.geometry.dispose()
    }
  }
})
test('moves and paint share geometry; changed parameters rebuild; leases dispose at last release', () => {
  const node = ProceduralItemNode.parse({ recipe: shelfRecipe }),
    before = proceduralMetrics.builds
  const a = acquireProceduralGeometry(node),
    b = acquireProceduralGeometry({ ...node, position: [2, 0, 3], slots: { frame: '#123456' } })
  expect(a.value).toBe(b.value)
  expect(proceduralMetrics.builds - before).toBe(1)
  let disposals = 0
  for (const batch of a.value.batches) batch.geometry.addEventListener('dispose', () => disposals++)
  a.release()
  expect(disposals).toBe(0)
  b.release()
  expect(disposals).toBe(3)
  b.release()
  expect(disposals).toBe(3)
  const c = acquireProceduralGeometry({ ...node, parameters: { width: 2 } })
  expect(proceduralMetrics.builds - before).toBe(2)
  c.release()
  expect(proceduralMetrics.liveEntries).toBe(0)
})

test('moving batches separate per group and keep pick ranges local to each mesh', () => {
  const built = buildProceduralGeometry(
    ProceduralItemNode.parse({ recipe: parseRecipe(cabinetJson) }),
  )
  expect(built.evaluation.motions.map((motion) => motion.id)).toEqual([
    'doors',
    'doors~1',
    'drawer',
  ])
  expect(built.batches.filter((batch) => batch.motionGroup === 'doors').length).toBe(2)
  for (const batch of built.batches) {
    expect(partAtFace(batch.ranges, 0)).not.toBeNull()
    expect(batch.ranges.at(-1)!.end).toBe(batch.geometry.getAttribute('position').count / 3)
    if (batch.motionGroup) {
      const pivot = built.evaluation.motions.find(
        (motion) => motion.id === batch.motionGroup,
      )!.pivot
      expect(batch.motionGeometry).toBeDefined()
      for (const axis of ['x', 'y', 'z'] as const)
        expect(
          batch.geometry.boundingBox!.min[axis] - batch.motionGeometry!.boundingBox!.min[axis],
        ).toBeCloseTo(pivot[{ x: 0, y: 1, z: 2 }[axis]])
      batch.motionGeometry!.dispose()
    }
    batch.geometry.dispose()
  }
})

test('ellipsoid and tapered cylinder build curved geometry with bounded vertices', () => {
  const built = buildProceduralGeometry(ProceduralItemNode.parse({ recipe: parseRecipe(deskJson) }))
  expect(built.triangles).toBeGreaterThan(720)
  for (const batch of built.batches) {
    const points = batch.geometry.getAttribute('position')
    for (let i = 0; i < points.count; i += Math.max(1, Math.floor(points.count / 20))) {
      expect(Number.isFinite(points.getX(i))).toBe(true)
      expect(Number.isFinite(points.getY(i))).toBe(true)
      expect(Number.isFinite(points.getZ(i))).toBe(true)
    }
    batch.motionGeometry?.dispose()
    batch.geometry.dispose()
  }
})

test('light descriptors leave geometry batches and bounds unchanged', () => {
  const lit = parseRecipe(chandelierJson)
  const unlit = structuredClone(lit)
  delete unlit.parts[1]!.light
  const a = buildProceduralGeometry(ProceduralItemNode.parse({ recipe: lit }))
  const b = buildProceduralGeometry(ProceduralItemNode.parse({ recipe: unlit }))
  expect(a.evaluation.lights).toHaveLength(6)
  expect(b.evaluation.lights).toHaveLength(0)
  expect(a.evaluation.min).toEqual(b.evaluation.min)
  expect(a.evaluation.max).toEqual(b.evaluation.max)
  expect(a.batches.map((batch) => batch.slot)).toEqual(b.batches.map((batch) => batch.slot))
  for (const built of [a, b])
    for (const batch of built.batches) {
      batch.motionGeometry?.dispose()
      batch.geometry.dispose()
    }
})

test('evaluated triangle counts equal the triangles the renderer builds', () => {
  const dir = new URL('../../../core/src/procedural-items/__fixtures__/', import.meta.url)
  // The E3 kitchen run is the committed R7 refusal case (37.9 KB), not a parsable design.
  const fixtures = readdirSync(dir)
    .filter((file) => !file.startsWith('trial_e3_'))
    .map((file) => parseRecipe(JSON.parse(readFileSync(new URL(file, dir), 'utf8'))))
  expect(fixtures.length).toBeGreaterThanOrEqual(9)
  const every = parseRecipe({
    version: 2,
    name: 'Every primitive',
    description: 'One of each primitive, including a cone.',
    parameters: [
      { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
    ],
    slots: [{ id: 'body', label: 'Body', color: '#888888' }],
    parts: [
      {
        id: 'all',
        label: 'All',
        count: 2,
        shapes: [
          {
            id: 'box',
            primitive: 'box',
            slot: 'body',
            size: [0.1, 0.1, 0.1],
            position: [0, 0.05, 0],
          },
          {
            id: 'round',
            primitive: 'roundedBox',
            slot: 'body',
            size: [0.1, 0.1, 0.1],
            position: [0.2, 0.05, 0],
            radius: 0.01,
          },
          {
            id: 'tube',
            primitive: 'cylinder',
            slot: 'body',
            size: [0.1, 0.1, 0.1],
            position: [0.4, 0.05, 0],
            topScale: 0.5,
          },
          {
            id: 'cone',
            primitive: 'cylinder',
            slot: 'body',
            size: [0.1, 0.1, 0.1],
            position: [0.6, 0.05, 0],
            topScale: 0,
          },
          {
            id: 'ball',
            primitive: 'ellipsoid',
            slot: 'body',
            size: [0.1, 0.1, 0.1],
            position: [0.8, 0.05, 0],
          },
        ],
      },
    ],
    constraints: [],
  })
  for (const recipe of [every, shelfRecipe, bedRecipe, ...fixtures]) {
    const built = buildProceduralGeometry(ProceduralItemNode.parse({ recipe }))
    expect(built.evaluation.triangles).toBe(built.triangles)
    for (const batch of built.batches) batch.geometry.dispose()
  }
})

test('v2 cylinder options build exactly the triangles they are charged', () => {
  const variants: Record<string, unknown>[] = [
    { segments: 6 },
    { segments: 8, topScale: 0.6 },
    { segments: 4, topScale: 0 },
    { open: true },
    { inner: 0.8 },
    { inner: 0.8, open: true },
    { inner: 0.7, topScale: 0.5, segments: 12 },
    { inner: 0.7, topScale: 0 },
    { arc: Math.PI },
    { arc: Math.PI, open: true },
    { arc: Math.PI / 2, topScale: 0 },
    { arc: Math.PI, inner: 0.9, segments: 16 },
  ]
  const recipe = parseRecipe({
    version: 2,
    name: 'Cylinder options',
    description: 'Every cylinder option.',
    parameters: [
      { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
    ],
    slots: [{ id: 'body', label: 'Body', color: '#888888' }],
    parts: [
      {
        id: 'all',
        label: 'All',
        count: 1,
        shapes: variants.map((options, i) => ({
          id: `c${i}`,
          primitive: 'cylinder',
          slot: 'body',
          size: [0.1, 0.2, 0.1],
          position: [i * 0.2, 0.1, 0],
          ...options,
        })),
      },
    ],
    constraints: [],
  })
  const built = buildProceduralGeometry(ProceduralItemNode.parse({ recipe }))
  expect(built.triangles).toBe(built.evaluation.triangles)
  // Each shape's triangles, read back from the batch ranges, match its own count.
  const ranges = built.batches[0]!.ranges
  const counts = ranges.map((range, i) => range.end - (ranges[i - 1]?.end ?? 0))
  const expected = built.evaluation.shapes.map((shape) => shapeTriangles(shape))
  expect(counts).toEqual(expected)
  // Every vertex stays inside its evaluated box; normals are unit length.
  const box = built.batches[0]!.geometry
  box.computeBoundingBox()
  expect(box.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6)
  expect(box.boundingBox!.max.y).toBeLessThanOrEqual(0.2 + 1e-6)
  const normal = box.getAttribute('normal')
  for (let i = 0; i < normal.count; i++) {
    const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
    if (length > 0) expect(length).toBeCloseTo(1, 4)
  }
  for (const batch of built.batches) batch.geometry.dispose()
})

test('a six-segment cylinder is an exact hexagonal prism', () => {
  const recipe = parseRecipe({
    version: 2,
    name: 'Hex',
    description: 'A hexagonal bolt head.',
    parameters: [
      { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
    ],
    slots: [{ id: 'body', label: 'Body', color: '#888888' }],
    parts: [
      {
        id: 'head',
        label: 'Head',
        count: 1,
        shapes: [
          {
            id: 'hex',
            primitive: 'cylinder',
            slot: 'body',
            size: [0.1, 0.04, 0.1],
            position: [0, 0.02, 0],
            segments: 6,
          },
        ],
      },
    ],
    constraints: [],
  })
  const geometry = buildProceduralGeometry(ProceduralItemNode.parse({ recipe })).batches[0]!
    .geometry
  const position = geometry.getAttribute('position')
  const radii = new Set<string>()
  for (let i = 0; i < position.count; i++) {
    const r = Math.hypot(position.getX(i), position.getZ(i))
    if (r > 1e-6) radii.add(r.toFixed(6))
  }
  expect([...radii]).toEqual(['0.050000'])
  geometry.dispose()
})

test('extrusions build the triangles they are charged and fill their evaluated box', () => {
  const counter = {
    kind: 'polygon',
    outer: [
      [0, 0],
      [1.2, 0],
      [1.2, 0.03],
      [0, 0.03],
    ],
    holes: [
      [
        [0.3, 0.005],
        [0.8, 0.005],
        [0.8, 0.025],
        [0.3, 0.025],
      ],
    ],
  }
  const variants: Record<string, unknown>[] = [
    { section: { kind: 'rectangle', width: 0.4, depth: 0.2 } },
    { section: { kind: 'rectangle', width: 0.4, depth: 0.2, corner: 0.03 } },
    { section: { kind: 'rectangle', width: 0.4, depth: 0.2, corner: 0.1 } },
    { section: { kind: 'round', radius: 0.05 } },
    { section: { kind: 'round', radius: 0.05, wall: 0.004 } },
    { section: { kind: 'oval', width: 0.3, depth: 0.1 } },
    { section: counter },
    { section: { kind: 'rectangle', width: 0.4, depth: 0.2 }, bevel: 0.01 },
    { section: counter, bevel: 0.002 },
  ]
  const recipe = parseRecipe({
    version: 2,
    name: 'Extrusions',
    description: 'Every section kind.',
    parameters: [
      { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
    ],
    slots: [{ id: 'body', label: 'Body', color: '#888888' }],
    parts: variants.map((options, i) => ({
      id: `p${i}`,
      label: `P${i}`,
      count: 1,
      shapes: [
        {
          id: 'e',
          primitive: 'extrude',
          slot: 'body',
          length: 0.5,
          position: [i * 2, 0.3, 0],
          ...options,
        },
      ],
    })),
    constraints: [],
  })
  for (const [i, shape] of evaluateRecipe(recipe).shapes.entries()) {
    const single = parseRecipe({ ...recipe, parts: [recipe.parts[i]!] })
    const built = buildProceduralGeometry(ProceduralItemNode.parse({ recipe: single }))
    expect(built.triangles).toBe(shapeTriangles(shape))
    const geometry = built.batches[0]!.geometry
    geometry.computeBoundingBox()
    const extent = built.evaluation.max.map((v, k) => v - built.evaluation.min[k]!)
    const size = geometry.boundingBox!.getSize(new Vector3()).toArray()
    for (const [k, v] of size.entries()) expect(v).toBeCloseTo(extent[k]!, 5)
    for (const batch of built.batches) batch.geometry.dispose()
  }
})

test('v2 cylinders keep world-scale UVs on every face, wedges and rings included', () => {
  const recipe = parseRecipe({
    version: 2,
    name: 'Wedge',
    description: 'A hollow quarter sweep.',
    parameters: [
      { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
    ],
    slots: [{ id: 'body', label: 'Body', color: '#888888' }],
    parts: [
      {
        id: 'p',
        label: 'P',
        count: 1,
        shapes: [
          {
            id: 'c',
            primitive: 'cylinder',
            slot: 'body',
            size: [0.4, 0.3, 0.4],
            position: [0, 0.15, 0],
            arc: Math.PI / 4,
            inner: 0.5,
            segments: 8,
          },
        ],
      },
    ],
    constraints: [],
  })
  const geometry = buildProceduralGeometry(ProceduralItemNode.parse({ recipe })).batches[0]!
    .geometry
  const position = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv'),
    normal = geometry.getAttribute('normal')
  const p = [new Vector3(), new Vector3(), new Vector3()]
  for (let t = 0; t < position.count; t += 3) {
    for (let k = 0; k < 3; k++) p[k]!.fromBufferAttribute(position, t + k)
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const metres = p[a]!.distanceTo(p[b]!)
      const uvs = Math.hypot(uv.getX(t + a) - uv.getX(t + b), uv.getY(t + a) - uv.getY(t + b))
      if (metres > 1e-6) expect(uvs / metres).toBeCloseTo(1, 4)
    }
  }
  for (let i = 0; i < normal.count; i++)
    expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 4)
  geometry.dispose()
})

test('extrusions keep world-scale UVs on angled walls', () => {
  const recipe = parseRecipe({
    version: 2,
    name: 'Chamfer',
    description: 'A section with a 45° wall.',
    parameters: [
      { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
    ],
    slots: [{ id: 'body', label: 'Body', color: '#888888' }],
    parts: [
      {
        id: 'p',
        label: 'P',
        count: 1,
        shapes: [
          {
            id: 'e',
            primitive: 'extrude',
            slot: 'body',
            section: {
              kind: 'polygon',
              outer: [
                [0, 0],
                [0.4, 0],
                [0.4, 0.2],
                [0.2, 0.4],
                [0, 0.4],
              ],
            },
            length: 0.5,
            position: [0, 0.5, 0],
          },
        ],
      },
    ],
    constraints: [],
  })
  const geometry = buildProceduralGeometry(ProceduralItemNode.parse({ recipe })).batches[0]!
    .geometry
  const position = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv')
  const p = [new Vector3(), new Vector3(), new Vector3()]
  for (let t = 0; t < position.count; t += 3) {
    for (let k = 0; k < 3; k++) p[k]!.fromBufferAttribute(position, t + k)
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const metres = p[a]!.distanceTo(p[b]!)
      const uvs = Math.hypot(uv.getX(t + a) - uv.getX(t + b), uv.getY(t + a) - uv.getY(t + b))
      if (metres > 1e-6) expect(uvs / metres).toBeCloseTo(1, 4)
    }
  }
  geometry.dispose()
})

test('revolves build the triangles they are charged, with outward normals on solids', () => {
  const baluster = [
    [0, 0],
    [0.02, 0],
    [0.02, 0.08],
    [0.012, 0.12],
    [0.016, 0.4],
    [0.02, 0.7],
    [0.012, 0.75],
    [0.02, 0.8],
    [0.02, 0.86],
    [0, 0.86],
  ]
  const shade = [
    [0.082, 0],
    [0.102, 0.014],
    [0.115, 0.05],
    [0.119, 0.091],
    [0.114, 0.149],
    [0.092, 0.192],
    [0.058, 0.224],
    [0.025, 0.235],
  ]
  const variants: Record<string, unknown>[] = [
    { profile: baluster },
    { profile: [...baluster].reverse(), segments: 12 },
    { profile: shade },
    { profile: shade, arc: Math.PI, segments: 8 },
    { profile: baluster, arc: Math.PI / 2 },
  ]
  for (const options of variants) {
    const recipe = parseRecipe({
      version: 2,
      name: 'Revolve',
      description: 'A turned shape.',
      parameters: [
        { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
      ],
      slots: [{ id: 'body', label: 'Body', color: '#888888' }],
      parts: [
        {
          id: 'p',
          label: 'P',
          count: 1,
          shapes: [
            { id: 'r', primitive: 'revolve', slot: 'body', position: [0, 0, 0], ...options },
          ],
        },
      ],
      constraints: [],
    })
    const built = buildProceduralGeometry(ProceduralItemNode.parse({ recipe }))
    expect(built.triangles).toBe(built.evaluation.triangles)
    const geometry = built.batches[0]!.geometry
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new Vector3())
    expect(size.y).toBeCloseTo(built.evaluation.shapes[0]!.size[1], 6)
    if (revolveIsClosed(built.evaluation.shapes[0]!)) {
      // Solid: every side-wall normal points away from the axis.
      const position = geometry.getAttribute('position'),
        normal = geometry.getAttribute('normal')
      let outward = 0,
        inward = 0
      for (let i = 0; i < position.count; i++) {
        const dot = position.getX(i) * normal.getX(i) + position.getZ(i) * normal.getZ(i)
        if (dot > 1e-6) outward++
        else if (dot < -1e-6) inward++
      }
      expect(inward).toBe(0)
      expect(outward).toBeGreaterThan(0)
    }
    for (const batch of built.batches) batch.geometry.dispose()
  }
})

test('a revolve puts every vertex on its profile: radius and height as authored', () => {
  const profile: [number, number][] = [
    [0, 0],
    [0.03, 0],
    [0.02, 0.2],
    [0.05, 0.5],
    [0, 0.6],
  ]
  const recipe = parseRecipe({
    version: 2,
    name: 'Turned',
    description: 'A turned profile.',
    parameters: [
      { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
    ],
    slots: [{ id: 'body', label: 'Body', color: '#888888' }],
    parts: [
      {
        id: 'p',
        label: 'P',
        count: 1,
        shapes: [
          {
            id: 'r',
            primitive: 'revolve',
            slot: 'body',
            profile,
            position: [0, 0, 0],
            segments: 12,
          },
        ],
      },
    ],
    constraints: [],
  })
  const geometry = buildProceduralGeometry(ProceduralItemNode.parse({ recipe })).batches[0]!
    .geometry
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const r = Math.hypot(position.getX(i), position.getZ(i)),
      y = position.getY(i)
    expect(profile.some(([pr, py]) => Math.abs(pr - r) < 1e-6 && Math.abs(py - y) < 1e-6)).toBe(
      true,
    )
  }
  geometry.dispose()
})
