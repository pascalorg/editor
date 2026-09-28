import { describe, expect, test } from 'bun:test'
import {
  type FloorplanGeometry,
  type GeometryContext,
  LevelNode,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core'
import { readFloorplanGeometryMetadata } from '@pascal-app/editor'
import { buildStairFloorplan } from './floorplan'

function textValues(geometry: FloorplanGeometry | null) {
  if (geometry?.kind !== 'group') return []
  return geometry.children.flatMap((child) =>
    child.kind === 'text' &&
    readFloorplanGeometryMetadata(child).annotationRole === 'stair-annotation'
      ? [child.text]
      : [],
  )
}

describe('buildStairFloorplan documentation', () => {
  test('integrates stair notes, break line, and visible treads below the break', () => {
    const segment = StairSegmentNode.parse({
      id: 'sseg_main',
      width: 1.2,
      length: 3,
      height: 2.5,
      stepCount: 10,
    })
    const stair = StairNode.parse({
      id: 'stair_main',
      parentId: 'level_ground',
      fromLevelId: 'level_ground',
      toLevelId: 'level_upper',
      children: [segment.id],
      railingMode: 'both',
    })
    const geometry = buildStairFloorplan(stair, {
      resolve: () => undefined,
      children: [segment],
      siblings: [],
      parent: LevelNode.parse({ id: 'level_ground' }),
    } satisfies GeometryContext)

    expect(textValues(geometry)[0]).toBe('UP')
    expect(textValues(geometry)).toContain('10 R @ 0.25m · T 0.3m · CLR W 1.2m')
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    expect(
      geometry.children.some(
        (child) =>
          child.kind === 'polyline' &&
          readFloorplanGeometryMetadata(child).annotationRole === 'stair-annotation',
      ),
    ).toBe(true)
    expect(
      geometry.children.filter((child) => child.kind === 'polygon' && child.fill === '#262626'),
    ).toHaveLength(6)
    expect(geometry.children.some((child) => 'strokeDasharray' in child)).toBe(false)
  })
  test('uses live segment dimensions during a magnetic move', () => {
    const segment = StairSegmentNode.parse({ id: 'sseg_live', width: 1, length: 3,
      height: 2.5, stepCount: 10 })
    const preview = { ...segment, length: 0.84, height: 0.48, stepCount: 3 }
    const stair = StairNode.parse({ id: 'stair_live', parentId: 'level_ground',
      children: [segment.id], totalRise: 0.48, stepCount: 3 })
    const geometry = buildStairFloorplan(stair, {
      resolve: (id) => id === segment.id ? preview as never : undefined,
      children: [segment], siblings: [], parent: LevelNode.parse({ id: 'level_ground' }),
    } satisfies GeometryContext)
    expect(textValues(geometry)).toContain('3 R @ 0.16m · T 0.28m · CLR W 1m')
  })

  test('draws a surface child at the same level position as its unparented stair', () => {
    const segment = StairSegmentNode.parse({ id: 'sseg_attached', length: 1, height: 0.4,
      stepCount: 2 })
    const level = LevelNode.parse({ id: 'level_ground' })
    const world = StairNode.parse({ id: 'stair_attached', parentId: level.id,
      position: [5, 0, 2], rotation: Math.PI / 2, children: [segment.id] })
    const surface = { ...level, id: 'patio_1', type: 'landscape:patio', parentId: level.id,
      position: [4, 0, 3], rotation: [0, Math.PI / 2, 0] }
    const local = StairNode.parse({ ...world, parentId: surface.id,
      landscapeSurfaceId: surface.id, position: [1, 0, 1], rotation: 0 })
    const context = { resolve: () => undefined, children: [segment], siblings: [] }
    const expected = buildStairFloorplan(world, { ...context, parent: level } as GeometryContext)
    const actual = buildStairFloorplan(local, { ...context, parent: surface } as GeometryContext)
    expect(actual).toEqual(expected)
  })

})
