import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  createZone,
  floorFootprintSupportClass,
  generateId,
  getCeilingClampBound,
  getLevelElevations,
  initSpaceDetectionSync,
  LevelNode,
  type SlabNode,
  upperFloorHeightControl,
  useScene,
} from '@pascal-app/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FloorSection,
  floorFoundationModel,
  floorPlateKicker,
} from '../components/ui/panels/floor-foundation-panel'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import {
  applyFloorFoundation,
  beginFootprintHeightPreview,
  beginFootprintThicknessPreview,
  footprintHeightMinimum,
  footprintHeightPatch,
  footprintHeightValue,
  levelFootprints,
  presetPatch,
  setFootprintHeight,
  thickFloorAdvice,
} from './floor-footprints'
import { applyRoomPlan } from './room-structure-commands'

const GROUND = 'level_support_ground'
const UPPER = 'level_support_upper'
let stop = () => {}
let restoreFrames = () => {}
const nodes = () => useScene.getState().nodes as Record<string, AnyNode>

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
const room = (levelId: string, polygon: [number, number][], name: string) =>
  applyRoomPlan(createZone(nodes(), { levelId, polygon, enclose: true, mintId: generateId, name }))

beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  const building = BuildingNode.parse({ id: 'building_support', children: [GROUND, UPPER] })
  const ground = LevelNode.parse({
    id: GROUND,
    parentId: building.id,
    level: 0,
    name: 'Ground floor',
  })
  const upper = LevelNode.parse({ id: UPPER, parentId: building.id, level: 1, name: 'Floor 1' })
  useScene.setState({
    nodes: { [building.id]: building, [ground.id]: ground, [upper.id]: upper },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  room(GROUND, rect(0, 0, 8, 5), 'Living')
  room(UPPER, rect(0, 0, 8, 5), 'Bedroom')
  // A wing upstairs with nothing under it.
  room(UPPER, rect(20, 0, 24, 4), 'Studio')
})
afterEach(() => {
  stop()
  restoreFrames()
})

const plateOf = (levelId: string, name: string) =>
  levelFootprints(nodes(), levelId).find((plate) =>
    plate.zoneIds?.some((id) => nodes()[id]?.name === name),
  ) as SlabNode

describe('Floor & foundation support class (point 5)', () => {
  test('a floor over the storey below is supported; the ground and a free wing bear on the ground', () => {
    const house = plateOf(GROUND, 'Living')
    const bedroom = plateOf(UPPER, 'Bedroom')
    const studio = plateOf(UPPER, 'Studio')
    expect(floorFootprintSupportClass(nodes(), house)).toBe('ground-bearing')
    expect(floorFootprintSupportClass(nodes(), bedroom)).toBe('supported')
    expect(floorFootprintSupportClass(nodes(), studio)).toBe('ground-bearing')
  })

  test('the kicker says where the plate is and what it rests on', () => {
    expect(floorPlateKicker(nodes(), plateOf(GROUND, 'Living'))).toBe('Floor plate · Ground floor')
    expect(floorPlateKicker(nodes(), plateOf(UPPER, 'Bedroom'))).toBe(
      'Floor plate · Floor 1 · rests on Ground floor',
    )
  })

  test('the height handle drags down to the ground, or upstairs to resting on the walls below', () => {
    const house = plateOf(GROUND, 'Living')
    const bedroom = plateOf(UPPER, 'Bedroom')
    expect(footprintHeightValue(nodes(), house)).toBe(0)
    expect(footprintHeightMinimum(nodes(), house)).toBe(0)
    const control = upperFloorHeightControl(nodes(), bedroom)!
    expect(footprintHeightValue(nodes(), bedroom)).toBeCloseTo(control.currentTop)
    expect(footprintHeightMinimum(nodes(), bedroom)).toBeCloseTo(control.minimumTop)
    // A legacy plate hanging below its resting position starts where it is: no jump.
    const legacy = { ...bedroom, elevation: bedroom.elevation - 0.1, thickness: 0.3 }
    const legacyNodes = { ...nodes(), [legacy.id]: legacy }
    expect(footprintHeightMinimum(legacyNodes, legacy)).toBeCloseTo(
      footprintHeightValue(legacyNodes, legacy),
    )
  })

  test('raising an upper floor thickens it: the underside stays, the storey above rides up', () => {
    const floor2 = LevelNode.parse({
      id: 'level_support_2',
      parentId: 'building_support',
      level: 2,
    })
    const building = nodes().building_support as BuildingNode
    useScene.getState().createNode(floor2, building.id)
    room(floor2.id, rect(0, 0, 8, 5), 'Attic')
    const bedroom = plateOf(UPPER, 'Bedroom')
    const underside = bedroom.elevation - bedroom.thickness
    const groundCeiling = getCeilingClampBound(GROUND as AnyNodeId, nodes(), rect(0, 0, 8, 5))
    const atticBefore = getLevelElevations(nodes()).get(floor2.id)!.baseY
    const top = footprintHeightValue(nodes(), bedroom) + 0.25
    expect(footprintHeightPatch(nodes(), bedroom, top)).toEqual({
      thickness: expect.closeTo(bedroom.thickness + 0.25, 6),
    })
    expect(setFootprintHeight(bedroom.id, top)).toBeNull()
    const raised = nodes()[bedroom.id] as SlabNode
    expect(raised.elevation - raised.thickness).toBeCloseTo(underside)
    expect(raised.elevation).toBeCloseTo(bedroom.elevation + 0.25)
    expect(getCeilingClampBound(GROUND as AnyNodeId, nodes(), rect(0, 0, 8, 5))).toBeCloseTo(
      groundCeiling,
    )
    expect(getLevelElevations(nodes()).get(floor2.id)!.baseY).toBeCloseTo(atticBefore + 0.25)
  })

  test('a very thick upper floor advises a mezzanine, never refuses', () => {
    const bedroom = plateOf(UPPER, 'Bedroom')
    const underside = bedroom.elevation - bedroom.thickness
    expect(thickFloorAdvice(nodes(), bedroom, underside + 0.35)).toBe(false)
    expect(thickFloorAdvice(nodes(), bedroom, underside + 0.45)).toBe(true)
    expect(setFootprintHeight(bedroom.id, underside + 0.45)).toBeNull()
    expect(floorFoundationModel(nodes(), nodes()[bedroom.id] as SlabNode).thickFloor).toBe(true)
  })
})

describe('Upper-floor height drag release (round-final item 6)', () => {
  // The handle and the panel scrub both preview live and land once on release:
  // every release, small or thick, must write the value as one undo step.
  for (const delta of [0.01, 0.05, 0.2, 0.5, -0.02]) {
    test(`a drag of ${delta} m lands on release`, () => {
      const bedroom = plateOf(UPPER, 'Bedroom')
      const start = footprintHeightValue(nodes(), bedroom)
      const past = useScene.temporal.getState().pastStates.length
      const preview = beginFootprintHeightPreview(bedroom.id)
      expect(preview.preview(start + delta / 2)).toBeNull()
      expect(preview.preview(start + delta)).toBeNull()
      expect(preview.commit(start + delta)).toBeNull()
      const after = nodes()[bedroom.id] as SlabNode
      expect(after.thickness).toBeCloseTo(bedroom.thickness + delta, 6)
      expect(footprintHeightValue(nodes(), after)).toBeCloseTo(start + delta, 6)
      expect(useScene.temporal.getState().pastStates.length).toBe(past + 1)
    })
  }
})

describe('Floor & foundation panel (point 5)', () => {
  test('a ground floor gets the foundation group; an upper floor never offers the ground', () => {
    const ground = floorFoundationModel(nodes(), plateOf(GROUND, 'Living'))
    expect(ground).toMatchObject({ upper: false, preset: 'ground', underFloor: true, minHeight: 0 })
    const upper = floorFoundationModel(nodes(), plateOf(UPPER, 'Bedroom'))
    expect(upper).toMatchObject({ upper: true, underFloor: false, thickFloor: false })
    expect(upper.kicker).toBe('Floor plate · Floor 1 · rests on Ground floor')
  })

  test('on the ground the two inputs are slab thickness and foundation height; the top follows', () => {
    const living = plateOf(GROUND, 'Living')
    const start = floorFoundationModel(nodes(), living)
    expect(start).toMatchObject({ preset: 'ground', height: 0, minThickness: 0.01 })
    expect(start.floorTop).toBeCloseTo(living.thickness)
    expect(applyFloorFoundation(living.id, { thickness: 0.1 })).toBeNull()
    let plate = nodes()[living.id] as SlabNode
    expect(floorFoundationModel(nodes(), plate)).toMatchObject({
      preset: 'ground',
      height: 0,
      floorTop: expect.closeTo(0.1),
    })
    expect(applyFloorFoundation(living.id, presetPatch(nodes(), plate, 'raised'))).toBeNull()
    plate = nodes()[living.id] as SlabNode
    expect(floorFoundationModel(nodes(), plate)).toMatchObject({
      preset: 'raised',
      height: expect.closeTo(0.3),
      floorTop: expect.closeTo(0.4),
    })
    expect(plate.foundation?.type).toBe('solid')
    expect(applyFloorFoundation(living.id, presetPatch(nodes(), plate, 'ground'))).toBeNull()
    plate = nodes()[living.id] as SlabNode
    expect(floorFoundationModel(nodes(), plate)).toMatchObject({
      preset: 'ground',
      height: 0,
      floorTop: expect.closeTo(0.1),
    })
    expect(plate.foundation?.type).toBe('none')
  })

  test('a slab thickness scrub moves the building live and lands as one undo step', () => {
    const living = plateOf(GROUND, 'Living')
    useScene.temporal.getState().clear()
    const past = 0
    const scrub = beginFootprintThicknessPreview(living.id)
    expect(scrub.preview(0.2)).toBeNull()
    const live = nodes()[living.id] as SlabNode
    expect(live.thickness).toBeCloseTo(0.2)
    expect(live.elevation).toBeCloseTo(0.2)
    expect(useScene.temporal.getState().pastStates.length).toBe(past)
    expect(scrub.preview(0.12)).toBeNull()
    expect(scrub.commit(0.12)).toBeNull()
    const after = nodes()[living.id] as SlabNode
    expect(after.thickness).toBeCloseTo(0.12)
    expect(after.elevation).toBeCloseTo(0.12)
    expect(useScene.temporal.getState().pastStates.length).toBe(past + 1)
    useScene.temporal.getState().undo()
    expect((nodes()[living.id] as SlabNode).thickness).toBeCloseTo(living.thickness)
  })

  test('upstairs the one control is the thickness; the floor top above the ground is its caption', () => {
    const bedroom = plateOf(UPPER, 'Bedroom')
    const before = floorFoundationModel(nodes(), bedroom)
    const base = getLevelElevations(nodes()).get(UPPER as AnyNodeId)!.baseY
    expect(before.floorTop).toBeCloseTo(base + before.height)
    expect(setFootprintHeight(bedroom.id, before.height + 0.1)).toBeNull()
    const after = floorFoundationModel(nodes(), nodes()[bedroom.id] as SlabNode)
    expect((nodes()[bedroom.id] as SlabNode).thickness).toBeCloseTo(bedroom.thickness + 0.1)
    expect(after.floorTop).toBeCloseTo(before.floorTop + 0.1)
  })

  test('the section draws top to bottom in build order, labelled not to scale', () => {
    const section = (props: Partial<Parameters<typeof FloorSection>[0]>) =>
      renderToStaticMarkup(
        createElement(FloorSection, {
          supported: false,
          raised: false,
          thickness: 0.2,
          thicknessLabel: '0.20 m',
          ...props,
        }),
      )
    const raised = section({
      raised: true,
      foundationHeight: 0.5,
      foundationLabel: '0.50 m',
      topLabel: '0.70 m',
    })
    const order = ['Floor top', 'Slab · 0.20 m', 'Foundation · 0.50 m', 'Ground'].map((label) =>
      raised.indexOf(`>${label}<`),
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // The floor top is measured from the ground: foundation + slab.
    expect(raised).toContain('>0.70 m<')
    const onGround = section({ topLabel: '0.20 m' })
    expect(onGround).not.toContain('data-section-foundation')
    expect(onGround).toContain('>0.20 m<')
    expect(raised).toContain('Not to scale')
    const upstairs = section({ supported: true, lift: 0.25, liftLabel: '+0.25 m' })
    expect(upstairs).toContain('>Walls below<')
    expect(upstairs).not.toContain('>Foundation<')
    expect(upstairs).not.toContain('>Ground<')
    expect(section({})).not.toContain('Floor edge band')
  })
})
