import { expect, test } from 'bun:test'
import { CeilingNode } from '../schema/nodes/ceiling'
import { LevelNode } from '../schema/nodes/level'
import { WallNode } from '../schema/nodes/wall'
import { shelfRecipe } from './fixtures'
import { prepareProceduralPlacement } from './integration'
import { ProceduralItemNode } from './node'
import { resolveProceduralCeilingPlacement } from './placement'
import {
  nodeLevelFrame,
  proceduralLocalPose,
  queryProceduralItem,
  validateProceduralRelations,
} from './query'
import { parseRecipe, sweepRecipe } from './recipe'

const recipe = parseRecipe({
  ...shelfRecipe,
  mounting: { attachTo: 'ceiling', reference: 'top' },
  surfaces: [{ id: 'top', label: 'Top', position: [0.2, 'height', 0.1], size: [0.2, 0.2] }],
})
const level = LevelNode.parse({ id: 'level_hanging', height: 3 })
const ceiling = CeilingNode.parse({
  id: 'ceiling_hanging',
  parentId: level.id,
  polygon: [
    [-4, -4],
    [4, -4],
    [4, 4],
    [-4, 4],
  ],
})
const node = ProceduralItemNode.parse({
  id: 'procedural-item_hanging',
  recipe,
  parentId: ceiling.id,
  position: [1, 0, 2],
  rotation: [0, Math.PI / 2, 0],
})
const nodes = { [level.id]: level, [ceiling.id]: ceiling, [node.id]: node }

test('ceiling references face +Y at the evaluated top across parameter ranges', () => {
  expect(sweepRecipe(recipe).every((entry) => entry.valid)).toBe(true)
  for (const surface of [
    { ...recipe.surfaces![0], rotation: [Math.PI, 0, 0] },
    { ...recipe.surfaces![0], position: [0, 0.2, 0] },
    { ...recipe.surfaces![0], part: 'frame' },
  ])
    expect(() => parseRecipe({ ...recipe, surfaces: [surface] })).toThrow()
})

test('ceiling pose subtracts the rotated top reference and composes the actual underside frame', () => {
  validateProceduralRelations(node, nodes)
  const pose = proceduralLocalPose(node, nodes)
  expect(pose.position[0]).toBeCloseTo(0.9)
  expect(pose.position[1]).toBeCloseTo(-1.8)
  expect(pose.position[2]).toBeCloseTo(2.2)
  expect(pose.rotation).toEqual(node.rotation)
  const query = queryProceduralItem(node, nodes)
  expect(query.hostId).toBe(ceiling.id)
  expect(query.levelBounds.max[1]).toBeCloseTo(2.98)
  query.surfaces
    .find((s) => s.id === 'top')!
    .frame.position.forEach((value, index) => {
      expect(value).toBeCloseTo([1, 2.98, 2][index]!)
    })
  expect(
    nodeLevelFrame(ceiling.id, { ...nodes, [ceiling.id]: { ...ceiling, height: 2.6 } }).position[1],
  ).toBeCloseTo(2.59)
  const taller = { ...nodes, [level.id]: { ...level, height: 4 } }
  expect(queryProceduralItem(node, taller).levelBounds.max[1]).toBeCloseTo(3.98)
  expect(
    queryProceduralItem(ProceduralItemNode.parse(JSON.parse(JSON.stringify(node))), nodes),
  ).toEqual(query)
})

test('ceiling hosting rejects wrong parents, tilt, non-flush tops and designs below level ground', () => {
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [5, 0] })
  const scene = { ...nodes, [wall.id]: wall }
  for (const patch of [
    { parentId: level.id },
    { parentId: wall.id, wallId: wall.id },
    { rotation: [0.1, 0, 0] },
    { rotation: [0, 0, 0.1] },
    { position: [1, -0.1, 2] },
    { wallId: wall.id },
    { side: 'front' },
  ])
    expect(() =>
      validateProceduralRelations({ ...node, ...patch } as ProceduralItemNode, scene),
    ).toThrow()
  expect(() =>
    validateProceduralRelations(node, { ...nodes, [ceiling.id]: { ...ceiling, height: 1 } }),
  ).toThrow('level height')
  expect(() => validateProceduralRelations({ ...node, recipe: shelfRecipe }, nodes)).toThrow(
    'floor design',
  )
  expect(() =>
    validateProceduralRelations({ ...node, parentId: level.id, metadata: { isNew: true } }, nodes),
  ).not.toThrow()
})

test('full rotated footprint must fit, including holes away from its center and concave notches', () => {
  const centered = resolveProceduralCeilingPlacement(node, ceiling, 0.2, 0.1, 0)
  const scene = {
    ...nodes,
    [ceiling.id]: {
      ...ceiling,
      holes: [
        [
          [0.4, -0.1],
          [0.5, -0.1],
          [0.5, 0.1],
          [0.4, 0.1],
        ],
      ],
    },
  }
  expect(() => validateProceduralRelations(centered, scene as typeof nodes)).toThrow('holes')
  expect(() =>
    validateProceduralRelations(resolveProceduralCeilingPlacement(node, ceiling, 4, 0), nodes),
  ).toThrow('inside')
  const concave = {
    ...ceiling,
    polygon: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [0.1, 2],
      [0.1, 0],
      [-0.1, 0],
      [-0.1, 2],
      [-2, 2],
    ],
  }
  expect(() =>
    validateProceduralRelations(centered, { ...nodes, [ceiling.id]: concave } as typeof nodes),
  ).toThrow('inside')
  const fitted = {
    ...ceiling,
    polygon: [
      [-0.6, -0.2],
      [0.6, -0.2],
      [0.6, 0.2],
      [-0.6, 0.2],
    ],
  }
  expect(() =>
    validateProceduralRelations(centered, { ...nodes, [ceiling.id]: fitted } as typeof nodes),
  ).not.toThrow()
})

test('placement keeps the ceiling contract', () => {
  const placed = prepareProceduralPlacement(recipe, nodes, {
    parentId: ceiling.id,
    position: [0, 0, 0],
  })
  expect(placed.wallId).toBeUndefined()
  expect(placed.parentId).toBe(ceiling.id)
  expect(CeilingNode.parse({ ...ceiling, children: [node.id] }).children).toEqual([node.id])
})
