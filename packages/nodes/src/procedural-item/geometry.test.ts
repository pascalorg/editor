import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import {
  bedRecipe,
  ProceduralItemNode,
  parseRecipe,
  shapeTriangles,
  shelfRecipe,
} from '@pascal-app/core/procedural-items'
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
