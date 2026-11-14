import { expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, LevelNode, WallNode } from '@pascal-app/core'
import { normalizePersistedEditorLayoutState } from '../../store/use-editor'
import { adjacentWallLevels, adjacentWallOutlines } from './floorplan-adjacent-walls-layer'

function house() {
  const building = BuildingNode.parse({ id: 'building_adj' })
  const levels = ['ground', 'upper', 'roof'].map((name, level) =>
    LevelNode.parse({
      id: `level_adj_${name}`,
      parentId: building.id,
      level,
      height: 3,
      ...(name === 'roof' ? { metadata: { role: 'roof' } } : {}),
    }),
  )
  building.children = levels.map((level) => level.id)
  const walls = [
    WallNode.parse({
      id: 'wall_adj_a',
      parentId: levels[1]!.id,
      start: [0, 0],
      end: [6, 0],
      thickness: 0.2,
    }),
    WallNode.parse({
      id: 'wall_adj_b',
      parentId: levels[1]!.id,
      start: [6, 0],
      end: [6, 4],
      thickness: 0.2,
    }),
    WallNode.parse({ id: 'wall_adj_c', parentId: levels[0]!.id, start: [0, 0], end: [6, 0] }),
  ]
  return Object.fromEntries(
    [building, ...levels, ...walls].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
}

test('the roof plan traces the top storey’s walls below, both faces, joined at the corner', () => {
  const nodes = house()
  expect(adjacentWallLevels(nodes, 'level_adj_roof', { below: true, above: true })).toEqual({
    below: 'level_adj_upper',
    above: null,
  })
  expect(adjacentWallLevels(nodes, 'level_adj_upper', { below: true, above: false })).toEqual({
    below: 'level_adj_ground',
    above: null,
  })
  const outlines = adjacentWallOutlines(nodes, 'level_adj_upper')
  expect(outlines.map((outline) => outline.id).sort()).toEqual(['wall_adj_a', 'wall_adj_b'])
  const points = outlines
    .find((outline) => outline.id === 'wall_adj_a')!
    .points.split(' ')
    .map((pair) => pair.split(',').map(Number) as [number, number])
  const zs = points.map(([, z]) => z)
  // Both faces of the 0.2 m wall, and mitred into the corner at x = 6 (past the centreline).
  expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.2)
  expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(6.1)
})

test('walls below start on for the roof plan and off for the floor plans, each kept as set', () => {
  const fresh = normalizePersistedEditorLayoutState(undefined)
  expect(fresh.showRoofWallsBelow).toBe(true)
  expect(fresh.showWallsBelow).toBe(false)
  // Saved before the roof plan had its own setting: the roof plan still starts on.
  expect(normalizePersistedEditorLayoutState({ showWallsBelow: false }).showRoofWallsBelow).toBe(
    true,
  )
  const turnedOff = normalizePersistedEditorLayoutState({
    showRoofWallsBelow: false,
    showWallsBelow: true,
  })
  expect(turnedOff.showRoofWallsBelow).toBe(false)
  expect(turnedOff.showWallsBelow).toBe(true)
})
