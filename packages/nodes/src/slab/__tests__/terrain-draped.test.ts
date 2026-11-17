import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  type GeometryContext,
  LevelNode,
  SiteNode,
  SlabNode,
  surfaceHeightAt,
  type TerrainField,
} from '@pascal-app/core'
import { Mesh } from 'three'
import { buildSlabGeometry } from '../geometry'

const polygon: [number, number][] = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
]

function contextFor(field: TerrainField, position: [number, number, number] = [0, 0, 0], yaw = 0) {
  const site = SiteNode.parse({ terrain: encodeTerrainField(field) })
  const building = BuildingNode.parse({ parentId: site.id, position, rotation: [0, yaw, 0] })
  const level = LevelNode.parse({ parentId: building.id, level: 0 })
  building.children = [level.id]
  const nodes: Record<string, AnyNode> = {
    [site.id]: site,
    [building.id]: building,
    [level.id]: level,
  }
  const context: GeometryContext = {
    resolve: (id) => nodes[id] as never,
    parent: level,
    children: [],
    siblings: [],
  }
  return { context, level }
}

function topTriangles(slab: SlabNode, context: GeometryContext) {
  const group = buildSlabGeometry(slab, context, 'solid', false)
  const mesh = group.children.find(
    (child) => child instanceof Mesh && child.userData.slotId === 'surface',
  )
  if (!(mesh instanceof Mesh)) throw new Error('The slab has no top surface')
  const positions = mesh.geometry.getAttribute('position')
  const indices = mesh.geometry.getIndex()
  const points: [number, number, number][] = []
  for (let index = 0; index < (indices?.count ?? positions.count); index++) {
    const vertex = indices ? indices.getX(index) : index
    points.push([positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)])
  }
  group.traverse((child) => {
    if (child instanceof Mesh) child.geometry.dispose()
  })
  return points
}

function hillField() {
  const field = createTerrainField({ origin: [0, 0], cols: 3, rows: 3, spacing: 1 })
  // A one-metre peak at the interior sample, absent from the four boundary corners.
  field.heights[4] = Math.round(1 / field.step)
  return field
}

describe('terrain-draped manual slab', () => {
  test('follows interior heightfield creases rather than spanning a hill with one flat cap', () => {
    const field = hillField()
    const { context, level } = contextFor(field)
    const slab = SlabNode.parse({
      parentId: level.id,
      polygon,
      terrainMode: 'draped',
      elevation: 0.03,
    })
    const triangles = topTriangles(slab, context)
    expect(Math.max(...triangles.map((point) => point[1]))).toBeCloseTo(1.03)
    for (let index = 0; index < triangles.length; index += 3) {
      const triangle = triangles.slice(index, index + 3)
      const centre = triangle.reduce(
        (sum, point) => sum.map((value, axis) => value + (point[axis] ?? 0) / 3),
        [0, 0, 0],
      )
      expect(centre[1]).toBeCloseTo(
        surfaceHeightAt(field, centre[0] ?? 0, centre[2] ?? 0) + 0.03,
        5,
      )
    }
  })

  test('samples ground in Site coordinates under a translated and rotated building', () => {
    const field = createTerrainField({ origin: [-5, -5], cols: 21, rows: 21, spacing: 1 })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++) {
        const siteX = field.origin[0] + col * field.spacing
        field.heights[row * field.cols + col] = Math.round((siteX * 0.1) / field.step)
      }
    const { context, level } = contextFor(field, [3, 2, 4], Math.PI / 2)
    const slab = SlabNode.parse({
      parentId: level.id,
      polygon,
      terrainMode: 'draped',
      elevation: 0.03,
    })
    for (const [x, y, z] of topTriangles(slab, context)) {
      expect(y + 2).toBeCloseTo(surfaceHeightAt(field, 3 + z, 4 - x) + 0.03, 5)
    }
  })

  test('keeps existing and explicitly flat slabs at their authored elevation on sloping ground', () => {
    const { context, level } = contextFor(hillField())
    for (const terrainMode of [undefined, 'flat'] as const) {
      const slab = SlabNode.parse({ parentId: level.id, polygon, terrainMode, elevation: 0.3 })
      for (const point of topTriangles(slab, context)) expect(point[1]).toBeCloseTo(0.3)
    }
  })
})
