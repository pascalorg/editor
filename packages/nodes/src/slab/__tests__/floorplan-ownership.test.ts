import { expect, test } from 'bun:test'
import { type FloorplanGeometry, type GeometryContext, SlabNode } from '@pascal-app/core'
import { buildSlabFloorplan, slabOutlineEditable } from '../floorplan'

// UX round point 4: a floor plate's outline and room-cut holes follow the rooms,
// so the plan offers no ring or hole handles on it — as the 3D view hides them.

const context = {
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: null,
  viewState: { selected: true },
} as unknown as GeometryContext

const square: [number, number][] = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
]
const hole: [number, number][] = [
  [2, 1],
  [3, 1],
  [3, 2],
  [2, 2],
]

const handles = (geometry: FloorplanGeometry | null): number => {
  if (!geometry) return 0
  if (geometry.kind === 'group') return geometry.children.reduce((n, c) => n + handles(c), 0)
  return geometry.kind.endsWith('-handle') ? 1 : 0
}

test('a hand-drawn slab keeps its outline and hole handles; floor plates have none', () => {
  const manual = SlabNode.parse({ polygon: square, holes: [hole] })
  const base = SlabNode.parse({
    polygon: square,
    holes: [hole],
    boundary: 'auto',
    plateRole: 'base',
  })
  const platform = SlabNode.parse({ polygon: square, autoFromWalls: true, plateRole: 'platform' })
  expect(slabOutlineEditable(manual)).toBe(true)
  expect(slabOutlineEditable(base)).toBe(false)
  expect(slabOutlineEditable(platform)).toBe(false)
  expect(handles(buildSlabFloorplan(manual, context))).toBeGreaterThan(0)
  expect(handles(buildSlabFloorplan(base, context))).toBe(0)
  expect(handles(buildSlabFloorplan(platform, context))).toBe(0)
})
