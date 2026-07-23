import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, LevelNode, WallNode, WindowNode } from '@pascal-app/core'
import {
  buildDoorFloorplanSchedule,
  buildOpeningMarkAnnotation,
  buildWindowFloorplanSchedule,
  computeDoorFloorplanLevelData,
  computeWindowFloorplanLevelData,
  resolveOpeningDimensionDocumentation,
} from './opening-documentation'

const FOOT = 0.3048

function fixture(levelNumber = 0) {
  const level = LevelNode.parse({
    id: 'level_main',
    level: levelNumber,
    children: ['wall_main'],
  })
  const wall = WallNode.parse({
    id: 'wall_main',
    parentId: level.id,
    children: ['door_a', 'door_b', 'window_a', 'window_b'],
    start: [0, 0],
    end: [10, 0],
    thickness: 0.2,
    frontSide: 'exterior',
    backSide: 'interior',
  })
  const doorA = DoorNode.parse({
    id: 'door_a',
    parentId: wall.id,
    wallId: wall.id,
    position: [3, 3.5 * FOOT, 0],
    width: 3 * FOOT,
    height: 7 * FOOT,
  })
  const doorB = DoorNode.parse({
    id: 'door_b',
    parentId: wall.id,
    wallId: wall.id,
    position: [6, 3.5 * FOOT, 0],
    width: 3 * FOOT,
    height: 7 * FOOT,
  })
  const windowA = WindowNode.parse({
    id: 'window_a',
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 5 * FOOT, 0],
    width: 4 * FOOT,
    height: 4 * FOOT,
  })
  const windowB = WindowNode.parse({
    id: 'window_b',
    parentId: wall.id,
    wallId: wall.id,
    position: [8, 5 * FOOT, 0],
    width: 4 * FOOT,
    height: 4 * FOOT,
  })
  const nodes = Object.fromEntries(
    [level, wall, doorA, doorB, windowA, windowB].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>

  return { doorA, doorB, level, nodes, wall, windowA, windowB }
}

describe('opening construction documentation', () => {
  test('assigns deterministic level-based door marks and skips explicit marks', () => {
    const { doorA, doorB, nodes } = fixture()
    const explicit = DoorNode.parse({ ...doorA, mark: '101' })
    const marks = computeDoorFloorplanLevelData({ siblings: [explicit, doorB], nodes })

    expect(marks.markById.get(explicit.id)).toBe('101')
    expect(marks.markById.get(doorB.id)).toBe('102')

    const upperFixture = fixture(1)
    const upperMarks = computeDoorFloorplanLevelData({
      siblings: [upperFixture.doorA],
      nodes: upperFixture.nodes,
    })
    expect(upperMarks.markById.get(upperFixture.doorA.id)).toBe('201')
  })

  test('assigns stable window marks in level order', () => {
    const { nodes, windowA, windowB } = fixture()
    const marks = computeWindowFloorplanLevelData({
      siblings: [windowA, windowB],
      nodes,
    })

    expect(marks.markById.get(windowA.id)).toBe('W01')
    expect(marks.markById.get(windowB.id)).toBe('W02')
  })

  test('builds U.S. door schedule dimensions without inventing a rough opening', () => {
    const { doorA, level, nodes } = fixture()
    const schedule = buildDoorFloorplanSchedule({
      siblings: [doorA],
      nodes,
      levelId: level.id,
      unit: 'imperial',
    })

    expect(schedule?.rows[0]?.cells).toMatchObject({
      mark: '101',
      size: `3'-0" x 7'-0"`,
      roughOpening: 'VERIFY',
    })
  })

  test('includes verified window rough opening, sill, and head heights', () => {
    const { level, nodes, windowA } = fixture()
    const documented = WindowNode.parse({
      ...windowA,
      roughOpeningWidth: 4.1 * FOOT,
      roughOpeningHeight: 4.2 * FOOT,
    })
    const schedule = buildWindowFloorplanSchedule({
      siblings: [documented],
      nodes,
      levelId: level.id,
      unit: 'imperial',
    })

    expect(schedule?.rows[0]?.cells).toMatchObject({
      mark: 'W01',
      roughOpening: `4'-1 3/16" x 4'-2 3/8"`,
      sill: `3'-0"`,
      head: `7'-0"`,
    })
  })

  test('resolves explicit opening dimension documentation without inventing missing values', () => {
    const { doorA, windowA } = fixture()
    const roughDoor = DoorNode.parse({
      ...doorA,
      dimensionReference: 'rough-opening',
      roughOpeningWidth: 3.1 * FOOT,
      roughOpeningHeight: 7.1 * FOOT,
    })
    const missingRoughDoor = DoorNode.parse({
      ...doorA,
      id: 'door_missing_ro',
      dimensionReference: 'rough-opening',
    })
    const masonryWindow = WindowNode.parse({
      ...windowA,
      constructionType: 'masonry',
      masonryOpeningWidth: 4.25 * FOOT,
      masonryOpeningHeight: 4.25 * FOOT,
    })

    expect(resolveOpeningDimensionDocumentation(roughDoor)).toMatchObject({
      constructionType: 'framed',
      reference: 'rough-opening',
      locationPolicy: 'centerline',
      prefix: 'RO',
      verified: true,
      width: 3.1 * FOOT,
    })
    expect(resolveOpeningDimensionDocumentation(missingRoughDoor)).toMatchObject({
      reference: 'rough-opening',
      prefix: 'RO',
      verified: false,
      width: null,
    })
    expect(resolveOpeningDimensionDocumentation(masonryWindow)).toMatchObject({
      constructionType: 'masonry',
      reference: 'masonry-opening',
      locationPolicy: 'edge-to-edge',
      prefix: 'MO',
      verified: true,
      width: 4.25 * FOOT,
    })
  })

  test('warns about duplicate manually assigned marks', () => {
    const { doorA, doorB, level, nodes } = fixture()
    const schedule = buildDoorFloorplanSchedule({
      siblings: [
        DoorNode.parse({ ...doorA, mark: 'A1' }),
        DoorNode.parse({ ...doorB, mark: 'a1' }),
      ],
      nodes,
      levelId: level.id,
      unit: 'imperial',
    })

    expect(schedule?.issues).toEqual(['Duplicate door mark A1 (2 instances)'])
  })

  test('places the opening mark tag on the interior face of an exterior wall', () => {
    const { doorA, nodes, wall } = fixture()
    const levelData = computeDoorFloorplanLevelData({ siblings: [doorA], nodes })
    const annotation = buildOpeningMarkAnnotation(doorA, wall, levelData)

    expect(annotation?.kind).toBe('group')
    if (annotation?.kind !== 'group') return
    const tag = annotation.children.find((child) => child.kind === 'text')
    expect(tag).toMatchObject({ kind: 'text', text: '101', x: 3 })
    expect(tag?.kind === 'text' ? tag.y : null).toBeLessThan(0)
  })
})
