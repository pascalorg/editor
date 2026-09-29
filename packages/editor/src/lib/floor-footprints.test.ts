import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  applySceneOperationPatch,
  BuildingNode,
  clearSceneHistory,
  createZone,
  floorFootprintName,
  generateId,
  ItemNode,
  initSpaceDetectionSync,
  LevelNode,
  type SceneCommit,
  type SlabNode,
  SlabNode as SlabSchema,
  subscribeSceneCommits,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { moveTogetherLabel } from '../components/ui/panels/floor-foundation-panel'
import {
  applyFloorFoundation,
  applyRoomFloorConstruction,
  beginFootprintHeightPreview,
  DEFAULT_FOUNDATION_HEIGHT,
  footprintHeightPatch,
  footprintPreset,
  footprintsToMoveTogether,
  foundationHeight,
  isFootprintConstructionHit,
  levelFootprints,
  presetPatch,
  roomFloorOwner,
  roomFootprint,
  roomOwnedPlateDrillTarget,
} from './floor-footprints'
import { resolveRoomAssemblyHeights } from './room-assembly-overlay'
import { roomConstructionState } from './room-construction'
import {
  addRoomConstruction,
  floorHeightRefusalText,
  roomRelativeFloorHeight,
  setRoomRelativeFloorHeight,
} from './room-construction-commands'
import type { RoomSelectionRecord } from './room-selection'
import { applyRoomPlan } from './room-structure-commands'

const LEVEL = 'level_footprints'
let stop = () => {}
const nodes = () => useScene.getState().nodes as Record<string, AnyNode>
const history = () => useScene.temporal.getState().pastStates.length

function room(polygon: [number, number][], name: string) {
  const plan = createZone(nodes(), {
    levelId: LEVEL,
    polygon,
    enclose: true,
    mintId: generateId,
    name,
  })
  applyRoomPlan(plan)
  return plan.zoneId
}

let house: SlabNode
let shed: SlabNode
let livingId: string
let shedId: string

beforeEach(() => {
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
  const building = BuildingNode.parse({ id: 'building_footprints', children: [LEVEL] })
  const level = LevelNode.parse({ id: LEVEL, parentId: building.id })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  livingId = room(
    [
      [0, 0],
      [6, 0],
      [6, 5],
      [0, 5],
    ],
    'Living room',
  )
  room(
    [
      [6, 0],
      [9, 0],
      [9, 5],
      [6, 5],
    ],
    'Bedroom',
  )
  shedId = room(
    [
      [12, 1],
      [15, 1],
      [15, 4],
      [12, 4],
    ],
    'Shed',
  )
  ;[house, shed] = levelFootprints(nodes(), LEVEL) as [SlabNode, SlabNode]
  clearSceneHistory()
})
afterEach(() => {
  stop()
  stop = () => {}
})

/** A drawn (authored) slab under the shed room, recorded as that room's floor source. */
function withDrawnShedFloor(unlist = false) {
  const drawn = SlabSchema.parse({
    id: 'slab_drawn_shed',
    name: 'Shed deck',
    parentId: LEVEL,
    polygon: [
      [12, 1],
      [15, 1],
      [15, 4],
      [12, 4],
    ],
    elevation: 0.12,
    thickness: 0.12,
  })
  const current = nodes()
  const zone = current[shedId] as ZoneNode
  const next: Record<string, AnyNode> = {
    ...current,
    [drawn.id]: drawn,
    [shedId]: { ...zone, floor: { ...zone.floor, sourceSlabId: drawn.id } } as AnyNode,
  }
  if (unlist)
    for (const plate of levelFootprints(next, LEVEL))
      next[plate.id] = { ...plate, zoneIds: plate.zoneIds?.filter((id) => id !== shedId) }
  return { nodes: next, drawn }
}

describe('a room floor owner (legacy floors)', () => {
  test('the drawn slab the floor came from comes first, then the footprint listing the room', () => {
    const { nodes: graph, drawn } = withDrawnShedFloor()
    expect(roomFloorOwner(graph, shedId)?.id).toBe(drawn.id)
    expect(roomFloorOwner(graph, livingId)?.id).toBe(house.id)
    // A source slab that is gone is no owner: the listed footprint is.
    const { [drawn.id]: _gone, ...without } = graph
    expect(roomFloorOwner(without, shedId)?.id).toBe(shed.id)
  })

  test('a hand-drawn slab over the one the floor came from is the owner, and the room height is refused', () => {
    const { nodes: graph, drawn } = withDrawnShedFloor()
    const top = SlabSchema.parse({
      id: 'slab_drawn_top',
      name: 'Slab 4',
      parentId: LEVEL,
      polygon: drawn.polygon,
      elevation: 0.3,
      thickness: 0.3,
    })
    const layered = { ...graph, [top.id]: top }
    expect(roomFloorOwner(layered, shedId)?.id).toBe(top.id)
    useScene.setState({ nodes: layered as never })
    const refused = setRoomRelativeFloorHeight(shedId, 0.5)
    expect(refused.status).toBe('conflict')
    expect(refused.status === 'conflict' && refused.message).toContain('Slab 4')
    expect(nodes()[shedId]).toBe(layered[shedId]!)
    // Thickness reaches the slab the room visibly stands on.
    expect(applyRoomFloorConstruction(shedId, { thickness: 0.2 })).toBeNull()
    expect((nodes()[top.id] as SlabNode).thickness).toBeCloseTo(0.2)
    expect((nodes()[drawn.id] as SlabNode).thickness).toBeCloseTo(drawn.thickness)
  })

  test('a drawn-slab floor is not switched off from the room; one switched off before still shows its slab', () => {
    // Plates leave a drawn-slab room out: the slab alone floors it.
    const { nodes: graph, drawn } = withDrawnShedFloor(true)
    // Switching the room's floor off would hide nothing: only the slab can go.
    expect(roomConstructionState(graph, shedId)?.floor).toMatchObject({
      state: 'present',
      intent: true,
      actions: { add: false, remove: false },
    })
    const off = { ...graph, [shedId]: { ...(graph[shedId] as ZoneNode), hasFloor: false as const } }
    // Stored off (legacy), the slab still floors the room: the panel says so,
    // the floor height reads the slab, and the switch can go back on.
    expect(roomConstructionState(off, shedId)?.floor).toMatchObject({
      state: 'present',
      intent: false,
      actions: { add: true, remove: false },
    })
    expect(roomFloorOwner(off, shedId)?.id).toBe(drawn.id)
    const room = { key: { levelId: LEVEL }, zoneId: shedId, boundaryWallIds: [] }
    expect(
      resolveRoomAssemblyHeights(room as unknown as RoomSelectionRecord, off).floorY,
    ).toBeCloseTo(drawn.elevation)
    useScene.setState({ nodes: off as never })
    expect(addRoomConstruction(shedId, 'floor').status).toBe('applied')
    expect((nodes()[shedId] as ZoneNode).hasFloor).toBeUndefined()
  })

  test('a drawn-floor room is not handed to a footprint that only brushes it', () => {
    const { nodes: graph } = withDrawnShedFloor(true)
    expect(roomFootprint(graph, shedId)).toBeNull()
    // Without a drawn floor, the overlap still finds the footprint.
    expect(roomFootprint(nodes(), shedId)?.id).toBe(shed.id)
  })

  test('the room edits its floor through setRoomFloorConstruction: thickness and height reach the drawn slab', () => {
    expect(applyRoomFloorConstruction(livingId, { thickness: 0.2 })).toBeNull()
    expect((nodes()[house.id] as SlabNode).thickness).toBeCloseTo(0.2)
    const { nodes: graph, drawn } = withDrawnShedFloor()
    useScene.setState({ nodes: graph as never })
    expect(applyRoomFloorConstruction(shedId, { thickness: 0.2 }, drawn.id)).toBeNull()
    expect((nodes()[drawn.id] as SlabNode).thickness).toBeCloseTo(0.2)
    expect(applyRoomFloorConstruction(shedId, { floorHeight: 0.5 }, drawn.id)).toBeNull()
    expect((nodes()[drawn.id] as SlabNode).elevation).toBeCloseTo(0.5)
  })

  test('a plate lifted by a floor reference reads raised, and On the ground lands it', () => {
    // A migrated plate: its floor reference is 0.20 over a 0.05 support, with
    // no floorHeight of its own.
    const migrated = {
      ...(nodes()[shed.id] as SlabNode),
      referenceFloorElevation: 0.2,
      elevation: 0.2,
      floorHeight: undefined,
    }
    useScene.setState({ nodes: { ...nodes(), [shed.id]: migrated } as never })
    let plate = nodes()[shed.id] as SlabNode
    expect(plate.referenceFloorElevation).toBeCloseTo(0.2)
    expect(foundationHeight(nodes(), plate)).toBeGreaterThan(0.1)
    expect(footprintPreset(nodes(), plate)).toBe('raised')
    expect(applyFloorFoundation(shed.id, presetPatch(nodes(), plate, 'ground'))).toBeNull()
    plate = nodes()[shed.id] as SlabNode
    expect(foundationHeight(nodes(), plate)).toBeCloseTo(0)
    expect(footprintPreset(nodes(), plate)).toBe('ground')
  })
})

describe('floor footprints', () => {
  test('one footprint per building, named for what stands on it', () => {
    expect(levelFootprints(nodes(), LEVEL)).toHaveLength(2)
    expect(roomFootprint(nodes(), livingId)?.id).toBe(house.id)
    expect(roomFootprint(nodes(), shedId)?.id).toBe(shed.id)
    expect(floorFootprintName(nodes(), house)).toBe('Shared floor')
    expect(floorFootprintName(nodes(), shed)).toBe('Shed floor')
    // A name the user gives the plate wins.
    expect(floorFootprintName(nodes(), { ...house, name: 'Cabin' })).toBe('Cabin')
  })

  test('new footprints sit on the ground', () => {
    expect(footprintPreset(nodes(), house)).toBe('ground')
    expect(foundationHeight(nodes(), house)).toBeCloseTo(0)
  })

  test('raising the house is one undo step and leaves the shed alone', () => {
    const shedBefore = nodes()[shed.id]
    expect(applyFloorFoundation(house.id, presetPatch(nodes(), house, 'raised'))).toBeNull()
    expect(history()).toBe(1)
    let plate = nodes()[house.id] as SlabNode
    expect(footprintPreset(nodes(), plate)).toBe('raised')
    expect(foundationHeight(nodes(), plate)).toBeCloseTo(DEFAULT_FOUNDATION_HEIGHT)
    expect(plate.foundation).toMatchObject({ type: 'solid', material: 'library:preset-midgrey' })
    expect(nodes()[shed.id]).toEqual(shedBefore)

    expect(applyFloorFoundation(house.id, footprintHeightPatch(nodes(), plate, 0.65))).toBeNull()
    expect(
      applyFloorFoundation(house.id, {
        foundation: { type: 'solid', material: 'library:flooring-wallstone1' },
        slots: { edge: 'library:preset-white' },
      }),
    ).toBeNull()
    plate = nodes()[house.id] as SlabNode
    expect(foundationHeight(nodes(), plate)).toBeCloseTo(0.65)
    expect(plate.foundation?.material).toBe('library:flooring-wallstone1')
    expect(plate.slots?.edge).toBe('library:preset-white')
    expect(history()).toBe(3)

    useScene.temporal.getState().undo()
    useScene.temporal.getState().undo()
    expect(foundationHeight(nodes(), nodes()[house.id] as SlabNode)).toBeCloseTo(
      DEFAULT_FOUNDATION_HEIGHT,
    )
  })

  test('back on the ground drops the foundation and the height', () => {
    applyFloorFoundation(house.id, presetPatch(nodes(), house, 'raised'))
    const raised = nodes()[house.id] as SlabNode
    // Raising again keeps the height already set.
    expect(presetPatch(nodes(), raised, 'raised').foundationHeight).toBeCloseTo(
      DEFAULT_FOUNDATION_HEIGHT,
    )
    applyFloorFoundation(house.id, presetPatch(nodes(), raised, 'ground'))
    const grounded = nodes()[house.id] as SlabNode
    expect(footprintPreset(nodes(), grounded)).toBe('ground')
    expect(grounded.floorHeight).toBeUndefined()
    expect(grounded.foundation?.type).toBe('none')
  })

  test("a click on the band or the foundation is the footprint's, not the room's", () => {
    const hit = (paintRole: string) => ({ userData: { paintRole } })
    expect(isFootprintConstructionHit(house, hit('edge'))).toBe(true)
    expect(isFootprintConstructionHit(house, hit('foundation'))).toBe(true)
    expect(isFootprintConstructionHit(house, hit(`room:${livingId}`))).toBe(false)
    expect(isFootprintConstructionHit(house, hit(`edge:${livingId}`))).toBe(false)
    expect(isFootprintConstructionHit({ ...house, plateRole: 'platform' }, hit('edge'))).toBe(false)
  })

  test('a room height is measured from its footprint floor: 0.15 on a raised house lifts it', () => {
    applyFloorFoundation(house.id, { floorHeight: 0.7, foundation: { type: 'solid' } })
    const floor = (nodes()[house.id] as SlabNode).elevation
    expect(roomRelativeFloorHeight(nodes(), livingId)).toBeCloseTo(0)
    clearSceneHistory()
    expect(setRoomRelativeFloorHeight(livingId, 0.15)).toEqual({ status: 'applied' })
    expect(history()).toBe(1)
    expect(roomRelativeFloorHeight(nodes(), livingId)).toBeCloseTo(0.15)
    const zone = nodes()[livingId]
    expect(zone?.type === 'zone' ? zone.floor?.elevation : null).toBeCloseTo(floor + 0.15)
  })

  test('a refused room height says why and changes nothing', () => {
    const before = nodes()
    const result = setRoomRelativeFloorHeight(livingId, 50)
    expect(result).toMatchObject({ status: 'conflict', code: 'floor-headroom' })
    expect(nodes()).toBe(before)
    // Stated as a height above the floor it stands on, not a floor elevation.
    const max = (result as { max: number }).max
    const base = (nodes()[house.id] as SlabNode).elevation
    expect(max).toBeCloseTo(2 - base)
    expect(floorHeightRefusalText(result as never, (m) => `${m.toFixed(2)} m`)).toBe(
      `Too high: the floor can rise at most ${(2 - base).toFixed(2)} m and keep headroom.`,
    )
  })

  test('a supported floor accepts height but refuses a ground foundation', () => {
    const ground = LevelNode.parse({
      id: 'level_footprints_ground',
      parentId: 'building_footprints',
    })
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [ground.id]: ground,
        building_footprints: {
          ...state.nodes['building_footprints' as never]!,
          children: [ground.id, LEVEL],
        } as AnyNode,
        [LEVEL]: { ...state.nodes[LEVEL as never]!, level: 1 } as AnyNode,
      },
    }))
    applyRoomPlan(
      createZone(nodes(), {
        levelId: ground.id,
        polygon: [
          [0, 0],
          [9, 0],
          [9, 5],
          [0, 5],
        ],
        enclose: true,
        mintId: generateId,
        name: 'Ground room',
      }),
    )
    expect(applyFloorFoundation(house.id, footprintHeightPatch(nodes(), house, 0.3))).toBeNull()
    const before = nodes()
    const message = applyFloorFoundation(house.id, { foundation: { type: 'solid' } })
    expect(message).toBe('Only a plate at ground contact can have a solid foundation.')
    expect(nodes()).toBe(before)
  })

  test('raising the house under an upper floor that also covers the shed is refused, in words', () => {
    const upper = LevelNode.parse({
      id: 'level_footprints_upper',
      parentId: 'building_footprints',
      level: 1,
    })
    const loft = ZoneNode.parse({
      id: 'zone_footprints_loft',
      name: 'Loft',
      spaceRole: 'room',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [15, 0],
        [15, 5],
        [0, 5],
      ],
    })
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [upper.id]: { ...upper, children: [loft.id] },
        [loft.id]: loft,
        building_footprints: {
          ...state.nodes['building_footprints' as never]!,
          children: [LEVEL, upper.id],
        } as AnyNode,
      },
    }))
    const before = nodes()
    const patch = presetPatch(nodes(), house, 'raised')
    expect(applyFloorFoundation(house.id, patch)).toBe(
      'The upper floor also sits over Shed floor; raise both or neither.',
    )
    expect(nodes()).toBe(before)

    // What the notice offers instead: both footprints, together, in one step.
    const together = footprintsToMoveTogether(nodes(), house.id, patch)
    expect(together).toEqual([house.id, shed.id])
    expect(moveTogetherLabel(together!.length, false)).toBe('Raise both')
    const steps = history()
    expect(applyFloorFoundation(together!, patch)).toBeNull()
    expect(history()).toBe(steps + 1)
    for (const id of [house.id, shed.id])
      expect(foundationHeight(nodes(), nodes()[id] as SlabNode)).toBeCloseTo(
        DEFAULT_FOUNDATION_HEIGHT,
      )
  })

  test('only the shared-storey refusal offers to move footprints together', () => {
    // No upper floor: the house alone is accepted, nothing to offer.
    expect(
      footprintsToMoveTogether(nodes(), house.id, footprintHeightPatch(nodes(), house, 0.4)),
    ).toBeNull()
  })

  test('one height: at the ground there is no foundation, above it there is', () => {
    expect(footprintHeightPatch(nodes(), house, 0)).toEqual({ foundationHeight: 0 })
    applyFloorFoundation(house.id, footprintHeightPatch(nodes(), house, 0.4))
    let plate = nodes()[house.id] as SlabNode
    expect(footprintPreset(nodes(), plate)).toBe('raised')
    expect(plate.foundation?.type).toBe('solid')
    applyFloorFoundation(house.id, footprintHeightPatch(nodes(), plate, 0))
    plate = nodes()[house.id] as SlabNode
    expect(footprintPreset(nodes(), plate)).toBe('ground')
    expect(plate.foundation?.type).toBe('none')
  })

  test('a live height preview lands once, from exactly where everyone else is', () => {
    const origin = nodes()
    const commits: SceneCommit[] = []
    const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    const drag = beginFootprintHeightPreview(house.id)
    // Up (the building follows and gets its grey foundation), then back past the ground.
    expect(drag.preview(0.6)).toBeNull()
    expect((nodes()[house.id] as SlabNode).foundation?.type).toBe('solid')
    expect(foundationHeight(nodes(), nodes()[house.id] as SlabNode)).toBeCloseTo(0.6)
    expect(drag.preview(0)).toBeNull()
    expect(drag.preview(0.4)).toBeNull()
    expect(history()).toBe(0)
    expect(commits).toHaveLength(0)
    expect(drag.commit(0.4)).toBeNull()
    unsubscribe()
    expect(history()).toBe(1)
    expect(commits).toHaveLength(1)
    // The one shared change starts from the untouched scene, not from a preview.
    expect(commits[0]!.before.nodes[house.id]).toEqual(origin[house.id])
    expect(foundationHeight(nodes(), nodes()[house.id] as SlabNode)).toBeCloseTo(0.4)
    useScene.temporal.getState().undo()
    expect(nodes()[house.id]).toEqual(origin[house.id])
  })

  test('a preview dragged back to where it started changes nothing', () => {
    const origin = nodes()
    const drag = beginFootprintHeightPreview(house.id)
    drag.preview(0.6)
    expect(drag.commit(0)).toBeNull()
    expect(history()).toBe(0)
    expect(nodes()[house.id]).toBe(origin[house.id])
    const cancelled = beginFootprintHeightPreview(house.id)
    cancelled.preview(0.3)
    cancelled.cancel()
    expect(nodes()[house.id]).toBe(origin[house.id])
    expect(history()).toBe(0)
  })

  test("a raised room's plate drills to the footprint it stands on; a mezzanine deck does not", () => {
    expect(setRoomRelativeFloorHeight(livingId, 0.3)).toMatchObject({ status: 'applied' })
    const platform = Object.values(nodes()).find(
      (node): node is SlabNode =>
        node.type === 'slab' && node.plateRole === 'platform' && !!node.zoneIds?.includes(livingId),
    )
    expect(platform).toBeDefined()
    expect(roomOwnedPlateDrillTarget(nodes(), platform!)?.id).toBe(house.id)
    expect(roomOwnedPlateDrillTarget(nodes(), { ...platform!, support: 'open' })).toBeNull()
  })

  // A collaborator's change applied mid-preview is not the preview's to undo.
  const remoteUpdate = (id: string, data: Record<string, unknown>) =>
    applySceneOperationPatch({
      nodeUpdates: [{ id: id as AnyNode['id'], data, removeFields: [] }],
      materialChanges: [],
      nodeCreates: [],
      nodeDeletes: [],
    } as unknown as Parameters<typeof applySceneOperationPatch>[0])

  test("a collaborator's edit mid-preview survives the commit", () => {
    const drag = beginFootprintHeightPreview(house.id)
    expect(drag.preview(0.5)).toBeNull()
    // Unrelated: the shed's room. Related: the house plate itself, one field
    // the preview never writes.
    expect(remoteUpdate(shedId, { name: 'Garage' })).toBe(true)
    expect(remoteUpdate(house.id, { name: 'Cabin' })).toBe(true)
    const commits: SceneCommit[] = []
    const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    expect(drag.commit(0.5)).toBeNull()
    unsubscribe()
    expect((nodes()[shedId] as ZoneNode).name).toBe('Garage')
    expect(nodes()[house.id]).toMatchObject({ name: 'Cabin' })
    expect(foundationHeight(nodes(), nodes()[house.id] as SlabNode)).toBeCloseTo(0.5)
    // The shared change starts from the scene with their edits in it.
    expect(commits).toHaveLength(1)
    expect(commits[0]!.before.nodes[house.id]).toMatchObject({
      name: 'Cabin',
      elevation: house.elevation,
    })
  })

  test("a collaborator's new node mid-preview survives the cancel", () => {
    const drag = beginFootprintHeightPreview(house.id)
    drag.preview(0.4)
    const item = ItemNode.parse({
      id: 'item_remote',
      parentId: LEVEL,
      position: [13, 0, 2],
      asset: {
        id: 'x',
        name: 'x',
        src: '/items/x/model.glb',
        thumbnail: '/items/x/thumbnail.webp',
        dimensions: [1, 1, 1],
        category: 'furniture',
      },
    })
    const level = nodes()[LEVEL] as { children: string[] }
    expect(
      applySceneOperationPatch({
        nodeUpdates: [],
        materialChanges: [],
        nodeCreates: [{ node: item, position: level.children.length }],
        nodeDeletes: [],
      } as unknown as Parameters<typeof applySceneOperationPatch>[0]),
    ).toBe(true)
    drag.cancel()
    expect(nodes().item_remote).toBeDefined()
    expect((nodes()[LEVEL] as { children: string[] }).children).toContain('item_remote')
    expect(nodes()[house.id]).toMatchObject({
      elevation: house.elevation,
      foundation: house.foundation,
    })
  })
})
