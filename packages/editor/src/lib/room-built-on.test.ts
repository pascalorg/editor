import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  clearSceneHistory,
  createZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  SlabNode,
  type SlabNode as SlabNodeType,
  useScene,
  ZoneNode,
  type ZoneNode as ZoneNodeType,
} from '@pascal-app/core'
import { roomBuiltOn, roomFloorChoices, roomFloorKey, separateFloorSummary } from './room-built-on'
import { roomConstructionState } from './room-construction'
import {
  commitRoomFloorElevation,
  roomRelativeFloorHeight,
  separateFloorOffset,
  setRoomFloor,
  setRoomRelativeFloorHeight,
  stepRoomFloorElevation,
} from './room-construction-commands'
import {
  commitRoomElevation,
  ownFloorElevationBounds,
  roomFloorElevation,
} from './room-handle-drag'
import { applyRoomPlan } from './room-structure-commands'
import { showRoomNotice, useRoomTransform } from './room-transform-session'

const LEVEL = 'level_built_on'
type Ring = [number, number][]

const rect = (x0: number, z0: number, x1: number, z1: number): Ring => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

/** A room; `key` puts it on a separate floor (set past the schema, which may lag the key type). */
const zone = (id: string, name: string, polygon: Ring, key?: string) => {
  const room = ZoneNode.parse({ id, name, parentId: LEVEL, polygon, spaceRole: 'room' })
  return (key ? { ...room, floor: { ...room.floor, footprint: key } } : room) as ZoneNode
}

const plate = (id: string, polygon: Ring, zoneIds: string[], elevation: number, name?: string) =>
  SlabNode.parse({
    id,
    name,
    parentId: LEVEL,
    polygon,
    plateRole: 'base',
    boundary: 'auto',
    zoneIds,
    elevation,
  })

const scene = (...nodes: AnyNode[]): Record<string, AnyNode> =>
  Object.fromEntries(
    [LevelNode.parse({ id: LEVEL }), ...nodes].map((node) => [node.id, node as AnyNode]),
  )

const living = zone('zone_living', 'Living', rect(0, 0, 4, 4))
const lanai = zone('zone_lanai', 'Lanai', rect(4, 0, 6, 4))
const keyedLanai = zone('zone_lanai', 'Lanai', rect(4, 0, 6, 4), 'floor_lanai')
const length = (meters: number) => `${meters.toFixed(2)} m`

describe('Built on: when the picker shows and what it offers', () => {
  test('a room sharing its footprint offers that floor, named as the footprint is', () => {
    const house = plate('slab_house', rect(0, 0, 6, 4), [living.id, lanai.id], 0.15)
    const model = roomBuiltOn(scene(living, lanai, house), lanai.id)
    expect(model?.current).toEqual({ key: null, plateId: house.id, name: 'Shared floor' })
    expect(model?.choices).toHaveLength(1)
    // A floor the user named shows that name.
    const named = plate('slab_house', rect(0, 0, 6, 4), [living.id, lanai.id], 0.15, 'Cabin')
    expect(roomBuiltOn(scene(living, lanai, named), lanai.id)?.current.name).toBe('Cabin')
  })

  test('a room alone on the shared floor with no other floor touching has no choice to make', () => {
    const shed = plate('slab_shed', rect(10, 0, 12, 4), [lanai.id], 0.05)
    expect(roomBuiltOn(scene(lanai, shed), lanai.id)).toBeNull()
  })

  test('a room on a separate floor lists the floors it touches, current first, and reads against the shared floor', () => {
    const house = plate('slab_house', rect(0, 0, 4, 4), [living.id], 0.15)
    const own = plate('slab_lanai', rect(4, 0, 6, 4), [keyedLanai.id], 0)
    const far = plate('slab_far', rect(20, 0, 24, 4), ['zone_far'], 0.05)
    const farRoom = zone('zone_far', 'Studio', rect(20, 0, 24, 4))
    const nodes = scene(living, keyedLanai, house, own, far, farRoom)
    const model = roomBuiltOn(nodes, keyedLanai.id)!
    expect(model.choices).toEqual([
      { key: 'floor_lanai', plateId: own.id, name: 'Lanai floor' },
      { key: null, plateId: house.id, name: 'Living floor' },
    ])
    expect(model.shared?.plateId).toBe(house.id)
    expect(separateFloorOffset(nodes, keyedLanai.id)).toBeCloseTo(-0.15)
    // The house room touches the lanai's floor: it may join it.
    expect(roomFloorChoices(nodes, living.id).map((choice) => choice.key)).toEqual([
      null,
      'floor_lanai',
    ])
  })

  test('a room on a separate floor no shared floor touches can still go back to the shared floor', () => {
    const own = plate('slab_lanai', rect(4, 0, 6, 4), [keyedLanai.id], 0)
    const nodes = scene(keyedLanai, own)
    const model = roomBuiltOn(nodes, keyedLanai.id)!
    expect(model.choices).toEqual([
      { key: 'floor_lanai', plateId: own.id, name: 'Lanai floor' },
      { key: null, plateId: null, name: 'Shared floor' },
    ])
    expect(model.shared).toBeNull()
    expect(separateFloorOffset(nodes, keyedLanai.id)).toBeNull()
    expect(
      separateFloorSummary({ ...model, offset: separateFloorOffset(nodes, keyedLanai.id) }, length),
    ).toBe('Lanai floor')
  })

  test('a room alone on the shared floor still sees a separate floor it touches', () => {
    const house = plate('slab_house', rect(0, 0, 4, 4), [living.id], 0.15)
    const own = plate('slab_lanai', rect(4, 0, 6, 4), [keyedLanai.id], 0)
    expect(roomBuiltOn(scene(living, keyedLanai, house, own), living.id)?.choices).toHaveLength(2)
  })

  test('a room standing on a drawn slab has its floor on the slab: no picker', () => {
    const drawn = SlabNode.parse({ id: 'slab_drawn', parentId: LEVEL, polygon: rect(4, 0, 6, 4) })
    const onSlab = ZoneNode.parse({
      id: 'zone_lanai',
      name: 'Lanai',
      parentId: LEVEL,
      polygon: rect(4, 0, 6, 4),
      spaceRole: 'room',
      floor: { sourceSlabId: drawn.id },
    })
    const house = plate('slab_house', rect(0, 0, 4, 4), [living.id], 0.15)
    expect(roomBuiltOn(scene(living, onSlab, house, drawn), onSlab.id)).toBeNull()
  })

  test('a mezzanine has no footprint: no picker', () => {
    const mezzanine = ZoneNode.parse({
      id: 'zone_mezz',
      name: 'Loft',
      parentId: LEVEL,
      polygon: rect(0, 0, 2, 2),
      spaceRole: 'room',
      hostZoneId: living.id,
      floor: { support: 'open', elevation: 2.4 },
    })
    const house = plate('slab_house', rect(0, 0, 6, 4), [living.id, lanai.id, mezzanine.id], 0.15)
    expect(roomBuiltOn(scene(living, lanai, mezzanine, house), mezzanine.id)).toBeNull()
  })
})

describe('Built on: the Floor row summary', () => {
  const lanaiFloor = { name: 'Lanai floor' }
  test('says how a separate floor sits against the shared floor', () => {
    const shared = { name: 'Shared floor' }
    expect(separateFloorSummary({ current: lanaiFloor, shared, offset: -0.15 }, length)).toBe(
      'Lanai floor · 0.15 m below Shared floor',
    )
    expect(
      separateFloorSummary({ current: lanaiFloor, shared: { name: 'Cabin' }, offset: 0.3 }, length),
    ).toBe('Lanai floor · 0.30 m above Cabin')
    expect(separateFloorSummary({ current: lanaiFloor, shared, offset: 0.002 }, length)).toBe(
      'Lanai floor · level with Shared floor',
    )
    expect(separateFloorSummary({ current: lanaiFloor, shared: null, offset: null }, length)).toBe(
      'Lanai floor',
    )
  })

  test("compares the room's walking surface with the shared-floor room beside it, not plate with plate", () => {
    const wall = 'wall_between'
    // The living room is raised 0.15 on the 0.15 house plate: it walks at 0.30.
    const raised = {
      ...living,
      boundaryWallIds: [wall],
      floor: { ...living.floor, elevation: 0.3 },
    } as ZoneNodeType
    const walled = { ...keyedLanai, boundaryWallIds: [wall] } as ZoneNodeType
    const house = plate('slab_house', rect(0, 0, 4, 4), [living.id], 0.15)
    const own = plate('slab_lanai', rect(4, 0, 6, 4), [keyedLanai.id], 0)
    const nodes = scene(raised, walled, house, own)
    expect(separateFloorOffset(nodes, keyedLanai.id)).toBeCloseTo(-0.3)
    const model = roomBuiltOn(nodes, keyedLanai.id)!
    expect(
      separateFloorSummary({ ...model, offset: separateFloorOffset(nodes, keyedLanai.id) }, length),
    ).toBe('Lanai floor · 0.30 m below Living floor')
    // Nothing shared across a wall or open side: the shared plate's top.
    expect(separateFloorOffset(scene(raised, keyedLanai, house, own), keyedLanai.id)).toBeCloseTo(
      -0.15,
    )
    // A room on the shared floor has no step to state.
    expect(separateFloorOffset(nodes, living.id)).toBeNull()
  })
})

describe('Built on: moving between floors, through core', () => {
  const INT = 'level_built_on_live'
  const live = () => useScene.getState().nodes as Record<string, AnyNode>
  const steps = () => useScene.temporal.getState().pastStates.length
  let stop = () => {}
  let houseRoom = ''
  let lanaiRoom = ''

  const draw = (polygon: Ring, name: string) => {
    const plan = createZone(live(), {
      levelId: INT,
      polygon,
      enclose: true,
      mintId: generateId,
      name,
    })
    applyRoomPlan(plan)
    return plan.zoneId
  }

  beforeEach(() => {
    globalThis.requestAnimationFrame ??= (callback) => {
      callback(0)
      return 0
    }
    globalThis.cancelAnimationFrame ??= () => {}
    const building = BuildingNode.parse({ id: 'building_built_on', children: [INT] })
    const level = LevelNode.parse({ id: INT, parentId: building.id })
    useScene.setState({
      nodes: { [building.id]: building, [level.id]: level },
      rootNodeIds: [building.id],
      dirtyNodes: new Set(),
      materials: {},
      collections: {},
      readOnly: false,
    })
    useScene.temporal.getState().resume()
    stop = initSpaceDetectionSync(useScene, {
      getState: () => ({ spaces: {}, setSpaces: () => {} }),
    })
    houseRoom = draw(rect(0, 0, 5, 4), 'Living')
    draw(rect(5, 0, 8, 4), 'Bedroom')
    lanaiRoom = draw(rect(0, 4, 5, 7), 'Lanai')
    expect(setRoomRelativeFloorHeight(lanaiRoom, -0.15).status).toBe('applied')
    clearSceneHistory()
  })
  afterEach(() => {
    stop()
    stop = () => {}
  })

  test('New floor detaches in one undo step, keeps the height, and reads against the shared floor', () => {
    expect(roomRelativeFloorHeight(live(), lanaiRoom)).toBeCloseTo(-0.15)
    expect(roomBuiltOn(live(), lanaiRoom)?.current.key).toBeNull()
    expect(setRoomFloor(lanaiRoom, 'new').status).toBe('applied')
    expect(steps()).toBe(1)
    const model = roomBuiltOn(live(), lanaiRoom)!
    expect(model.current.key).not.toBeNull()
    expect(model.current.name).toBe('Lanai floor')
    expect(model.shared?.name).toBe('Shared floor')
    expect(separateFloorOffset(live(), lanaiRoom)).toBeCloseTo(-0.15)
    // Its height reads the same: measured from the shared floor beside it.
    expect(roomRelativeFloorHeight(live(), lanaiRoom)).toBeCloseTo(-0.15)
    // The shared wall stands on the house floor: the lanai is still fully floored.
    expect(roomConstructionState(live(), lanaiRoom)?.floor.state).toBe('present')
    // The house room touches the new floor: it can join it.
    expect(roomBuiltOn(live(), houseRoom)?.choices.map((choice) => choice.name)).toEqual([
      'Shared floor',
      'Lanai floor',
    ])
    useScene.temporal.getState().undo()
    expect(roomBuiltOn(live(), lanaiRoom)?.current.key).toBeNull()
  })

  test('a touching room joins the separate floor and keeps its walking height', () => {
    setRoomFloor(lanaiRoom, 'new')
    const key = roomBuiltOn(live(), lanaiRoom)!.current.key
    const top = roomFloorElevation(live(), houseRoom)
    clearSceneHistory()
    expect(setRoomFloor(houseRoom, key).status).toBe('applied')
    expect(steps()).toBe(1)
    const joined = roomBuiltOn(live(), houseRoom)!
    expect(joined.current).toEqual(roomBuiltOn(live(), lanaiRoom)!.current)
    expect(joined.current).toMatchObject({ key, name: 'Lanai floor' })
    expect(roomFloorElevation(live(), houseRoom)).toBeCloseTo(top)
  })

  test("a separate floor's Height raises it on a foundation, and picking the shared floor rejoins", () => {
    setRoomFloor(lanaiRoom, 'new')
    clearSceneHistory()
    expect(setRoomRelativeFloorHeight(lanaiRoom, 0.1).status).toBe('applied')
    expect(steps()).toBe(1)
    const model = roomBuiltOn(live(), lanaiRoom)!
    const own = live()[model.current.plateId] as SlabNodeType
    const shared = live()[model.shared!.plateId] as SlabNodeType
    expect(own.elevation - shared.elevation).toBeCloseTo(0.1)
    expect(own.foundation?.type).toBe('solid')
    expect(setRoomFloor(lanaiRoom, null).status).toBe('applied')
    expect(roomBuiltOn(live(), lanaiRoom)?.current.key).toBeNull()
    expect(roomRelativeFloorHeight(live(), lanaiRoom)).toBeCloseTo(0.1)
  })

  test('the plan stepper and the 3D handle move a separate floor through its foundation', () => {
    setRoomFloor(lanaiRoom, 'new')
    clearSceneHistory()
    // The detached lanai kept its legacy sunk top; its first edit lands its slab on the ground.
    const next = stepRoomFloorElevation(live(), lanaiRoom, 0.05)
    expect(next).not.toBeNull()
    commitRoomElevation(lanaiRoom, next!)
    expect(steps()).toBe(1)
    expect(roomRelativeFloorHeight(live(), lanaiRoom)).toBeCloseTo(0)
    const bounds = ownFloorElevationBounds(live(), lanaiRoom)!
    expect(bounds.min).toBeCloseTo(roomFloorElevation(live(), lanaiRoom))
    expect(bounds.max).toBeGreaterThan(roomFloorElevation(live(), lanaiRoom))
    commitRoomElevation(lanaiRoom, stepRoomFloorElevation(live(), lanaiRoom, 0.05)!)
    expect(roomRelativeFloorHeight(live(), lanaiRoom)).toBeCloseTo(0.05)
  })

  test('a separate floor steps from the ground onto a 0.05 foundation and back', () => {
    setRoomFloor(lanaiRoom, 'new')
    expect(commitRoomElevation(lanaiRoom, 0)).toBe(true)
    const plateId = roomBuiltOn(live(), lanaiRoom)!.current.plateId
    useScene.getState().updateNode(plateId as SlabNodeType['id'], {
      foundation: { type: 'none', material: 'library:stone' },
    })
    const before = live()
    const own = before[plateId] as SlabNodeType
    // On the ground: the slab sits on grade, so the top is its thickness.
    expect(own.elevation).toBeCloseTo(own.thickness)
    expect(ownFloorElevationBounds(before, lanaiRoom)!.min).toBeCloseTo(own.thickness)
    for (let trip = 0; trip < 2; trip++) {
      const up = stepRoomFloorElevation(live(), lanaiRoom, 0.05)!
      expect(up).toBeCloseTo(own.thickness + 0.05)
      expect(commitRoomElevation(lanaiRoom, up)).toBe(true)
      expect(live()[plateId]).toMatchObject({
        elevation: up,
        thickness: own.thickness,
        foundation: { type: 'solid', material: 'library:stone' },
      })
      expect(stepRoomFloorElevation(live(), lanaiRoom, -0.05)).toBeCloseTo(own.thickness)
      // Below the ground is out of reach: the slab stays on grade.
      expect(commitRoomElevation(lanaiRoom, own.thickness - 0.05)).toBe(true)
      expect(live()).toEqual(before)
    }
  })

  test('a separate floor no shared-floor room touches still goes back to the shared floor', () => {
    setRoomFloor(lanaiRoom, 'new')
    const key = roomBuiltOn(live(), lanaiRoom)!.current.key
    // The house room joins the lanai's floor: nothing on the shared floor touches the lanai now.
    expect(setRoomFloor(houseRoom, key).status).toBe('applied')
    const model = roomBuiltOn(live(), lanaiRoom)!
    expect(model.shared).toBeNull()
    expect(model.choices.at(-1)).toEqual({ key: null, plateId: null, name: 'Shared floor' })
    clearSceneHistory()
    expect(setRoomFloor(lanaiRoom, null).status).toBe('applied')
    expect(steps()).toBe(1)
    expect(roomFloorKey(live(), lanaiRoom)).toBeNull()
  })

  test('a refused plan-stepper or 3D-handle height says why under the room pill', () => {
    showRoomNotice(null)
    const result = commitRoomFloorElevation(houseRoom, 10, length)
    expect(result.status).toBe('conflict')
    const notice = useRoomTransform.getState().notice
    expect(notice?.zoneId).toBe(houseRoom)
    expect(notice?.message).toMatch(/^Too high: the floor can rise at most \d+\.\d\d m/)
    expect(steps()).toBe(0)
    showRoomNotice(null)
  })

  test('a refused move comes back as a message, never a throw', () => {
    useScene.getState().updateNodes([{ id: lanaiRoom as AnyNode['id'], data: { hasFloor: false } }])
    const result = setRoomFloor(lanaiRoom, 'new')
    expect(result.status).toBe('conflict')
    expect(result.status === 'conflict' && result.message).toContain('Level the floors first')
  })
})
