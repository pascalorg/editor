import { describe, expect, test } from 'bun:test'
import {
  type FloorplanGeometry,
  type GeometryContext,
  LevelNode,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core'
import {
  buildFloorplanStairEntry,
  createFloorplanContextExtensions,
  readFloorplanGeometryMetadata,
} from '@pascal-app/editor'
import {
  buildStairDocumentation,
  resolveStairPlanDirection,
  resolveStraightStairDirectionArrow,
  stairPlanBreakStep,
} from './documentation'

function context(levelId = 'level_ground', unit: 'metric' | 'imperial' = 'metric') {
  return {
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: LevelNode.parse({ id: levelId }),
    viewState: {
      selected: false,
      highlighted: false,
      hovered: false,
      moving: false,
      unit,
      palette: { measurementStroke: '#123456' } as NonNullable<
        GeometryContext['viewState']
      >['palette'],
    },
    extensions: createFloorplanContextExtensions({ purpose: 'edit' }),
  } satisfies GeometryContext
}

function straightFixture() {
  const segment = StairSegmentNode.parse({
    id: 'sseg_flight',
    segmentType: 'stair',
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
    stairType: 'straight',
    railingMode: 'both',
    railingHeight: 0.92,
    children: [segment.id],
  })
  const entry = buildFloorplanStairEntry(stair, [segment])!
  return { entry, segment, stair }
}

function annotationTexts(geometry: FloorplanGeometry[]) {
  return geometry.flatMap((entry) =>
    entry.kind === 'text' &&
    readFloorplanGeometryMetadata(entry).annotationRole === 'stair-annotation'
      ? [entry.text]
      : [],
  )
}

describe('stair construction documentation', () => {
  test('derives straight-flight direction, riser, tread, width, rail, and break annotations', () => {
    const { entry, stair } = straightFixture()
    const geometry = buildStairDocumentation(stair, entry, context())

    expect(annotationTexts(geometry)).toEqual([
      'UP',
      '10 R @ 0.25m · T 0.3m · CLR W 1.2m',
      'RAIL BOTH @ 0.92m',
    ])
    expect(
      geometry.some(
        (entry) =>
          entry.kind === 'polyline' &&
          readFloorplanGeometryMetadata(entry).annotationRole === 'stair-annotation',
      ),
    ).toBe(true)
  })

  test('uses DN and reverses the direction arrow on the destination level', () => {
    const { entry, stair } = straightFixture()
    const downArrow = resolveStraightStairDirectionArrow(entry, 'down')

    expect(resolveStairPlanDirection(stair, 'level_ground')).toBe('up')
    expect(resolveStairPlanDirection(stair, 'level_upper')).toBe('down')
    expect(annotationTexts(buildStairDocumentation(stair, entry, context('level_upper')))[0]).toBe(
      'DN',
    )
    expect(downArrow?.polyline.at(-1)).toEqual(entry.arrow?.polyline[0])
    expect(downArrow?.head[0]).toEqual(entry.arrow?.polyline[0])
  })

  test('derives curved-stair tread depth at the walking line', () => {
    const stair = StairNode.parse({
      id: 'stair_curved',
      parentId: 'level_ground',
      stairType: 'curved',
      width: 1.2,
      innerRadius: 0.9,
      sweepAngle: Math.PI / 2,
      totalRise: 3,
      stepCount: 12,
      railingMode: 'left',
      railingHeight: 1,
    })
    const entry = buildFloorplanStairEntry(stair, [])!

    expect(annotationTexts(buildStairDocumentation(stair, entry, context()))).toEqual([
      '12 R @ 0.25m · T(CL) 0.2m · CLR W 1.2m',
      'UP',
      'RAIL LEFT @ 1m',
    ])
  })

  test('uses the same construction notation in imperial plans', () => {
    const { entry, stair } = straightFixture()
    const texts = annotationTexts(
      buildStairDocumentation(stair, entry, context('level_ground', 'imperial')),
    )

    expect(texts[1]).toContain(`10 R @ 9 13/16"`)
    expect(texts[1]).toContain(`CLR W 3'-11 1/4"`)
  })

  test('aligns tread visibility with the documented break position', () => {
    expect(stairPlanBreakStep(10)).toBe(7)
    expect(stairPlanBreakStep(15)).toBe(11)
  })
})
