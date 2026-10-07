import { expect, test } from 'bun:test'
import { DoorNode, WallNode, WindowNode } from '@pascal-app/core'
import { buildCurtainWallFloorplan } from './curtain-wall-floorplan'
import { buildWallFloorplan } from './floorplan'

test('curtain walls keep selection controls and show separate glass and frame shapes in plan', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0], height: 3, wallType: 'curtain' })
  const geometry = buildWallFloorplan(wall, {
    children: [],
    parent: null,
    siblings: [wall],
    resolve: () => undefined,
    viewState: {
      selected: true,
      highlighted: false,
      hovered: false,
      moving: false,
      unit: 'metric',
    },
  })
  expect(geometry?.kind).toBe('group')
  if (geometry?.kind !== 'group') throw new Error('Expected wall group')
  expect(
    geometry.children.some((shape) => shape.kind === 'polygon' && shape.fill === '#a9d5df'),
  ).toBe(true)
  expect(
    geometry.children.some((shape) => shape.kind === 'polygon' && shape.fill === '#303942'),
  ).toBe(true)
  expect(geometry.children.some((shape) => shape.kind === 'endpoint-handle')).toBe(true)
})

test('plan cuts skip hosted door spans', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0], height: 3, wallType: 'curtain' })
  const door = DoorNode.parse({ position: [1.5, 1.05, 0], width: 0.9, height: 2.1 })
  const shapes = buildCurtainWallFloorplan(wall, 3, '#000000', [door])
  for (const shape of shapes) {
    if (shape.kind !== 'polygon') continue
    const min = Math.min(...shape.points.map((p) => p[0]))
    const max = Math.max(...shape.points.map((p) => p[0]))
    expect(max <= 1.05 + 1e-6 || min >= 1.95 - 1e-6).toBe(true)
  }
})

test('entrance jambs appear in plan on both sides of the door', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0], height: 3, wallType: 'curtain' })
  const door = DoorNode.parse({ position: [1.5, 1.05, 0], width: 0.9, height: 2.1 })
  const shapes = buildCurtainWallFloorplan(wall, 3, '#000000', [door])
  for (const x of [1.025, 1.975]) {
    expect(
      shapes.some(
        (shape) =>
          shape.kind === 'polygon' &&
          shape.fill === '#303942' &&
          Math.min(...shape.points.map((point) => point[0])) < x &&
          Math.max(...shape.points.map((point) => point[0])) > x,
      ),
    ).toBe(true)
  }
})

test('arched window plan follows the curved section and retains glass beside its shoulders', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0], height: 3, wallType: 'curtain' })
  const opening = WindowNode.parse({
    position: [2.25, 0.65, 0],
    width: 1,
    height: 1.3,
    openingShape: 'arch',
    archHeight: 0.9,
  })
  const shapes = buildCurtainWallFloorplan(wall, 3, '#000', [opening])
  const at = (x: number, fill: string) =>
    shapes.some(
      (shape) =>
        shape.kind === 'polygon' &&
        shape.fill === fill &&
        Math.min(...shape.points.map((p) => p[0])) < x &&
        Math.max(...shape.points.map((p) => p[0])) > x,
    )
  expect(at(1.8, '#a9d5df')).toBe(true)
  expect(at(2.25, '#a9d5df')).toBe(false)
  expect(
    shapes.filter((shape) => shape.kind === 'polygon' && shape.fill === '#303942').length,
  ).toBeGreaterThan(0)
})
