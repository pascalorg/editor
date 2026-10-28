import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingFoundationRecord,
  BuildingNode,
  createI18n,
  createTerrainField,
  createZone,
  type DesignedFoundationReport,
  designedFoundationReport,
  encodeTerrainField,
  generateId,
  genericFoundation,
  groundFloorConstruction,
  initSpaceDetectionSync,
  LevelNode,
  resolveBuildingFoundation,
  SiteNode,
  type SlabNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import {
  floorFoundationModel,
  upperFloorTopLabel,
} from '../components/ui/panels/floor-foundation-panel'
import { footprintStanding } from '../components/ui/panels/room-construction-rows'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import {
  applyBuildingFoundation,
  floorHeldByDesignedFoundation,
  foundationAdvice,
  groundSeatAction,
  standsOnBasement,
} from './building-foundation'
import { applyFloorFoundation, levelFootprints } from './floor-footprints'
import { applyRoomPlan } from './room-structure-commands'

const IN = 0.0254
const inches = (meters: number) => `${Math.round((meters / IN) * 100) / 100} in`
const english = createI18n()
// A raised floor's least finish floor over grade: the stem's top 8 in over it, the default framing
// on that (¾ in hardwood, ⅝ in subfloor, 2x12 joists, 1½ in sill: 14⅛ in).
const RAISED_FLOOR_IN = 8 + 14.125

/** A foundation on flat ground (grade at 0), its floor seated as the record asks. */
function report(
  record: BuildingFoundationRecord,
  storeys = 1,
  extra: Partial<DesignedFoundationReport> = {},
): DesignedFoundationReport {
  const foundation = resolveBuildingFoundation({ enabled: true, ...record }, storeys)
  const floorTopY = foundation.ffAboveGradeIn * IN
  const stemTopY =
    foundation.type === 'raised' ? floorTopY - foundation.floorFramingDepthIn * IN : null
  return {
    buildingId: 'building_a',
    levelId: 'level_g',
    foundation,
    floorTopY,
    highestGradeY: 0,
    lowestGradeY: 0,
    stemTopY,
    bottomY: -foundation.footingDepthIn * IN,
    steps: 0,
    tallestStep: 0,
    piles: 0,
    cripples: 0,
    tallestCripple: 0,
    crawlY: stemTopY === null ? null : stemTopY + 1.5 * IN - foundation.crawlClearanceIn * IN,
    ...extra,
  }
}

const keys = (advice: ReturnType<typeof foundationAdvice>) => advice.map((item) => item.key)

test('a foundation to code on flat ground has nothing to warn of', () => {
  expect(keys(foundationAdvice(report({ type: 'slab' }), inches, english))).toEqual([])
})

test('a footing or slab edge under 12 in of grade is warned of, with the fix', () => {
  const raised = foundationAdvice(report({ type: 'raised', footingDepthIn: 6 }), inches, english)
  const depth = raised.find((item) => item.key === 'depth')
  expect(depth?.text).toContain('6 in under grade')
  expect(depth?.fix?.patch).toEqual({ footingDepthIn: 12 })
  const slab = foundationAdvice(report({ type: 'slab', edgeDepthIn: 0 }), inches, english)
  expect(slab.find((item) => item.key === 'depth')?.fix?.patch).toEqual({ edgeDepthIn: 12 })
  // Piles are engineered: no depth asked of the grade beam here.
  const piles = report({ type: 'raised', support: 'piles', footingDepthIn: 6 })
  expect(keys(foundationAdvice(piles, inches, english))).not.toContain('depth')
})

test('a footing narrower than Table R403.1(1) asks for the storeys is warned of', () => {
  const two = foundationAdvice(report({ type: 'raised', footingWidthIn: 12 }, 2), inches, english)
  const width = two.find((item) => item.key === 'footing-width')
  expect(width?.text).toContain('2 storeys ask 15 in')
  expect(width?.fix?.patch).toEqual({ footingWidthIn: 15 })
  expect(keys(foundationAdvice(report({ type: 'raised' }, 2), inches, english))).not.toContain(
    'footing-width',
  )
})

test('the step note counts one side and names the tallest step', () => {
  const even = foundationAdvice(
    report({ type: 'raised' }, 1, { steps: 2, tallestStep: 8 * IN, lowestGradeY: -0.5 }),
    inches,
    english,
  ).find((item) => item.key === 'steps')
  expect(even?.text).toContain('steps 2 times along its steepest side, 8 in a step')
  const merged = foundationAdvice(
    report({ type: 'raised' }, 1, { steps: 1, tallestStep: 16 * IN, lowestGradeY: -0.5 }),
    inches,
    english,
  ).find((item) => item.key === 'steps')
  expect(merged?.text).toContain('up to 16 in a step')
})

test('a floor the ground has risen over reads as under it', () => {
  const sunk = report({ type: 'slab' }, 1, { highestGradeY: 1, lowestGradeY: 1 })
  const seat = foundationAdvice(sunk, inches, english).find((item) => item.key === 'seat')
  expect(seat?.text).toContain('stands 31.37 in under the high side')
})

test('a house on a basement with walls says so; one standing at grade does not', () => {
  const corners: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_b_${index}`,
      parentId: 'level_b',
      start,
      end: corners[(index + 1) % 4],
    }),
  )
  const scene = (y: number) =>
    Object.fromEntries(
      [
        SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
        BuildingNode.parse({
          id: 'building_a',
          parentId: 'site_a',
          position: [0, y, 0],
          children: ['level_b', 'level_g'],
        }),
        LevelNode.parse({
          id: 'level_b',
          parentId: 'building_a',
          level: 0,
          height: 3,
          children: walls.map((wall) => wall.id),
        }),
        LevelNode.parse({ id: 'level_g', parentId: 'building_a', level: 1 }),
        ...walls,
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
  // The lower floor 2.9 m under the ground, the one over it at grade.
  expect(standsOnBasement(scene(-2.9), 'building_a')).toBe(true)
  expect(standsOnBasement(scene(0), 'building_a')).toBe(false)
})

test('the ground round a slab is filled and cut to hold it 8 in under the top; deep fill asks for a stem wall', () => {
  const said = (seated: DesignedFoundationReport, key: string) =>
    foundationAdvice(seated, inches, english).find((item) => item.key === key)?.text
  expect(said(report({ type: 'slab', ffAboveGradeIn: 30 }), 'grading')).toBe(
    'The ground is held 8 in under the slab’s top on every side: filled 22 in.',
  )
  const slope = report({ type: 'slab' }, 1, { lowestGradeY: -0.6 })
  expect(said(slope, 'grading')).toBe(
    'The ground is held 8 in under the slab’s top on every side: filled up to 23.62 in on the low side.',
  )
  expect(said(slope, 'exposed')).toBeUndefined()
  expect(
    said(report({ type: 'slab' }, 1, { highestGradeY: 0.1, lowestGradeY: -0.1 }), 'grading'),
  ).toBe(
    'The ground is held 8 in under the slab’s top on every side: filled up to 3.94 in on the low side, cut 3.94 in on the high side.',
  )
  expect(said(report({ type: 'slab' }, 1, { lowestGradeY: -0.8 }), 'exposed')).toBe(
    'That is 31.5 in of fill on the low side. A raised floor on a stem wall suits this slope.',
  )
  expect(said(report({ type: 'slab', ffAboveGradeIn: 40 }), 'exposed')).toBe(
    'That is 32 in of fill. A raised floor on a stem wall suits a floor this high.',
  )
})

test('a raised floor notes its crawl space dug out, the ground cut round it, and its cripple walls', () => {
  const said = (seated: DesignedFoundationReport, key: string) =>
    foundationAdvice(seated, inches, english).find((item) => item.key === key)?.text
  // The stem's top 8 in over flat ground: the joists 9.5 in over it, the crawl dug 8.5 in.
  const raised = report({ type: 'raised' })
  expect(said(raised, 'crawl')).toBe(
    'Crawl space: dug out up to 8.5 in for 18 in under the joists (IRC R317.1).',
  )
  expect(said(raised, 'top')).toBeUndefined()
  expect(said(report({ type: 'raised' }, 1, { highestGradeY: 4 * IN }), 'top')).toBe(
    'The ground is cut 4 in on the high side to hold the stem wall’s top 8 in over it (IRC R317.1). Raising the floor cuts less.',
  )
  expect(
    said(report({ type: 'raised' }, 1, { cripples: 3, tallestCripple: 16 * IN }), 'cripple'),
  ).toBe(
    'Past 36 in of stem out of the ground the stem drops to 8 in over grade: 3 cripple walls over it, up to 16 in tall.',
  )
  expect(said(report({ type: 'slab' }), 'crawl')).toBeUndefined()
})

test('over a basement the panel speaks of its walls’ seat, its dig and a downhill wall out of the ground', () => {
  const said = (seated: DesignedFoundationReport) =>
    Object.fromEntries(
      foundationAdvice(seated, inches, english).map((item) => [item.key, item.text]),
    )
  // Flat ground at 0, the slab's underside 2.8 m under it.
  const basement = (wallTopY: number, extra: Partial<DesignedFoundationReport> = {}) =>
    report({}, 1, {
      levelId: 'level_b',
      floorTopY: -2.7,
      stemTopY: wallTopY,
      crawlY: null,
      basement: {
        groundLevelId: 'level_g',
        outlineLevelId: 'level_g',
        ownWalls: false,
        wallTopY,
        groundFloorTopY: wallTopY + 14.125 * IN,
        excavationY: -2.8,
      },
      ...extra,
    })
  expect(said(basement(8 * IN))).toEqual({
    excavation:
      'Cut 110.24 in into the ground on the high side, dug out inside the walls’ outside faces; the ground round the house is left as it lies.',
  })
  // Added under a house at grade: the framing over it in the ground until the house is seated.
  const sunk = foundationAdvice(basement(-10 * IN), inches, english)
  expect(sunk.map((item) => item.key)).toEqual(['seat', 'excavation'])
  expect(sunk[0]!.text).toBe(
    'The basement wall’s top stands 10 in under the high side of the ground; the foundation is set for 8 in over it.',
  )
  expect(sunk[0]!.fix).toEqual({ label: 'Seat it at 8 in', patch: {} })
  expect(said(basement(8 * IN, { lowestGradeY: -1 })).daylight).toBe(
    'The ground falls 39.37 in across the house: the downhill walls stand up to 47.37 in out of it.',
  )
  const low = basement(4 * IN, {
    foundation: resolveBuildingFoundation({ enabled: true, basementTopAboveGradeIn: 4 }, 1),
  })
  expect(foundationAdvice(low, inches, english).map((item) => item.key)).toEqual([
    'basement-top',
    'excavation',
  ])
})

test('the ground line says which rule its click seats the house by', () => {
  expect(groundSeatAction('basement', 8, english)).toBe(
    'Seat the basement wall’s top 8 in over the high side of the ground',
  )
  expect(groundSeatAction('raised', 22.125, english)).toBe(
    'Seat the raised floor’s top 22.13 in over the high side of the ground',
  )
  expect(groundSeatAction('slab', 8, english)).toBe(
    'Seat the slab’s top 8 in over the high side of the ground',
  )
  expect(groundSeatAction('construction', 7.99, english)).toBe(
    'Seat the ground floor 7.99 in over grade',
  )
})

test('a floor top under the ground prints one minus, not "+-"', () => {
  expect(upperFloorTopLabel(-5 * IN, inches)).toBe('Floor top -5 in')
  expect(upperFloorTopLabel(110 * IN, inches)).toBe('Floor top +110 in')
})

describe('switching the foundation on from the floor panel', () => {
  let stop = () => {}
  let restore = () => {}
  afterEach(() => {
    stop()
    restore()
  })
  const nodes = () => useScene.getState().nodes as Record<string, AnyNode>

  /** The site's ground rising 10 cm a metre to the east, `drop` metres lower all over. */
  function slope(drop = 0) {
    const field = createTerrainField({ cols: 41, rows: 41, spacing: 1, origin: [-20, -20] })
    const heights = new Int16Array(field.heights)
    for (let row = 0; row < 41; row++)
      for (let col = 0; col < 41; col++) heights[row * 41 + col] = (col - 20) * 10 - drop * 100
    return encodeTerrainField({ ...field, heights })
  }

  /** A one-room house drawn as the editor draws it, its floor plate derived from the room. */
  function drawHouse({
    terrain,
    rotated,
  }: {
    terrain?: ReturnType<typeof encodeTerrainField>
    rotated?: boolean
  }) {
    restore = installImmediateAnimationFrames()
    const site = SiteNode.parse({ id: 'site_f', children: ['building_f'], terrain })
    const building = BuildingNode.parse({
      id: 'building_f',
      parentId: site.id,
      children: ['level_f'],
      ...(rotated ? { position: [2, 0, -3], rotation: [0, 0.6, 0] } : {}),
    })
    const level = LevelNode.parse({
      id: 'level_f',
      parentId: building.id,
      level: 0,
      name: 'Ground floor',
    })
    useScene.setState({
      nodes: { [site.id]: site, [building.id]: building, [level.id]: level },
      rootNodeIds: [site.id],
      dirtyNodes: new Set(),
      materials: {},
      collections: {},
      readOnly: false,
    })
    useScene.temporal.getState().resume()
    stop = initSpaceDetectionSync(useScene, {
      getState: () => ({ spaces: {}, setSpaces: () => {} }),
    })
    const polygon: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ]
    applyRoomPlan(
      createZone(nodes(), {
        levelId: level.id,
        polygon,
        enclose: true,
        mintId: generateId,
        name: 'Living',
      }),
    )
    useScene.temporal.getState().clear()
  }
  const plate = () => levelFootprints(nodes(), 'level_f')[0] as SlabNode
  const seat = () => designedFoundationReport(nodes() as Record<AnyNodeId, AnyNode>, 'building_f')!
  const over = () => seat().floorTopY - seat().highestGradeY
  /** The floor panel and the Room panel still read the house's ground floor. */
  const expectGroundFloor = (designed: boolean) => {
    expect(floorFoundationModel(nodes(), plate())).toMatchObject({
      upper: false,
      underFloor: true,
      preset: 'ground',
    })
    expect(footprintStanding(nodes(), plate())).toMatchObject({ supported: false, designed })
    // The record's finish floor is the floor's height: the 3D height handle steps aside.
    expect(floorHeldByDesignedFoundation(nodes(), plate())).toBe(designed)
  }

  test('the ground floor stays a ground floor through type, support, sizes, off and undo', () => {
    drawHouse({})
    expect(applyBuildingFoundation('building_f', { enabled: true })).toBe(true)
    expectGroundFloor(true)
    // The default: a 4 in slab, its top 8 in over grade.
    expect(seat().foundation.type).toBe('slab')
    expect(over()).toBeCloseTo(8 * IN, 6)
    const slab = genericFoundation(nodes() as Record<AnyNodeId, AnyNode>).find(
      (member) => member.kind === 'slab',
    )!
    expect(slab.bottomY).toBeCloseTo(seat().floorTopY - 4 * IN, 6)

    applyBuildingFoundation('building_f', { type: 'raised' })
    expectGroundFloor(true)
    expect(over()).toBeCloseTo(RAISED_FLOOR_IN * IN, 6)
    applyBuildingFoundation('building_f', { support: 'piles' })
    expect(
      genericFoundation(nodes() as Record<AnyNodeId, AnyNode>).some((m) => m.kind === 'pile'),
    ).toBe(true)
    applyBuildingFoundation('building_f', { ffAboveGradeIn: 30 })
    expectGroundFloor(true)
    expect(over()).toBeCloseTo(30 * IN, 6)

    applyBuildingFoundation('building_f', { enabled: false })
    expectGroundFloor(false)
    useScene.temporal.getState().undo()
    expectGroundFloor(true)
    useScene.temporal.getState().redo()
    expectGroundFloor(false)
  })

  // The plate's own raise stayed under the designed foundation: the seat lowered the house by it,
  // and past 0.3 m the floor read as a basement and the Foundation section, off switch and all, went.
  for (const raise of [0.3, 0.5])
    test(`a floor raised ${raise} m on its own comes down onto the designed foundation, in one step`, () => {
      drawHouse({})
      expect(applyFloorFoundation(plate().id, { foundationHeight: raise })).toBeNull()
      useScene.temporal.getState().clear()
      applyBuildingFoundation('building_f', { enabled: true })
      expectGroundFloor(true)
      expect(groundFloorConstruction(nodes(), plate()).foundationHeight).toBe(0)
      expect(footprintStanding(nodes(), plate()).lift).toBe(0)
      expect(over()).toBeCloseTo(8 * IN, 6)
      expect((nodes().building_f as BuildingNode).position[1]).toBeGreaterThan(0)
      useScene.temporal.getState().undo()
      expect((nodes().building_f as BuildingNode).position[1]).toBe(0)
      expect(groundFloorConstruction(nodes(), plate()).foundationHeight).toBeCloseTo(raise, 6)
    })

  // Switched on with the outside walls open, nothing seated the floor, yet its thickness and
  // height were hidden as the foundation's.
  test('with the record on and nothing designed, the floor keeps its own controls', () => {
    drawHouse({})
    const wall = Object.values(nodes()).find((node) => node.type === 'wall')!
    useScene.getState().deleteNode(wall.id as AnyNodeId)
    applyBuildingFoundation('building_f', { enabled: true })
    expect(designedFoundationReport(nodes() as Record<AnyNodeId, AnyNode>, 'building_f')).toBeNull()
    expect(floorHeldByDesignedFoundation(nodes(), plate())).toBe(false)
    expect(footprintStanding(nodes(), plate()).designed).toBe(false)
  })

  for (const rotated of [false, true])
    test(`on a slope${rotated ? ', the house turned,' : ''} the first seat stands the floor over the high side`, () => {
      drawHouse({ terrain: slope(), rotated })
      applyBuildingFoundation('building_f', { enabled: true })
      expectGroundFloor(true)
      expect(over()).toBeCloseTo(8 * IN, 6)
      expect(keys(foundationAdvice(seat(), inches, english))).not.toContain('seat')
      applyBuildingFoundation('building_f', { type: 'raised' })
      expect(over()).toBeCloseTo(RAISED_FLOOR_IN * IN, 6)
    })

  // The house's high side 1 m under the datum: the seat moves the building down onto the ground.
  test('on ground lower than the datum the first seat moves the house down to it', () => {
    drawHouse({ terrain: slope(2) })
    applyBuildingFoundation('building_f', { enabled: true })
    expect((nodes().building_f as BuildingNode).position[1]).toBeLessThan(0)
    expectGroundFloor(true)
    expect(over()).toBeCloseTo(8 * IN, 6)
    applyBuildingFoundation('building_f', { type: 'raised' })
    expectGroundFloor(true)
    expect(over()).toBeCloseTo(RAISED_FLOOR_IN * IN, 6)
  })
})
