import { describe, expect, test } from 'bun:test'
import {
  ColumnNode,
  DoorNode,
  type FloorplanGeometry,
  GeometryArtifactManifest,
  type GeometryContext,
  ItemNode,
  LevelNode,
  WallNode,
} from '@pascal-app/core'
import { createFloorplanContextExtensions } from '@pascal-app/editor'
import { buildColumnFloorplan } from '../column/floorplan'
import { buildDoorFloorplan } from '../door/floorplan'
import { buildItemFloorplan } from '../item/floorplan'

const glb = 'a'.repeat(64)
const images = { artifact: glb, thumbnail: 'c'.repeat(64), floorPlan: 'd'.repeat(64) }
const source = {
  kind: 'script' as const,
  script: 'b'.repeat(64),
  artifact: glb,
  manifest: GeometryArtifactManifest.parse({
    bounds: { min: [-0.4, 0, -0.2], max: [0.4, 2, 0.2] },
    triangles: 12,
  }),
}

function flatten(geometry: FloorplanGeometry | null): FloorplanGeometry[] {
  if (!geometry) return []
  if (geometry.kind !== 'group') return [geometry]
  return [geometry, ...geometry.children.flatMap(flatten)]
}

const imagesOf = (geometry: FloorplanGeometry | null) =>
  flatten(geometry).filter(
    (g): g is Extract<FloorplanGeometry, { kind: 'image' }> => g.kind === 'image',
  )

function context(nodes: Record<string, unknown>): GeometryContext {
  return {
    children: [],
    parent: null,
    siblings: [],
    resolve: ((id: string) => nodes[id]) as never,
    extensions: createFloorplanContextExtensions({ purpose: 'edit' }),
  }
}

const level = LevelNode.parse({})

describe('scripted objects in the floor plan', () => {
  test('an authored item draws its floor-plan image, like a catalog item', () => {
    const node = ItemNode.parse({
      parentId: level.id,
      position: [2, 0, 3],
      source: { ...source, images },
      asset: {
        id: 'script_x',
        name: 'Authored object',
        category: 'object',
        src: `artifact://${glb}`,
        thumbnail: '',
        dimensions: [0.8, 2, 0.4],
      },
    })
    const drawn = buildItemFloorplan(node, context({ [level.id]: level, [node.id]: node }))
    expect(imagesOf(drawn)).toEqual([
      expect.objectContaining({
        url: `artifact://${images.floorPlan}`,
        center: [2, 3],
        width: 0.8,
        height: 0.4,
      }),
    ])
    const stale = {
      ...node,
      source: { ...source, images: { ...images, artifact: 'e'.repeat(64) } },
    }
    expect(imagesOf(buildItemFloorplan(stale, context({ [level.id]: level })))).toEqual([])
  })

  test('a scripted column draws its image over a transparent hit target', () => {
    const node = ColumnNode.parse({
      parentId: level.id,
      position: [1, 0, 1],
      rotation: Math.PI / 2,
      source: { ...source, images },
    })
    const drawn = buildColumnFloorplan(node, context({}))
    expect(imagesOf(drawn)).toEqual([
      expect.objectContaining({
        url: `artifact://${images.floorPlan}`,
        width: 0.8,
        height: 0.4,
        rotation: -Math.PI / 2,
      }),
    ])
    const [center] = imagesOf(drawn).map((image) => image.center)
    expect(center![0]).toBeCloseTo(1)
    expect(center![1]).toBeCloseTo(1)
    expect(flatten(drawn).find((g) => g.kind === 'polygon')).toMatchObject({
      fill: 'transparent',
    })
    expect(imagesOf(buildColumnFloorplan({ ...node, source }, context({})))).toEqual([])
  })

  test('a scripted door keeps its swing symbol', () => {
    const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0] })
    const node = DoorNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1, 0],
      source: { ...source, images },
    })
    const nodes = { [level.id]: level, [wall.id]: wall, [node.id]: node }
    const drawn = buildDoorFloorplan(node, { ...context(nodes), parent: wall })
    expect(drawn).not.toBeNull()
    expect(imagesOf(drawn)).toEqual([])
  })
})
