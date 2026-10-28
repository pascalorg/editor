// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  calculateLevelMiters,
  createTerrainField,
  encodeTerrainField,
  foundationRimSteps,
  LevelNode,
  SiteNode,
  SlabNode,
  WALL_SURFACE_SLOT_DEFAULTS,
  WallNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { getWallFinishRefs } from './wall-finish-data'
import { generateExtrudedWall } from './wall-system'

const IN = 0.0254

/** Whether a ray straight through the wall (across its thickness) at (x, y) hits the wall. */
function solidAt(geometry: THREE.BufferGeometry, x: number, y: number): boolean {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1))
  return ray.intersectObject(mesh).length > 0
}

/**
 * A raised 10 × 8 m house on ground falling 1.2 m west to east, its floor seated 19.5 in over the
 * high side: past 36 in of stem its south side drops its stem under cripple walls.
 */
function fallingHouse() {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1)
    for (let col = 0; col < field.cols; col += 1)
      heights[row * field.cols + col] = Math.round((10 - (field.origin[0] + col)) * 12)
  const corners: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_g_${index}`,
      parentId: 'level_g',
      start,
      end: corners[(index + 1) % 4],
      thickness: 0.1,
    }),
  )
  const nodes = [
    SiteNode.parse({
      id: 'site_a',
      children: ['building_a'],
      terrain: encodeTerrainField({ ...field, heights }),
    }),
    BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_a',
      children: ['level_g'],
      position: [0, 1.2 + 19.5 * IN - 0.05, 0],
      metadata: { foundation: { enabled: true, type: 'raised' } },
    }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      children: [...walls.map((wall) => wall.id), 'slab_g'],
    }),
    SlabNode.parse({
      id: 'slab_g',
      parentId: 'level_g',
      plateRole: 'base',
      polygon: corners,
      elevation: 0.05,
      thickness: 0.05,
    }),
    ...walls,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

test("over a cripple wall the wall's siding runs down to the stepped-down stem, square; elsewhere to the stem's full top", () => {
  const nodes = fallingHouse()
  const steps = foundationRimSteps(nodes).get('wall_g_0') ?? []
  expect(steps.length).toBeGreaterThan(0)
  // The stem's full top under the floor framing, level-local: the rim the foundation gives the wall.
  const full = 0.05 - 11.5 * IN
  const source = nodes['wall_g_0' as AnyNodeId] as WallNode
  const wall = { ...source, underpinning: { rim: -full, stem: 0 } }
  const geometry = generateExtrudedWall(
    wall,
    [],
    calculateLevelMiters([wall]),
    0,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    nodes,
  )
  const lowest = steps.reduce((low, step) => (step.bottom < low.bottom ? step : low))
  const [from, to] = [lowest.a[0], lowest.b[0]].sort((a, b) => a - b) as [number, number]
  const middle = (from + to) / 2
  // Inside the step the siding reaches to a hair over its stem.
  expect(solidAt(geometry, middle, lowest.bottom + 0.01)).toBe(true)
  expect(solidAt(geometry, middle, lowest.bottom - 0.01)).toBe(false)
  // At the high end, no cripple wall: the siding stops at the full stem's top.
  expect(solidAt(geometry, 0.3, full + 0.01)).toBe(true)
  expect(solidAt(geometry, 0.3, full - 0.03)).toBe(false)
  // The drop is square at the step's end: a centimetre past it the rim is back up.
  const past = from > 0.5 ? from - 0.01 : to + 0.01
  const inside = from > 0.5 ? from + 0.01 : to - 0.01
  const deeper = steps.some((step) => {
    const [lo, hi] = [step.a[0], step.b[0]].sort((a, b) => a - b) as [number, number]
    return step !== lowest && past >= lo && past <= hi
  })
  if (!deeper) expect(solidAt(geometry, past, lowest.bottom + 0.01)).toBe(false)
  expect(solidAt(geometry, inside, lowest.bottom + 0.01)).toBe(true)
  // It is the wall's finish all the way down, none of it the foundation's concrete.
  const foundation = 3 + getWallFinishRefs(geometry).indexOf(WALL_SURFACE_SLOT_DEFAULTS.foundation)
  const position = geometry.getAttribute('position')
  const vertex = (at: number) => geometry.index?.getX(at) ?? at
  let below = 0
  for (const group of geometry.groups)
    for (let at = group.start; at < group.start + group.count; at += 3) {
      const y =
        (position.getY(vertex(at)) +
          position.getY(vertex(at + 1)) +
          position.getY(vertex(at + 2))) /
        3
      if (y > full - 0.02) continue
      below += 1
      expect(group.materialIndex).not.toBe(foundation)
    }
  expect(below).toBeGreaterThan(0)
  geometry.dispose()
})
