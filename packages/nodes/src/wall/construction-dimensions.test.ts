import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  ColumnNode,
  DoorNode,
  type FloorplanGeometry,
  type GeometryContext,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { constructionDimensionStandard } from '../shared/construction-dimension-standards'
import {
  buildCurvedWallConstructionDimensions,
  buildLevelWallConstructionDimensionPlan,
  buildWallConstructionDimensions,
  formatConstructionLength,
  renderPlannedConstructionDimensions,
} from './construction-dimensions'

function wall(overrides: Partial<WallNode> = {}) {
  return WallNode.parse({
    id: 'wall_main',
    parentId: 'level_main',
    start: [0, 0],
    end: [10, 0],
    thickness: 0.2,
    frontSide: 'exterior',
    backSide: 'interior',
    ...overrides,
  })
}

function context(
  children: GeometryContext['children'] = [],
  siblings: GeometryContext['siblings'] = [],
) {
  return {
    resolve: () => undefined,
    children,
    siblings,
    parent: null,
  } satisfies GeometryContext
}

function dimensionTexts(entries: readonly FloorplanGeometry[]): string[] {
  return entries.flatMap((entry) => {
    if (entry.kind === 'dimension') return [entry.text]
    if (entry.kind === 'dimension-string') return entry.segments.map((segment) => segment.text)
    return []
  })
}

function firstDimensionSegment(entry: FloorplanGeometry) {
  if (entry.kind === 'dimension') return entry
  if (entry.kind === 'dimension-string') return entry.segments[0]
  return null
}

describe('formatConstructionLength', () => {
  test('formats U.S. architectural feet, inches, and reduced sixteenths', () => {
    expect(formatConstructionLength(12 * 0.3048, 'imperial')).toBe(`12'-0"`)
    expect(formatConstructionLength((7 * 12 + 5.5) * 0.0254, 'imperial')).toBe(`7'-5 1/2"`)
    expect(formatConstructionLength((2 * 12 + 3.1875) * 0.0254, 'imperial')).toBe(`2'-3 3/16"`)
  })

  test('rounds to the nearest sixteenth and carries into the next foot', () => {
    expect(formatConstructionLength((11 + 0.99) * 0.0254, 'imperial')).toBe(`1'-0"`)
    expect(formatConstructionLength(-0.5 * 0.0254, 'imperial')).toBe(`-0 1/2"`)
  })

  test('keeps metric output concise', () => {
    expect(formatConstructionLength(3.456, 'metric')).toBe('3.46m')
    expect(formatConstructionLength(Number.NaN, 'metric')).toBe('--')
  })
})

describe('buildWallConstructionDimensions', () => {
  test('calls out a curved wall with a center-to-curve radius leader', () => {
    const geometry = buildCurvedWallConstructionDimensions(wall({ curveOffset: 1 }), {
      unit: 'metric',
    })[0]

    expect(geometry).toMatchObject({ kind: 'group', annotationRole: 'automatic-dimension' })
    if (geometry?.kind !== 'group') return
    const leader = geometry.children[0]
    const label = geometry.children.find((entry) => entry.kind === 'dimension-label')

    expect(leader).toMatchObject({ kind: 'line', x1: 5, y1: 12, y2: -1 })
    expect(leader?.kind === 'line' ? leader.x2 : Number.NaN).toBeCloseTo(5)
    expect(label).toMatchObject({ kind: 'dimension-label', text: 'R 13m' })
  })

  test('builds a jamb-by-jamb chain plus a farther wall span', () => {
    const door = DoorNode.parse({
      id: 'door_entry',
      parentId: 'wall_main',
      position: [2, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_front',
      parentId: 'wall_main',
      position: [6, 1.5, 0],
      width: 2,
    })

    const dimensions = buildWallConstructionDimensions(wall(), context([door, window]), {
      unit: 'metric',
    })

    expect(dimensions).toHaveLength(6)
    expect(dimensions.map((entry) => entry.kind)).toEqual(Array(6).fill('dimension-string'))
    expect(dimensionTexts(dimensions)).toEqual(['1.5m', '1m', '2.5m', '2m', '3m', '10m'])
    expect(dimensions.at(-1)).toMatchObject({
      kind: 'dimension-string',
      offsetNormal: [0, 1],
      offsetDistance: 1.05,
    })
  })

  test('applies drawing dimension standards to automatic wall strings', () => {
    const door = DoorNode.parse({
      id: 'door_entry',
      parentId: 'wall_main',
      position: [2, 1.05, 0],
      width: 1,
    })
    const standard = constructionDimensionStandard({
      openingChainOffset: 0.7,
      wallSpanOffset: 1.4,
      extensionStartGap: 0.03,
      extensionOvershoot: 0.18,
      terminator: 'dot',
      textPosition: 'centered',
      metricNotation: 'millimeters',
    })

    const dimensions = buildWallConstructionDimensions(wall(), context([door]), {
      unit: 'metric',
      standard,
    })

    expect(dimensionTexts(dimensions)).toEqual(['1500', '1000', '7500', '10000'])
    expect(dimensions[0]).toMatchObject({
      kind: 'dimension-string',
      offsetDistance: 0.7,
      extensionStartGap: 0.03,
      extensionOvershoot: 0.18,
      terminator: 'dot',
      textPosition: 'centered',
    })
    expect(dimensions.at(-1)).toMatchObject({
      kind: 'dimension-string',
      offsetDistance: 1.4,
    })
  })

  test('uses the exterior wall face as the dimension side', () => {
    const dimensions = buildWallConstructionDimensions(
      wall({ frontSide: 'interior', backSide: 'exterior' }),
      context(),
      { unit: 'metric' },
    )

    expect(dimensions).toHaveLength(1)
    expect(dimensions[0]).toMatchObject({
      kind: 'dimension-string',
      offsetNormal: [0, -1],
    })
    expect(firstDimensionSegment(dimensions[0]!)).toMatchObject({
      start: [0, -0.1],
      end: [10, -0.1],
    })
  })

  test('never dimensions a classified interior wall', () => {
    const interior = wall({ frontSide: 'interior', backSide: 'interior' })
    expect(buildWallConstructionDimensions(interior, context(), { unit: 'metric' })).toEqual([])
  })

  test('keeps curved walls out of the straight-string builder', () => {
    expect(
      buildWallConstructionDimensions(wall({ curveOffset: 1 }), context(), { unit: 'metric' }),
    ).toEqual([])
  })
})

describe('buildLevelWallConstructionDimensionPlan', () => {
  test('coordinates opening widths, centers, partition references, and overall extent', () => {
    const exterior = wall()
    const partition = wall({
      id: 'wall_partition',
      start: [4, 0],
      end: [4, -4],
      frontSide: 'interior',
      backSide: 'interior',
    })
    const door = DoorNode.parse({
      id: 'door_entry',
      parentId: exterior.id,
      position: [2, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_front',
      parentId: exterior.id,
      position: [6, 1.5, 0],
      width: 2,
    })
    const nodes = { [door.id]: door, [window.id]: window } satisfies Record<string, AnyNode>

    const plan = buildLevelWallConstructionDimensionPlan([exterior, partition], nodes)
    const planned = plan.get(exterior.id)
    const exteriorPlanned = planned ?? []
    expect(exteriorPlanned.map((entry) => entry.tier)).toEqual([
      'opening-widths',
      'opening-widths',
      'openings',
      'openings',
      'openings',
      'partitions',
      'partitions',
      'overall',
    ])
    expect(exteriorPlanned.map((entry) => Number(entry.offsetDistance.toFixed(2)))).toEqual([
      0.28, 0.28, 0.9, 0.9, 0.9, 1.52, 1.52, 2.14,
    ])
    expect(dimensionTexts(renderPlannedConstructionDimensions(exteriorPlanned, 'metric'))).toEqual([
      '1m',
      '2m',
      '2m',
      '4m',
      '4m',
      '3.9m',
      '6.1m',
      '10m',
    ])
    expect(exteriorPlanned.at(-1)).toMatchObject({
      start: [0, 0.1],
      end: [10, 0.1],
      offsetNormal: [0, 1],
    })
  })

  test('uses drawing standard tier spacing for coordinated facade dimensions', () => {
    const exterior = wall()
    const partition = wall({
      id: 'wall_partition',
      start: [4, 0],
      end: [4, -4],
      frontSide: 'interior',
      backSide: 'interior',
    })
    const door = DoorNode.parse({
      id: 'door_entry',
      parentId: exterior.id,
      position: [2, 1.05, 0],
      width: 1,
    })
    const standard = constructionDimensionStandard({
      firstOpeningWidthOffset: 0.4,
      firstGeneralTierOffset: 0.6,
      tierSpacing: 0.5,
      extensionOvershoot: 0.2,
      terminator: 'open-arrow',
    })

    const planned =
      buildLevelWallConstructionDimensionPlan(
        [exterior, partition],
        { [door.id]: door },
        standard,
      ).get(exterior.id) ?? []
    const rendered = renderPlannedConstructionDimensions(
      planned,
      'metric',
      undefined,
      'editor',
      standard,
    )

    expect(planned.map((entry) => Number(entry.offsetDistance.toFixed(2)))).toEqual([
      0.4, 0.9, 0.9, 1.4, 1.4, 1.9,
    ])
    expect(rendered[0]).toMatchObject({
      kind: 'dimension-string',
      extensionOvershoot: 0.2,
      terminator: 'open-arrow',
    })
  })

  test('combines collinear exterior wall segments into one facade run', () => {
    const first = wall({ id: 'wall_a', end: [5, 0] })
    const second = wall({ id: 'wall_b', start: [5, 0] })
    const opening = WindowNode.parse({
      id: 'window_b',
      parentId: second.id,
      position: [2, 1.5, 0],
      width: 1,
    })

    const plan = buildLevelWallConstructionDimensionPlan([second, first], { [opening.id]: opening })
    const exteriorPlanned = plan.get(first.id) ?? []

    expect([...plan.keys()]).toEqual([first.id])
    expect(dimensionTexts(renderPlannedConstructionDimensions(exteriorPlanned, 'metric'))).toEqual([
      '1m',
      '7m',
      '3m',
      '10m',
    ])
  })

  test('adds a wall-local overall dimension for a classified interior partition', () => {
    const exterior = wall()
    const partition = wall({
      id: 'wall_partition',
      start: [4, 0],
      end: [4, -4],
      frontSide: 'interior',
      backSide: 'interior',
    })

    const plan = buildLevelWallConstructionDimensionPlan([exterior, partition], {})
    const exteriorPlanned = plan.get(exterior.id) ?? []
    const interiorPlanned = plan.get(partition.id) ?? []

    expect(exteriorPlanned.map((entry) => entry.tier)).toEqual([
      'partitions',
      'partitions',
      'overall',
    ])
    expect(interiorPlanned).toEqual([
      expect.objectContaining({
        tier: 'interior-overall',
        offsetDistance: 0.55,
      }),
    ])
    expect(exteriorPlanned.map((entry) => Number(entry.offsetDistance.toFixed(2)))).toEqual([
      0.55, 0.55, 1.17,
    ])
  })

  test('dimensions interior wall segments and hosted door and window widths in the larger room', () => {
    const partition = wall({
      id: 'wall_partition',
      start: [0, 4],
      end: [10, 4],
      frontSide: 'interior',
      backSide: 'interior',
    })
    const lowerBoundary = wall({ id: 'wall_lower', start: [0, 0], end: [10, 0] })
    const upperBoundary = wall({ id: 'wall_upper', start: [10, 10], end: [0, 10] })
    const door = DoorNode.parse({
      id: 'door_entry',
      parentId: partition.id,
      position: [2, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_internal',
      parentId: partition.id,
      position: [6, 1.5, 0],
      width: 2,
    })

    const planned =
      buildLevelWallConstructionDimensionPlan([partition, lowerBoundary, upperBoundary], {
        [door.id]: door,
        [window.id]: window,
      }).get(partition.id) ?? []

    expect(planned.map((entry) => entry.tier)).toEqual([
      'interior',
      'interior',
      'interior',
      'interior',
      'interior',
      'interior-overall',
    ])
    expect(dimensionTexts(renderPlannedConstructionDimensions(planned, 'metric'))).toEqual([
      '1.5m',
      '1m',
      '2.5m',
      '2m',
      '3m',
      '10m',
    ])
    expect(planned[0]).toMatchObject({
      start: [0, 4.1],
      offsetNormal: [0, 1],
      offsetDistance: 0.55,
    })
    expect(planned.at(-1)).toMatchObject({
      offsetNormal: [0, 1],
      offsetDistance: 1.05,
    })
  })

  test('starts and ends an interior opening chain at the adjacent wall faces', () => {
    const partition = wall({
      id: 'wall_partition_clear_span',
      start: [0, 4],
      end: [10, 4],
      frontSide: 'interior',
      backSide: 'interior',
    })
    const lowerBoundary = wall({ id: 'wall_lower', start: [0, 0], end: [10, 0] })
    const upperBoundary = wall({ id: 'wall_upper', start: [10, 10], end: [0, 10] })
    const leftBoundary = wall({
      id: 'wall_left',
      start: [0, 10],
      end: [0, 0],
      thickness: 0.4,
    })
    const rightBoundary = wall({
      id: 'wall_right',
      start: [10, 0],
      end: [10, 10],
      thickness: 0.2,
    })
    const door = DoorNode.parse({
      id: 'door_clear_span',
      parentId: partition.id,
      position: [2, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_clear_span',
      parentId: partition.id,
      position: [6, 1.5, 0],
      width: 2,
    })

    const planned =
      buildLevelWallConstructionDimensionPlan(
        [partition, lowerBoundary, upperBoundary, leftBoundary, rightBoundary],
        { [door.id]: door, [window.id]: window },
      ).get(partition.id) ?? []

    expect(planned[0]).toMatchObject({ start: [0.2, 4.1] })
    expect(planned.at(-1)).toMatchObject({
      start: [0.2, 4.1],
      end: [9.9, 4.1],
    })
    expect(dimensionTexts(renderPlannedConstructionDimensions(planned, 'metric'))).toEqual([
      '1.3m',
      '1m',
      '2.5m',
      '2m',
      '2.9m',
      '9.7m',
    ])
  })

  test('dimensions hosted openings on a bounded partition with incomplete side metadata', () => {
    const partition = wall({
      id: 'wall_unclassified_partition',
      start: [0, 4],
      end: [10, 4],
      frontSide: 'unknown',
      backSide: 'unknown',
    })
    const lowerBoundary = wall({ id: 'wall_lower', start: [0, 0], end: [10, 0] })
    const upperBoundary = wall({ id: 'wall_upper', start: [10, 10], end: [0, 10] })
    const door = DoorNode.parse({
      id: 'door_unclassified_partition',
      wallId: partition.id,
      parentId: partition.id,
      position: [2, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_unclassified_partition',
      parentId: partition.id,
      position: [6, 1.5, 0],
      width: 2,
    })

    const planned =
      buildLevelWallConstructionDimensionPlan([partition, lowerBoundary, upperBoundary], {
        [door.id]: door,
        [window.id]: window,
      }).get(partition.id) ?? []

    expect(planned.map((entry) => entry.tier)).toEqual([
      'interior',
      'interior',
      'interior',
      'interior',
      'interior',
      'interior-overall',
    ])
    expect(dimensionTexts(renderPlannedConstructionDimensions(planned, 'metric'))).toEqual([
      '1.5m',
      '1m',
      '2.5m',
      '2m',
      '3m',
      '10m',
    ])
  })

  test('dimensions hosted openings on a bounded partition with stale exterior metadata', () => {
    const top = wall({ id: 'wall_top' })
    const right = wall({
      id: 'wall_right',
      start: [10, 0],
      end: [10, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const bottom = wall({
      id: 'wall_bottom',
      start: [10, -6],
      end: [0, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const left = wall({
      id: 'wall_left',
      start: [0, -6],
      end: [0, 0],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const partition = wall({
      id: 'wall_stale_partition',
      start: [0, -3],
      end: [10, -3],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const door = DoorNode.parse({
      id: 'door_stale_partition',
      parentId: partition.id,
      position: [2, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_stale_partition',
      parentId: partition.id,
      position: [6, 1.5, 0],
      width: 2,
    })

    const planned =
      buildLevelWallConstructionDimensionPlan([top, right, bottom, left, partition], {
        [door.id]: door,
        [window.id]: window,
      }).get(partition.id) ?? []

    expect(planned.map((entry) => entry.tier)).toEqual([
      'interior',
      'interior',
      'interior',
      'interior',
      'interior',
      'interior-overall',
    ])
    expect(dimensionTexts(renderPlannedConstructionDimensions(planned, 'metric'))).toEqual([
      '1.4m',
      '1m',
      '2.5m',
      '2m',
      '2.9m',
      '9.8m',
    ])
  })

  test('does not treat an unbounded unknown wall with an opening as an interior partition', () => {
    const unknownWall = wall({
      id: 'wall_unbounded_unknown',
      frontSide: 'unknown',
      backSide: 'unknown',
    })
    const door = DoorNode.parse({
      id: 'door_unbounded_unknown',
      parentId: unknownWall.id,
      position: [2, 1.05, 0],
      width: 1,
    })

    const plan = buildLevelWallConstructionDimensionPlan([unknownWall], { [door.id]: door })

    expect(plan.get(unknownWall.id)).toBeUndefined()
  })

  test('locates partitions from a consistent face of stud', () => {
    const exterior = wall()
    const thinPartition = wall({
      id: 'wall_partition_thin',
      start: [3, 0],
      end: [3, -3],
      thickness: 0.1,
      frontSide: 'interior',
      backSide: 'interior',
    })
    const thickPartition = wall({
      id: 'wall_partition_thick',
      start: [7, 0],
      end: [7, -3],
      thickness: 0.4,
      frontSide: 'interior',
      backSide: 'interior',
    })

    const planned =
      buildLevelWallConstructionDimensionPlan([exterior, thinPartition, thickPartition], {}).get(
        exterior.id,
      ) ?? []

    expect(
      dimensionTexts(
        renderPlannedConstructionDimensions(
          planned.filter((entry) => entry.tier === 'partitions'),
          'metric',
        ),
      ),
    ).toEqual(['2.95m', '3.85m', '3.2m'])
  })

  test('chains stepped facade projections on one exterior baseline', () => {
    const lower = wall({ id: 'wall_lower', end: [4, 0] })
    const step = wall({
      id: 'wall_step',
      start: [4, 0],
      end: [4, 1],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const upper = wall({ id: 'wall_upper', start: [4, 1], end: [10, 1] })

    const planned =
      buildLevelWallConstructionDimensionPlan([lower, step, upper], {}).get(lower.id) ?? []
    const rendered = renderPlannedConstructionDimensions(planned, 'metric')

    expect(planned.map((entry) => entry.tier)).toEqual(['jogs', 'jogs', 'overall'])
    expect(dimensionTexts(rendered)).toEqual(['4m', '6m', '10m'])
    const jogs = planned.filter((entry) => entry.tier === 'jogs')
    expect(jogs).toEqual([
      expect.objectContaining({
        start: [0, 0.1],
        end: [4, 1.1],
      }),
      expect.objectContaining({
        start: [4, 1.1],
        end: [10, 1.1],
      }),
    ])
    expect(jogs[0]?.dimensionStart?.[1]).toBeCloseTo(1.65)
    expect(jogs[0]?.dimensionEnd?.[1]).toBeCloseTo(1.65)
    expect(jogs[1]?.dimensionStart?.[1]).toBeCloseTo(1.65)
    expect(jogs[1]?.dimensionEnd?.[1]).toBeCloseTo(1.65)
  })

  test('dimensions an exterior column row by structural centerline', () => {
    const top = wall({ id: 'wall_top' })
    const right = wall({
      id: 'wall_right',
      start: [10, 0],
      end: [10, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const bottom = wall({
      id: 'wall_bottom',
      start: [10, -6],
      end: [0, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const left = wall({
      id: 'wall_left',
      start: [0, -6],
      end: [0, 0],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const columns = [-1, 5, 11].map((x, index) =>
      ColumnNode.parse({
        id: `column_${index}`,
        parentId: 'level_main',
        position: [x, 0, 2],
        crossSection: 'square',
      }),
    )
    const nodes = Object.fromEntries(columns.map((column) => [column.id, column]))

    const plan = buildLevelWallConstructionDimensionPlan([top, right, bottom, left], nodes)
    const planned = plan.get(top.id) ?? []

    expect(plan.size).toBe(4)
    expect(planned.map((entry) => entry.tier)).toEqual([
      'structure',
      'structure',
      'overall',
      'structural-overall',
    ])
    expect(dimensionTexts(renderPlannedConstructionDimensions(planned, 'metric'))).toEqual([
      '6m',
      '6m',
      '10m',
      '12m',
    ])
    expect(planned[0]).toMatchObject({
      start: [-1, 2],
      end: [5, 2],
    })
    expect(planned[0]?.dimensionStart?.[0]).toBe(-1)
    expect(planned[0]?.dimensionEnd?.[0]).toBe(5)
    expect(planned[0]?.dimensionStart?.[1]).toBeCloseTo(2.8712)
    expect(planned[0]?.dimensionEnd?.[1]).toBeCloseTo(2.8712)
  })

  test('does not stretch interior column references to an exterior dimension string', () => {
    const top = wall({ id: 'wall_top' })
    const right = wall({
      id: 'wall_right',
      start: [10, 0],
      end: [10, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const bottom = wall({
      id: 'wall_bottom',
      start: [10, -6],
      end: [0, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const left = wall({
      id: 'wall_left',
      start: [0, -6],
      end: [0, 0],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const columns = [2, 8].map((x, index) =>
      ColumnNode.parse({
        id: `column_interior_${index}`,
        parentId: 'level_main',
        position: [x, 0, -2],
        crossSection: 'square',
      }),
    )
    const nodes = Object.fromEntries(columns.map((column) => [column.id, column]))

    const planned =
      buildLevelWallConstructionDimensionPlan([top, right, bottom, left], nodes).get(top.id) ?? []

    expect(planned.map((entry) => entry.tier)).toEqual(['overall'])
  })

  test('keeps internal openings off exterior strings and dimensions them locally', () => {
    const top = wall({ id: 'wall_top' })
    const right = wall({
      id: 'wall_right',
      start: [10, 0],
      end: [10, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const bottom = wall({
      id: 'wall_bottom',
      start: [10, -6],
      end: [0, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const left = wall({
      id: 'wall_left',
      start: [0, -6],
      end: [0, 0],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const interiorDoorWall = wall({
      id: 'wall_interior_door',
      start: [4, -2],
      end: [10, -2],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const door = DoorNode.parse({
      id: 'door_interior',
      parentId: interiorDoorWall.id,
      position: [3, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_interior',
      parentId: interiorDoorWall.id,
      position: [1.5, 1.2, 0],
      width: 1,
    })

    const plan = buildLevelWallConstructionDimensionPlan(
      [top, right, bottom, left, interiorDoorWall],
      { [door.id]: door, [window.id]: window },
    )
    const bottomDimensions = plan.get(bottom.id) ?? []
    const interiorDimensions = plan.get(interiorDoorWall.id) ?? []

    expect(bottomDimensions.map((entry) => entry.tier)).toEqual(['overall'])
    expect(interiorDimensions.map((entry) => entry.tier)).toEqual([
      'interior',
      'interior',
      'interior',
      'interior',
      'interior',
      'interior-overall',
    ])
    expect(
      dimensionTexts(renderPlannedConstructionDimensions(interiorDimensions, 'metric')),
    ).toEqual(['1m', '1m', '0.5m', '1m', '2.4m', '5.9m'])
  })

  test('keeps disconnected collinear facade runs independent', () => {
    const first = wall({ id: 'wall_a', end: [4, 0] })
    const second = wall({ id: 'wall_b', start: [8, 0], end: [12, 0] })
    const firstPartition = wall({
      id: 'wall_partition_a',
      start: [2, 0],
      end: [2, -2],
      frontSide: 'interior',
      backSide: 'interior',
    })
    const secondPartition = wall({
      id: 'wall_partition_b',
      start: [10, 0],
      end: [10, -2],
      frontSide: 'interior',
      backSide: 'interior',
    })

    const plan = buildLevelWallConstructionDimensionPlan(
      [first, second, firstPartition, secondPartition],
      {},
    )

    expect([...plan.keys()]).toEqual([first.id, second.id, firstPartition.id, secondPartition.id])
    expect(plan.get(first.id)?.find((entry) => entry.tier === 'overall')).toMatchObject({
      start: [0, 0.1],
      end: [4, 0.1],
    })
    expect(plan.get(second.id)?.find((entry) => entry.tier === 'overall')).toMatchObject({
      start: [8, 0.1],
      end: [12, 0.1],
    })
  })

  test('places a back-side exterior facade beyond the back face', () => {
    const exterior = wall({ frontSide: 'interior', backSide: 'exterior' })
    const planned = buildLevelWallConstructionDimensionPlan([exterior], {}).get(exterior.id)

    const overall = planned?.find((entry) => entry.tier === 'overall')
    expect(overall).toMatchObject({
      start: [10, -0.1],
      end: [0, -0.1],
      offsetNormal: [0, -1],
      dimensionStart: [10, -0.65],
      dimensionEnd: [0, -0.65],
    })
    expect(overall?.offsetDistance).toBeCloseTo(0.55)
  })

  test('keeps angled exterior dimensions aligned and reports their true length', () => {
    const angled = wall({ end: [3, 4] })
    const planned = buildLevelWallConstructionDimensionPlan([angled], {}).get(angled.id) ?? []

    expect(dimensionTexts(renderPlannedConstructionDimensions(planned, 'imperial'))).toEqual([
      `16'-4 7/8"`,
    ])
    expect(planned[0]).toMatchObject({
      tier: 'overall',
      offsetNormal: [-0.8, 0.6],
    })
    expect(
      Math.hypot(
        planned[0]!.dimensionEnd![0] - planned[0]!.dimensionStart![0],
        planned[0]!.dimensionEnd![1] - planned[0]!.dimensionStart![1],
      ),
    ).toBeCloseTo(5)
  })

  test('dimensions every exterior side and interior run in a subdivided rectangular plan', () => {
    const topLeft = wall({ id: 'wall_top_left', end: [2.5, 0] })
    const topRight = wall({ id: 'wall_top_right', start: [2.5, 0], end: [6, 0] })
    const rightTop = wall({ id: 'wall_right_top', start: [6, 0], end: [6, -1.5] })
    const rightBottom = wall({ id: 'wall_right_bottom', start: [6, -1.5], end: [6, -3] })
    const bottomRight = wall({ id: 'wall_bottom_right', start: [6, -3], end: [4, -3] })
    const bottomMiddle = wall({ id: 'wall_bottom_middle', start: [4, -3], end: [2.5, -3] })
    const bottomLeft = wall({ id: 'wall_bottom_left', start: [2.5, -3], end: [0, -3] })
    const leftBottom = wall({ id: 'wall_left_bottom', start: [0, -3], end: [0, -1.5] })
    const leftTop = wall({ id: 'wall_left_top', start: [0, -1.5], end: [0, 0] })
    const interior = (id: string, start: [number, number], end: [number, number]) =>
      wall({ id, start, end })
    const middleLeft = interior('wall_middle_left', [0, -1.5], [2.5, -1.5])
    const middleCenter = interior('wall_middle_center', [2.5, -1.5], [4, -1.5])
    const middleRight = interior('wall_middle_right', [4, -1.5], [6, -1.5])
    const centerTop = interior('wall_center_top', [2.5, 0], [2.5, -1.5])
    const centerBottom = interior('wall_center_bottom', [2.5, -1.5], [2.5, -3])
    const lowerRight = interior('wall_lower_right', [4, -1.5], [4, -3])
    const walls = [
      topLeft,
      topRight,
      rightTop,
      rightBottom,
      bottomRight,
      bottomMiddle,
      bottomLeft,
      leftBottom,
      leftTop,
      middleLeft,
      middleCenter,
      middleRight,
      centerTop,
      centerBottom,
      lowerRight,
    ]

    const plan = buildLevelWallConstructionDimensionPlan(walls, {})
    const exteriorFacades = [
      [topLeft.id, topRight.id],
      [rightTop.id, rightBottom.id],
      [bottomRight.id, bottomMiddle.id, bottomLeft.id],
      [leftBottom.id, leftTop.id],
    ]
    expect(
      exteriorFacades.map((ids) =>
        ids.some((id) => plan.get(id)?.some((entry) => entry.tier === 'partitions')),
      ),
    ).toEqual([true, true, true, true])

    expect(
      [middleLeft, middleCenter, middleRight, centerTop, centerBottom, lowerRight].map((entry) =>
        plan.get(entry.id)?.some((dimension) => dimension.tier === 'interior-overall'),
      ),
    ).toEqual([true, true, true, true, true, true])
  })

  test('does not automatically dimension walls without a side classification', () => {
    const plan = buildLevelWallConstructionDimensionPlan(
      [wall({ frontSide: 'unknown', backSide: 'unknown' })],
      {},
    )

    expect(plan.size).toBe(0)
  })
})
