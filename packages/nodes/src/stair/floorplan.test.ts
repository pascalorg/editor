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
})
