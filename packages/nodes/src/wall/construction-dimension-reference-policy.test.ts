import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type FloorplanGeometry,
  WallNode,
  type WallNode as WallNodeType,
} from '@pascal-app/core'
import {
  createFloorplanContextExtensions,
  type FloorplanWallDimensionFaces,
} from '@pascal-app/editor'
import { constructionDimensionStandard } from '../shared/construction-dimension-standards'
import {
  buildLevelWallConstructionDimensionPlan,
  type PlannedConstructionDimension,
  renderPlannedConstructionDimensions,
} from './construction-dimensions'
import { buildWallFloorplan, computeWallFloorplanLevelData } from './floorplan'

function wall(overrides: Partial<WallNodeType>): WallNodeType {
  return WallNode.parse({
    id: 'wall',
    parentId: 'level_main',
    start: [0, 0],
    end: [1, 0],
    thickness: 0.2,
    frontSide: 'interior',
    backSide: 'interior',
    ...overrides,
  })
}

function topFacadeFixture(splitAtPartition = false, partitionSpansPlan = false) {
  const top = wall({
    id: 'wall_top',
    start: [0, 0],
    end: splitAtPartition ? [4, 0] : [10, 0],
    frontSide: 'exterior',
    backSide: 'interior',
  })
  const topContinuation = splitAtPartition
    ? wall({
        id: 'wall_top_continuation',
        start: [4, 0],
        end: [10, 0],
        frontSide: 'exterior',
        backSide: 'interior',
      })
    : undefined
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
    id: 'wall_partition',
    start: [4, partitionSpansPlan ? -6 : -4],
    end: [4, 0],
    thickness: 0.12,
    frontSide: 'interior',
    backSide: 'interior',
  })
  const walls = [top, ...(topContinuation ? [topContinuation] : []), right, bottom, left, partition]
  const nodes = Object.fromEntries(walls.map((candidate) => [candidate.id, candidate])) as Record<
    string,
    AnyNode
  >
  return { nodes, top, walls }
}

function topFacadePlan(
  datumPolicy: 'wall-face' | 'finish-face' | 'centerline' | 'structural-face',
  splitAtPartition = false,
) {
  const { nodes, top, walls } = topFacadeFixture(splitAtPartition)
  return (
    buildLevelWallConstructionDimensionPlan(
      walls,
      nodes,
      constructionDimensionStandard({ datumPolicy }),
    ).get(top.id) ?? []
  )
}

function dimensionTexts(geometry: FloorplanGeometry): string[] {
  if (geometry.kind === 'group') return geometry.children.flatMap(dimensionTexts)
  return geometry.kind === 'dimension-string'
    ? geometry.segments.map((segment) => segment.text ?? '')
    : []
}

function tierEntries(
  plan: readonly PlannedConstructionDimension[],
  tier: PlannedConstructionDimension['tier'],
) {
  return plan.filter((entry) => entry.tier === tier)
}

describe('automatic wall dimension reference policy', () => {
  test('keeps exterior corner witnesses on outside stud faces in every mode', () => {
    for (const datumPolicy of ['finish-face', 'centerline', 'structural-face'] as const) {
      const overall = tierEntries(topFacadePlan(datumPolicy), 'overall')[0]

      expect(overall?.start[0]).toBeCloseTo(-0.1)
      expect(overall?.end[0]).toBeCloseTo(10.1)
      expect(overall?.start[1]).toBeCloseTo(0.1)
      expect(overall?.end[1]).toBeCloseTo(0.1)
    }
  })

  test('applies the selected reference only to the intersecting partition', () => {
    const intersection = (datumPolicy: 'finish-face' | 'centerline' | 'structural-face') => {
      const entries = tierEntries(topFacadePlan(datumPolicy), 'partitions')
      return entries[0]?.end[0]
    }

    expect(intersection('finish-face')).toBeCloseTo(3.94)
    expect(intersection('centerline')).toBeCloseTo(4)
    expect(intersection('structural-face')).toBeCloseTo(3.94)
  })

  test('Measure walls picks the face chains of the finished-face strings', () => {
    const { nodes, walls } = topFacadeFixture(false, true)
    const levelData = computeWallFloorplanLevelData({ siblings: walls, nodes })
    const texts = (wallDimensionFaces: FloorplanWallDimensionFaces) =>
      walls.flatMap((candidate) => {
        const geometry = buildWallFloorplan(candidate, {
          resolve: () => undefined,
          children: [],
          siblings: walls.filter((sibling) => sibling.id !== candidate.id),
          parent: null,
          levelData,
          extensions: createFloorplanContextExtensions({ wallDimensionFaces }),
        })
        return geometry ? dimensionTexts(geometry) : []
      })

    // Outside: the facade strings (top and bottom: the partition located on
    // the facade, then the overall size; left and right: the overall size).
    const facade = ['4.04m', '0.12m', '6.04m', '10.2m']
    const outside = [...facade, '6.2m', ...facade, '6.2m']
    // Inside: the partition's clear span, inside face to inside face.
    const inside = ['5.8m']

    expect(texts('exterior').sort()).toEqual(outside.sort())
    expect(texts('interior')).toEqual(inside)
    expect(texts('both').sort()).toEqual([...outside, ...inside].sort())
  })

  test('renders a face-of-stud partition chain with one shared witness', () => {
    const standard = constructionDimensionStandard({ datumPolicy: 'structural-face' })
    const partitionChain = tierEntries(topFacadePlan('structural-face'), 'partitions')
    const rendered = renderPlannedConstructionDimensions(
      partitionChain,
      'metric',
      undefined,
      'editor',
      standard,
    )

    expect(rendered).toHaveLength(1)
    const dimensionString = rendered[0]
    expect(dimensionString?.kind).toBe('dimension-string')
    if (dimensionString?.kind !== 'dimension-string') return
    expect(dimensionString.segments).toHaveLength(2)
    expect(dimensionString.segments[0]?.end[0]).toBeCloseTo(3.94)
    expect(dimensionString.segments[1]?.start[0]).toBeCloseTo(3.94)
  })

  test('uses only one stud face when the facade is split at the intersecting wall', () => {
    const standard = constructionDimensionStandard({ datumPolicy: 'structural-face' })
    const partitionChain = tierEntries(topFacadePlan('structural-face', true), 'partitions')
    const rendered = renderPlannedConstructionDimensions(
      partitionChain,
      'metric',
      undefined,
      'editor',
      standard,
    )
    const dimensionString = rendered[0]

    expect(rendered).toHaveLength(1)
    expect(dimensionString?.kind).toBe('dimension-string')
    if (dimensionString?.kind !== 'dimension-string') return
    expect(dimensionString.segments).toHaveLength(2)
    expect(dimensionString.segments.map((segment) => segment.text)).not.toContain('0.12m')
  })

  test('uses the same left or top stud face from opposing sides of the plan', () => {
    const standard = constructionDimensionStandard({ datumPolicy: 'structural-face' })
    const verticalFixture = topFacadeFixture(false, true)
    const verticalPlan = buildLevelWallConstructionDimensionPlan(
      verticalFixture.walls,
      verticalFixture.nodes,
      standard,
    )
    const verticalReference = (wallId: string) =>
      tierEntries(verticalPlan.get(wallId) ?? [], 'partitions')[0]?.end

    expect(verticalReference('wall_top')?.[0]).toBeCloseTo(3.94)
    expect(verticalReference('wall_bottom')?.[0]).toBeCloseTo(3.94)

    const reversedVerticalWalls = verticalFixture.walls.map((candidate) =>
      candidate.id === 'wall_partition'
        ? { ...candidate, start: candidate.end, end: candidate.start }
        : candidate,
    )
    const reversedVerticalNodes = Object.fromEntries(
      reversedVerticalWalls.map((candidate) => [candidate.id, candidate]),
    ) as Record<string, AnyNode>
    const reversedVerticalPlan = buildLevelWallConstructionDimensionPlan(
      reversedVerticalWalls,
      reversedVerticalNodes,
      standard,
    )
    const reversedVerticalReference = (wallId: string) =>
      tierEntries(reversedVerticalPlan.get(wallId) ?? [], 'partitions')[0]?.end

    expect(reversedVerticalReference('wall_top')?.[0]).toBeCloseTo(3.94)
    expect(reversedVerticalReference('wall_bottom')?.[0]).toBeCloseTo(3.94)

    const top = wall({
      id: 'wall_horizontal_top',
      start: [0, 0],
      end: [10, 0],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const right = wall({
      id: 'wall_horizontal_right',
      start: [10, 0],
      end: [10, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const bottom = wall({
      id: 'wall_horizontal_bottom',
      start: [10, -6],
      end: [0, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const left = wall({
      id: 'wall_horizontal_left',
      start: [0, -6],
      end: [0, 0],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const partition = wall({
      id: 'wall_horizontal_partition',
      start: [0, -3],
      end: [10, -3],
      thickness: 0.12,
    })
    const horizontalWalls = [top, right, bottom, left, partition]
    const horizontalNodes = Object.fromEntries(
      horizontalWalls.map((candidate) => [candidate.id, candidate]),
    ) as Record<string, AnyNode>
    const horizontalPlan = buildLevelWallConstructionDimensionPlan(
      horizontalWalls,
      horizontalNodes,
      standard,
    )
    const horizontalReference = (wallId: string) =>
      tierEntries(horizontalPlan.get(wallId) ?? [], 'partitions')[0]?.end

    expect(horizontalReference('wall_horizontal_left')?.[1]).toBeCloseTo(-2.94)
    expect(horizontalReference('wall_horizontal_right')?.[1]).toBeCloseTo(-2.94)
  })
})
