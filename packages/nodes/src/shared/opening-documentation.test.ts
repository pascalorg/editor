import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, LevelNode, WallNode, WindowNode } from '@pascal-app/core'
import {
  buildDoorFloorplanSchedule,
  buildOpeningMarkAnnotation,
  buildWindowFloorplanSchedule,
  computeDoorFloorplanLevelData,
  computeWindowFloorplanLevelData,
  OPENING_TAG_FONT_SIZE,
  OPENING_TAG_HEIGHT,
  OPENING_TAG_STROKE_WIDTH,
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
    const explicit = DoorNode.parse({ ...doorA, mark: 'D101' })
    const marks = computeDoorFloorplanLevelData({ siblings: [explicit, doorB], nodes })

    expect(marks.markById.get(explicit.id)).toBe('D101')
    expect(marks.markById.get(doorB.id)).toBe('D102')

    const upperFixture = fixture(1)
    const upperMarks = computeDoorFloorplanLevelData({
      siblings: [upperFixture.doorA],
      nodes: upperFixture.nodes,
    })
    expect(upperMarks.markById.get(upperFixture.doorA.id)).toBe('D201')
  })

  test('assigns stable window marks in level order', () => {
    const { nodes, windowA, windowB } = fixture()
    const marks = computeWindowFloorplanLevelData({
      siblings: [windowA, windowB],
      nodes,
    })

    expect(marks.markById.get(windowA.id)).toBe('W101')
    expect(marks.markById.get(windowB.id)).toBe('W102')
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
      mark: 'D101',
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
      mark: 'W101',
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

  // WS3: the tag moved to the EXTERIOR face and the outline is now a
  // hexagon for doors / an ellipse (24-gon) for windows.
  test('places the opening mark tag on the exterior face of an exterior wall', () => {
    const { doorA, nodes, wall } = fixture()
    const levelData = computeDoorFloorplanLevelData({ siblings: [doorA], nodes })
    const annotation = buildOpeningMarkAnnotation(doorA, wall, levelData)

    expect(annotation?.kind).toBe('group')
    if (annotation?.kind !== 'group') return
    const tag = annotation.children.find((child) => child.kind === 'text')
    expect(tag).toMatchObject({ kind: 'text', text: 'D101', x: 3 })
    // frontSide is exterior, so the tag sits on the +normal side (z > 0).
    expect(tag?.kind === 'text' ? tag.y : null).toBeGreaterThan(0)
  })

  test('door tags are hexagons and window tags are ellipses', () => {
    const { doorA, nodes, wall, windowA } = fixture()
    const doorTag = buildOpeningMarkAnnotation(
      doorA,
      wall,
      computeDoorFloorplanLevelData({ siblings: [doorA], nodes }),
    )
    const windowTag = buildOpeningMarkAnnotation(
      windowA,
      wall,
      computeWindowFloorplanLevelData({ siblings: [windowA], nodes }),
    )
    const outline = (annotation: typeof doorTag) =>
      annotation?.kind === 'group'
        ? annotation.children.find((child) => child.kind === 'polygon')
        : undefined
    expect(outline(doorTag)?.kind === 'polygon' ? outline(doorTag)?.points.length : 0).toBe(6)
    expect(outline(windowTag)?.kind === 'polygon' ? outline(windowTag)?.points.length : 0).toBe(24)
  })

  /*
   * TAG SIZE. The tag is emitted in world metres and read at a drawing scale,
   * so the assertions below convert back to PAPER INCHES at 1/4" = 1'-0"
   * (scale 48) — the size an architect actually judges a tag by.
   */
  const REFERENCE_SCALE = 48
  const INCHES_PER_METRE = 39.37007874015748
  const toPaperInches = (metres: number) => (metres * INCHES_PER_METRE) / REFERENCE_SCALE

  test('the tag is 0.28 in tall with a 0.02 in outline at 1/4 inch scale', () => {
    expect(toPaperInches(OPENING_TAG_HEIGHT)).toBeCloseTo(0.28, 6)
    expect(toPaperInches(OPENING_TAG_STROKE_WIDTH)).toBeCloseTo(0.02, 6)
    expect(toPaperInches(OPENING_TAG_FONT_SIZE)).toBeCloseTo(0.11, 6)
  })

  test('the drawn outline and mark text use those sizes', () => {
    const { doorA, nodes, wall } = fixture()
    const annotation = buildOpeningMarkAnnotation(
      doorA,
      wall,
      computeDoorFloorplanLevelData({ siblings: [doorA], nodes }),
    )
    expect(annotation?.kind).toBe('group')
    if (annotation?.kind !== 'group') return
    const outline = annotation.children.find((child) => child.kind === 'polygon')
    expect(outline?.kind === 'polygon' ? outline.strokeWidth : null).toBeCloseTo(
      OPENING_TAG_STROKE_WIDTH,
      9,
    )
    // Flat-top hexagon: the vertical span is the tag height.
    if (outline?.kind === 'polygon') {
      const ys = outline.points.map((p) => p[1])
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(OPENING_TAG_HEIGHT, 9)
    }
    const label = annotation.children.find((child) => child.kind === 'text')
    expect(label?.kind === 'text' ? label.fontSize : null).toBeCloseTo(OPENING_TAG_FONT_SIZE, 9)
    expect(label?.kind === 'text' ? label.fontWeight : null).toBe(700)
  })

  test('the tag clears the wall face rather than sitting on it', () => {
    const { doorA, nodes, wall } = fixture()
    const annotation = buildOpeningMarkAnnotation(
      doorA,
      wall,
      computeDoorFloorplanLevelData({ siblings: [doorA], nodes }),
    )
    if (annotation?.kind !== 'group') throw new Error('expected a group')
    const outline = annotation.children.find((child) => child.kind === 'polygon')
    if (outline?.kind !== 'polygon') throw new Error('expected an outline')
    const nearEdge = Math.min(...outline.points.map((p) => p[1]))
    // Wall face is at z = thickness / 2 = 0.1; the tag's near edge stands off it.
    expect(nearEdge).toBeGreaterThan(0.1)
    // …and a leader is drawn across that gap.
    const leader = annotation.children.find((child) => child.kind === 'line')
    expect(leader).toBeDefined()
  })

  test('a wide tag grows sideways, never taller', () => {
    const { doorA, nodes, wall } = fixture()
    const wide = { ...doorA, mark: 'D-101-EXT' }
    const annotation = buildOpeningMarkAnnotation(
      wide,
      wall,
      computeDoorFloorplanLevelData({ siblings: [wide], nodes }),
    )
    if (annotation?.kind !== 'group') throw new Error('expected a group')
    const outline = annotation.children.find((child) => child.kind === 'polygon')
    if (outline?.kind !== 'polygon') throw new Error('expected an outline')
    const xs = outline.points.map((p) => p[0])
    const ys = outline.points.map((p) => p[1])
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(OPENING_TAG_HEIGHT, 9)
    // Nine characters at 0.11 in each need well over the tag's own height.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(OPENING_TAG_HEIGHT * 2)
  })
})
