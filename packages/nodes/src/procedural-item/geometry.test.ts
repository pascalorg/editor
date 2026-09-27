import { expect, test } from 'bun:test'
import {
  bedRecipe,
  ProceduralItemNode,
  parseRecipe,
  type Recipe,
  shelfRecipe,
  validateDesign,
} from '@pascal-app/core/procedural-items'
import cabinetJson from '../../../core/src/procedural-items/__fixtures__/cabinet_two_doors_drawer.json'
import ceilingFanJson from '../../../core/src/procedural-items/__fixtures__/ceiling_fan.json'
import chandelierJson from '../../../core/src/procedural-items/__fixtures__/chandelier_six_arms.json'
import deskJson from '../../../core/src/procedural-items/__fixtures__/desk_fan.json'
import condenserJson from '../../../core/src/procedural-items/__fixtures__/trial-e1-condenser.json'
import airHandlerJson from '../../../core/src/procedural-items/__fixtures__/trial-e2-air-handler.json'
import louverJson from '../../../core/src/procedural-items/__fixtures__/trial-e5-louver.json'
import stairGuardJson from '../../../core/src/procedural-items/__fixtures__/trial-e8-stair-guard.json'
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

test('validateDesign reports the triangles and draw groups this builder produces', () => {
  const primitives = parseRecipe({
    version: 1,
    name: 'Primitives',
    description: 'One of each primitive, including a cone.',
    parameters: [
      { id: 'size', label: 'Size', default: 0.2, min: 0.1, max: 0.4, step: 0.1, unit: 'm' },
    ],
    slots: [{ id: 'paint', label: 'Paint', color: '#888888' }],
    parts: [
      {
        id: 'row',
        label: 'Row',
        count: 1,
        shapes: (['box', 'roundedBox', 'cylinder', 'ellipsoid'] as const).map((primitive, i) => ({
          id: `s${i}`,
          primitive,
          slot: 'paint',
          size: ['size', 'size', 'size'],
          position: [i * 0.5, 0.2, 0],
        })),
      },
      {
        id: 'cone',
        label: 'Cone',
        count: 1,
        shapes: [
          {
            id: 'tip',
            primitive: 'cylinder',
            slot: 'paint',
            size: [0.2, 0.2, 0.2],
            position: [2, 0.1, 0],
            topScale: 0,
          },
        ],
      },
    ],
    constraints: [],
  } satisfies Recipe)
  const recipes = [
    primitives,
    shelfRecipe,
    bedRecipe,
    ...[cabinetJson, ceilingFanJson, chandelierJson, deskJson].map(parseRecipe),
    ...[condenserJson, airHandlerJson, louverJson, stairGuardJson].map(parseRecipe),
  ]
  for (const recipe of recipes) {
    const built = buildProceduralGeometry(ProceduralItemNode.parse({ recipe }))
    const measured = validateDesign(recipe).measurements!
    expect(measured.triangles.actual).toBe(built.triangles)
    expect(
      measured.drawGroups.map(({ slot, motionGroup, triangles }) => [slot, motionGroup, triangles]),
    ).toEqual(
      built.batches.map((batch) => [
        batch.slot,
        batch.motionGroup ?? null,
        batch.geometry.getAttribute('position').count / 3,
      ]),
    )
    for (const batch of built.batches) {
      batch.motionGeometry?.dispose()
      batch.geometry.dispose()
    }
  }
})
