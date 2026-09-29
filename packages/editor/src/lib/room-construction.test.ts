import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  area,
  BuildingNode,
  CeilingNode,
  clearSceneHistory,
  createZone,
  DoorNode,
  divideZone,
  GROUND_SUPPORT_ID,
  generateId,
  ItemNode,
  initSpaceDetectionSync,
  LevelNode,
  resolveCeilingHeight,
  type SlabNode,
  type StructureNodes,
  structureChangeBatch,
  useScene,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { deleteConfirmationContent } from '../components/editor/delete-confirmation-dialog'
import { constructionActions, wallsSwitch } from '../components/ui/panels/room-construction-rows'
import useDeleteConfirmation from '../store/use-delete-confirmation'
import useEditor from '../store/use-editor'
import { roomClearPolygon, roomConstructionState, roomFloorContents } from './room-construction'
import {
  addRoomConstruction,
  adoptExistingCeiling,
  lockRoomOutsideFaces,
  removeRoomConstruction,
  replaceRoomCeiling,
  roomConflictMessage,
  roomOutsideFacesLocked,
  roomWallAdditionPreview,
  TRIVIAL_AREA_LOSS,
  unlockRoomOutsideFaces,
} from './room-construction-commands'
import { applyRoomPlan } from './room-structure-commands'

const LEVEL = 'level_construction'
let zoneId: string
let stop = () => {}

const nodes = () => useScene.getState().nodes
const state = (id = zoneId) => roomConstructionState(nodes(), id)!
const steps = () => useScene.temporal.getState().pastStates.length
const ofType = <T extends string>(type: T) => Object.values(nodes()).filter((n) => n.type === type)
const zones = () => ofType('zone') as ZoneNode[]
const ceilingOf = (id: string) =>
  ofType('ceiling').find((n) => n.type === 'ceiling' && n.zoneId === id) as CeilingNode | undefined

const dialog = () => useDeleteConfirmation.getState().request
const content = () => deleteConfirmationContent(dialog()!, nodes())
const create = (node: StructureNodes[string], parentId: string) =>
  useScene.getState().applyNodeChanges({ create: [{ node, parentId: parentId as AnyNodeId }] })

function item(
  id: string,
  name: string,
  parentId: string,
  position: [number, number, number],
  options: { light?: boolean; supportSlabId?: string } = {},
) {
  return ItemNode.parse({
    id,
    name,
    parentId,
    position,
    supportSlabId: options.supportSlabId,
    asset: {
      id,
      // Category and name read like a light either way: only the effect counts.
      category: 'lighting',
      name,
      thumbnail: '',
      src: `https://example.com/${id}.glb`,
      ...(options.light && {
        interactive: { effects: [{ kind: 'light', intensityRange: [0, 1] }] },
      }),
    },
  })
}

/** Add walls, through the loss confirmation when it asks. */
function addWalls(id = zoneId) {
  const result = addRoomConstruction(id, 'walls')
  if (result.status === 'confirming') useDeleteConfirmation.getState().confirm()
  return result
}

const plateOf = (id: string) =>
  ofType('slab').find(
    (n) => n.type === 'slab' && n.boundary === 'auto' && n.zoneIds?.includes(id),
  ) as SlabNode

function manualCeiling(polygon: [number, number][], name = 'Loft ceiling') {
  const ceiling = CeilingNode.parse({ id: 'ceiling_manual', name, parentId: LEVEL, polygon })
  create(ceiling, LEVEL)
  return ceiling
}

const WHOLE_ROOM: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]

function divide() {
  const plan = divideZone(nodes(), {
    zoneId,
    cut: [
      [4, 0],
      [4, 4],
    ],
    mintId: generateId,
  })
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  const other = zones().find((zone) => zone.id !== zoneId)!
  clearSceneHistory()
  return other.id
}

beforeEach(() => {
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
  const building = BuildingNode.parse({ id: 'building_construction', children: [LEVEL] })
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
  const plan = createZone(nodes(), {
    levelId: LEVEL,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ],
    enclose: true,
    mintId: generateId,
  })
  applyRoomPlan(plan)
  zoneId = plan.zoneId
  clearSceneHistory()
})
afterEach(() => {
  stop()
  useDeleteConfirmation.getState().cancel()
})

describe('room construction state', () => {
  test('an enclosed room reads Present on every row, with no shared walls', () => {
    const room = state()
    expect(room.floor).toMatchObject({ state: 'present', intent: true })
    expect(room.floor.coverage).toBeGreaterThan(0.98)
    expect(room.walls.state).toBe('present')
    expect(room.walls.removable.length).toBeGreaterThanOrEqual(4)
    expect(room.walls.separators).toEqual([])
    expect(room.walls.sharedWallIds).toEqual([])
    expect(room.ceiling).toMatchObject({ state: 'present', intent: true })
    expect(room.ceiling.ceilingId).toBe(ceilingOf(zoneId)!.id)
    expect(constructionActions(room, 'walls')).toEqual({ add: false, remove: true })
    expect(constructionActions(room, 'floor')).toEqual({ add: false, remove: true })
  })

  test('memoized per nodes identity', () => {
    expect(roomConstructionState(nodes(), zoneId)).toBe(roomConstructionState(nodes(), zoneId))
    expect(roomConstructionState(nodes(), 'zone_missing')).toBeNull()
  })

  test('a plate covering part of the room reads Partial; stair holes still count as floor', () => {
    const plate = ofType('slab').find((n) => n.type === 'slab' && n.boundary === 'auto') as SlabNode
    expect(plate.zoneIds).toContain(zoneId)
    const halfHole: [number, number][] = [
      [0.5, 0.5],
      [4, 0.5],
      [4, 3.5],
      [0.5, 3.5],
    ]
    const withHole = (source: 'manual' | 'stair'): StructureNodes => ({
      ...nodes(),
      [plate.id]: { ...plate, holes: [halfHole], holeMetadata: [{ source }] },
    })
    expect(roomConstructionState(withHole('manual'), zoneId)!.floor.state).toBe('partial')
    expect(roomConstructionState(withHole('stair'), zoneId)!.floor.state).toBe('present')
    const unlinked = { ...nodes(), [plate.id]: { ...plate, zoneIds: [] } }
    expect(roomConstructionState(unlinked, zoneId)!.floor.state).toBe('absent')
  })

  test('a manual ceiling over a room without its own reads Partial', () => {
    const linked = ceilingOf(zoneId)!
    const scene = { ...nodes() } as Record<string, StructureNodes[string]>
    delete scene[linked.id]
    const manual = CeilingNode.parse({
      id: 'ceiling_manual',
      parentId: LEVEL,
      polygon: [
        [0, 0],
        [3, 0],
        [3, 4],
        [0, 4],
      ],
    })
    expect(roomConstructionState(scene, zoneId)!.ceiling).toMatchObject({
      state: 'absent',
      actions: { add: false, remove: false },
    })
    const covered = { ...scene, [manual.id]: manual }
    expect(roomConstructionState(covered, zoneId)!.ceiling).toMatchObject({
      state: 'partial',
      manualIds: [manual.id],
      // A small hand-drawn ceiling does not stop the room from getting its own.
      actions: { add: false, remove: true, useExisting: false, replace: true },
    })
    const optedOut = {
      ...covered,
      [zoneId]: { ...(scene[zoneId] as ZoneNode), hasCeiling: false as const },
    }
    expect(roomConstructionState(optedOut, zoneId)!.ceiling.actions).toEqual({
      add: true,
      remove: true,
      useExisting: false,
      replace: true,
    })
    const wide = { ...optedOut, [manual.id]: { ...manual, polygon: WHOLE_ROOM } }
    expect(roomConstructionState(wide, zoneId)!.ceiling.actions).toEqual({
      add: false,
      remove: true,
      useExisting: true,
      replace: true,
    })
  })

  test('a separator makes Walls Partial; building it into a wall makes it shared', () => {
    const otherId = divide()
    expect(state().walls.state).toBe('partial')
    expect(state().walls.separators).toHaveLength(1)
    expect(constructionActions(state(), 'walls')).toEqual({ add: true, remove: true })
    expect(addWalls()).toEqual({ status: 'confirming' })
    expect(steps()).toBe(1)
    expect(
      zones()
        .map((zone): string => zone.id)
        .sort(),
    ).toEqual([zoneId, otherId].sort())
    for (const id of [zoneId, otherId]) {
      expect(state(id).walls.state).toBe('present')
      expect(state(id).walls.sharedWallIds).toHaveLength(1)
    }
    expect(ofType('separator')).toHaveLength(0)
  })

  test('Remove walls keeps shared walls and turns the rest into separators', () => {
    const otherId = divide()
    addWalls()
    clearSceneHistory()
    const shared = state().walls.sharedWallIds
    expect(removeRoomConstruction(zoneId, 'walls')).toEqual({ status: 'applied' })
    expect(steps()).toBe(1)
    expect(nodes()[zoneId as AnyNodeId]).toBeDefined()
    expect(state().walls.state).toBe('partial')
    expect(state().walls.sharedWallIds).toEqual(shared)
    expect(state().walls.removable).toEqual([])
    expect(state(otherId).walls.state).toBe('present')
    expect(constructionActions(state(), 'walls')).toEqual({ add: true, remove: false })
  })

  test('the Walls switch: Partial reads half on, closes in one step, then removes in one', () => {
    const otherId = divide()
    addWalls()
    removeRoomConstruction(zoneId, 'walls')
    clearSceneHistory()
    expect(state().walls.state).toBe('partial')
    expect(wallsSwitch(state())).toEqual({
      checked: false,
      mixed: true,
      command: 'add',
      disabled: false,
    })
    addWalls()
    expect(steps()).toBe(1)
    expect(state().walls.state).toBe('present')
    expect(wallsSwitch(state())).toEqual({
      checked: true,
      mixed: false,
      command: 'remove',
      disabled: false,
    })
    expect(removeRoomConstruction(zoneId, 'walls')).toEqual({ status: 'applied' })
    expect(steps()).toBe(2)
    expect(state().walls.state).toBe('partial')
    expect(state(otherId).walls.state).toBe('present')
    useScene.temporal.getState().undo()
    expect(state().walls.state).toBe('present')
    useScene.temporal.getState().undo()
    expect(state().walls.state).toBe('partial')
  })

  test('a neighbour without a floor leaves this room Present, its own row Absent', () => {
    const otherId = divide()
    removeRoomConstruction(otherId, 'floor')
    expect(state(otherId).floor.state).toBe('absent')
    expect(state().floor.state).toBe('present')
  })

  test('the walls confirmation notes that shared walls remain', () => {
    divide()
    addWalls()
    const wall = ofType('wall').find(
      (n) =>
        n.type === 'wall' &&
        n.start[1] === 4 &&
        n.end[1] === 4 &&
        Math.max(n.start[0], n.end[0]) <= 4,
    ) as WallNode
    const art = ItemNode.parse({
      id: 'item_art',
      name: 'Painting',
      parentId: wall.id,
      wallId: wall.id,
      position: [1, 1.5, 0],
      asset: {
        id: 'art',
        category: 'decor',
        name: 'Painting',
        thumbnail: '',
        src: 'https://example.com/art.glb',
      },
    })
    useScene.getState().applyNodeChanges({ create: [{ node: art, parentId: wall.id }] })
    expect(removeRoomConstruction(zoneId, 'walls')).toEqual({ status: 'confirming' })
    const content = deleteConfirmationContent(useDeleteConfirmation.getState().request!, nodes())
    expect(content.description).toContain('1 item (Painting)')
    expect(content.description).toContain('Shared walls remain.')
  })

  test('a lone room with its walls removed reads Absent; Add brings them back', () => {
    expect(removeRoomConstruction(zoneId, 'walls')).toEqual({ status: 'applied' })
    expect(steps()).toBe(1)
    expect(ofType('wall')).toHaveLength(0)
    expect(state().walls.state).toBe('absent')
    expect(state().floor.state).toBe('present')
    expect(addWalls()).toEqual({ status: 'confirming' })
    expect(steps()).toBe(2)
    expect(state().walls.state).toBe('present')
  })

  test('Remove walls previews hosted doors and windows, then removes them in one step', () => {
    const wall = ofType('wall')[0] as WallNode
    const door = DoorNode.parse({
      id: 'door_front',
      name: 'Front door',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 0, 0],
    })
    useScene.getState().applyNodeChanges({ create: [{ node: door, parentId: wall.id }] })
    clearSceneHistory()
    expect(removeRoomConstruction(zoneId, 'walls')).toEqual({ status: 'confirming' })
    expect(steps()).toBe(0)
    const request = useDeleteConfirmation.getState().request!
    expect(request.construction).toMatchObject({ part: 'walls', hostedIds: [door.id] })
    const content = deleteConfirmationContent(request, nodes())
    expect(content.title).toBe('Remove walls from Room?')
    expect(content.description).toContain('1 door (Front door)')
    expect(content.description).not.toContain(door.id)
    expect(content.description).not.toContain('Shared walls remain')
    expect(content.keepLabel).toBeNull()
    useDeleteConfirmation.getState().confirm()
    expect(nodes()[door.id]).toBeUndefined()
    expect(state().walls.state).toBe('absent')
    expect(steps()).toBe(1)
  })

  test('Floor Remove and Add each write one intent step', () => {
    expect(removeRoomConstruction(zoneId, 'floor')).toEqual({ status: 'applied' })
    expect(nodes()[zoneId as AnyNodeId]).toMatchObject({ hasFloor: false })
    expect(state().floor).toMatchObject({ state: 'absent', intent: false })
    expect(constructionActions(state(), 'floor')).toEqual({ add: true, remove: false })
    expect(steps()).toBe(1)
    expect(addRoomConstruction(zoneId, 'floor')).toEqual({ status: 'applied' })
    expect(state().floor.state).toBe('present')
    expect(steps()).toBe(2)
  })

  test('Ceiling Remove without hosted items applies at once; Add restores it', () => {
    expect(removeRoomConstruction(zoneId, 'ceiling')).toEqual({ status: 'applied' })
    expect(useDeleteConfirmation.getState().request).toBeNull()
    expect(ceilingOf(zoneId)).toBeUndefined()
    expect(state().ceiling).toMatchObject({ state: 'absent', intent: false })
    expect(steps()).toBe(1)
    expect(addRoomConstruction(zoneId, 'ceiling')).toEqual({ status: 'applied' })
    expect(state().ceiling.state).toBe('present')
    expect(steps()).toBe(2)
  })

  test('Ceiling Remove previews hosted lights: keep them in place, or remove all in one step', () => {
    const ceiling = ceilingOf(zoneId)!
    const light = item('item_pendant', 'Pendant', ceiling.id, [2, -0.4, 2], { light: true })
    create(light, ceiling.id)
    clearSceneHistory()
    expect(state().ceiling.hostedIds).toEqual([light.id])

    expect(removeRoomConstruction(zoneId, 'ceiling')).toEqual({ status: 'confirming' })
    const request = useDeleteConfirmation.getState().request!
    const content = deleteConfirmationContent(request, nodes())
    expect(content).toMatchObject({
      title: 'Remove the ceiling from Room?',
      keepLabel: 'Keep lights',
      confirmLabel: 'Remove all',
    })
    expect(content.description).toContain('1 light (Pendant) hangs from it')
    expect(content.description).not.toContain(light.id)
    expect(steps()).toBe(0)

    const height = resolveCeilingHeight(ceiling, nodes())
    request.onKeepContents!()
    useDeleteConfirmation.getState().cancel()
    expect(ceilingOf(zoneId)).toBeUndefined()
    // Still hanging where it was: on the level now, lifted by the ceiling height.
    expect(nodes()[light.id]).toMatchObject({ parentId: LEVEL })
    expect((nodes()[light.id] as ItemNode).position[1]).toBeCloseTo(height - 0.4)
    expect(steps()).toBe(1)
    useScene.temporal.getState().undo()
    expect(ceilingOf(zoneId)).toBeDefined()
    expect(nodes()[light.id]?.parentId).toBe(ceiling.id)

    clearSceneHistory()
    removeRoomConstruction(zoneId, 'ceiling')
    useDeleteConfirmation.getState().confirm()
    expect(ceilingOf(zoneId)).toBeUndefined()
    expect(nodes()[light.id]).toBeUndefined()
    expect(steps()).toBe(1)
  })

  test('Keep outside dimensions justifies exterior walls in one step, then reports nothing to do', () => {
    expect(lockRoomOutsideFaces(zoneId)).toEqual({ status: 'applied' })
    expect(steps()).toBe(1)
    for (const wall of ofType('wall') as WallNode[]) expect(wall.justification).toBeDefined()
    expect(lockRoomOutsideFaces(zoneId)).toEqual({ status: 'unchanged' })
    expect(steps()).toBe(1)
  })

  test('the Keep outside dimensions switch reads the walls and switches back off in one step', () => {
    const wallIds = (ofType('wall') as WallNode[]).map((wall) => wall.id)
    expect(roomOutsideFacesLocked(nodes(), wallIds)).toBe(false)
    lockRoomOutsideFaces(zoneId)
    expect(roomOutsideFacesLocked(nodes(), wallIds)).toBe(true)
    expect(unlockRoomOutsideFaces(wallIds)).toEqual({ status: 'applied' })
    expect(steps()).toBe(2)
    expect(roomOutsideFacesLocked(nodes(), wallIds)).toBe(false)
    for (const wall of ofType('wall') as WallNode[]) expect(wall.justification).toBeUndefined()
    expect(unlockRoomOutsideFaces(wallIds)).toEqual({ status: 'unchanged' })
    // No wall with an outside, nothing to lock: the switch is not offered.
    expect(roomOutsideFacesLocked(nodes(), [])).toBeNull()
  })

  test('Remove walls re-asks when a door is added while the dialog is open', () => {
    const [first, second] = ofType('wall') as WallNode[]
    const door = DoorNode.parse({
      id: 'door_front',
      name: 'Front door',
      parentId: first!.id,
      wallId: first!.id,
      position: [2, 0, 0],
    })
    create(door, first!.id)
    expect(removeRoomConstruction(zoneId, 'walls')).toEqual({ status: 'confirming' })
    const shown = dialog()
    expect(shown?.construction?.hostedIds).toEqual([door.id])

    const late = DoorNode.parse({
      id: 'door_back',
      name: 'Back door',
      parentId: second!.id,
      wallId: second!.id,
      position: [1, 0, 0],
    })
    create(late, second!.id)
    clearSceneHistory()
    useDeleteConfirmation.getState().confirm()
    // Nothing applied: the dialog now names both doors.
    expect(steps()).toBe(0)
    expect(nodes()[late.id]).toBeDefined()
    expect(dialog()).not.toBe(shown)
    expect([...dialog()!.construction!.hostedIds].sort()).toEqual([late.id, door.id].sort())
    expect(content().description).toContain('2 doors (Front door, Back door)')

    useDeleteConfirmation.getState().confirm()
    expect(nodes()[door.id]).toBeUndefined()
    expect(nodes()[late.id]).toBeUndefined()
    expect(state().walls.state).toBe('absent')
    expect(steps()).toBe(1)
  })

  test('Add walls previews the clear area the room loses, then builds in one step', () => {
    const otherId = divide()
    const before = area([roomClearPolygon(nodes(), zoneId)!])
    const preview = roomWallAdditionPreview(nodes(), zoneId)
    expect(preview.wallCount).toBe(1)
    expect(preview.areaLoss).toBeGreaterThan(TRIVIAL_AREA_LOSS)

    expect(addRoomConstruction(zoneId, 'walls')).toEqual({ status: 'confirming' })
    expect(steps()).toBe(0)
    expect(content()).toMatchObject({
      title: 'Add walls to Room?',
      description: `Adds 1 wall · the room loses ${preview.areaLoss.toFixed(2)} m² of floor.`,
      keepLabel: null,
      confirmLabel: 'Add walls',
      destructive: false,
    })
    useDeleteConfirmation.getState().confirm()
    expect(steps()).toBe(1)
    expect(state().walls.state).toBe('present')
    expect(before - area([roomClearPolygon(nodes(), zoneId)!])).toBeCloseTo(preview.areaLoss)
    expect(state(otherId).walls.sharedWallIds).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(ofType('separator')).toHaveLength(1)
  })

  test('Add walls re-asks when the loss changes, and applies at once when it is trivial', () => {
    divide()
    expect(addRoomConstruction(zoneId, 'walls')).toEqual({ status: 'confirming' })
    const shown = dialog()!.construction!.areaLoss!
    useEditor.setState({ toolDefaults: { wall: { thickness: 0.3 } } })
    try {
      useDeleteConfirmation.getState().confirm()
      expect(steps()).toBe(0)
      expect(dialog()!.construction!.areaLoss!).toBeGreaterThan(shown)
      useDeleteConfirmation.getState().cancel()

      useEditor.setState({ toolDefaults: { wall: { thickness: 0.004 } } })
      expect(roomWallAdditionPreview(nodes(), zoneId).areaLoss).toBeLessThan(TRIVIAL_AREA_LOSS)
      expect(addRoomConstruction(zoneId, 'walls')).toEqual({ status: 'applied' })
      expect(dialog()).toBeNull()
      expect(steps()).toBe(1)
    } finally {
      useEditor.setState({ toolDefaults: {} })
    }
  })

  test('Floor Remove previews what stands on it: keep at height, or delete in one step', () => {
    const plate = plateOf(zoneId)
    const sofa = item('item_sofa', 'Sofa', LEVEL, [2, 0, 2], { supportSlabId: plate.id })
    const lamp = item('item_lamp', 'Floor lamp', LEVEL, [6, 0, 1])
    const outside = item('item_bench', 'Bench', LEVEL, [12, 0, 2])
    const shelf = item('item_high', 'Shelf', LEVEL, [3, 1.2, 1])
    for (const node of [sofa, lamp, outside, shelf]) create(node, LEVEL)
    clearSceneHistory()
    expect(
      roomFloorContents(nodes(), zoneId)
        .map((c) => c.id)
        .sort(),
    ).toEqual([lamp.id, sofa.id].sort())

    expect(removeRoomConstruction(zoneId, 'floor')).toEqual({ status: 'confirming' })
    expect(steps()).toBe(0)
    expect(content()).toMatchObject({
      title: 'Remove the floor from Room?',
      keepLabel: 'Keep items',
      confirmLabel: 'Delete items',
    })
    expect(content().description).toContain('2 items (Sofa, Floor lamp) stand on it')

    dialog()!.onKeepContents!()
    useDeleteConfirmation.getState().cancel()
    expect(state().floor).toMatchObject({ state: 'absent', intent: false })
    expect(nodes()[sofa.id]).toMatchObject({
      position: [2, plate.elevation, 2],
      supportSlabId: GROUND_SUPPORT_ID,
    })
    expect(nodes()[lamp.id]).toMatchObject({ position: [6, plate.elevation, 1] })
    expect(nodes()[outside.id]).toMatchObject({ position: [12, 0, 2] })
    expect(steps()).toBe(1)
    useScene.temporal.getState().undo()
    expect(state().floor.state).toBe('present')
    expect(nodes()[sofa.id]).toMatchObject({ position: [2, 0, 2], supportSlabId: plate.id })

    clearSceneHistory()
    removeRoomConstruction(zoneId, 'floor')
    useDeleteConfirmation.getState().confirm()
    expect(nodes()[sofa.id]).toBeUndefined()
    expect(nodes()[lamp.id]).toBeUndefined()
    expect(nodes()[outside.id]).toBeDefined()
    expect(state().floor.intent).toBe(false)
    expect(steps()).toBe(1)
  })

  test('Floor Remove re-asks when an item lands on it while the dialog is open', () => {
    create(item('item_sofa', 'Sofa', LEVEL, [2, 0, 2]), LEVEL)
    expect(removeRoomConstruction(zoneId, 'floor')).toEqual({ status: 'confirming' })
    create(item('item_chair', 'Chair', LEVEL, [5, 0, 2]), LEVEL)
    clearSceneHistory()
    useDeleteConfirmation.getState().confirm()
    expect(steps()).toBe(0)
    expect(nodes()[zoneId as AnyNodeId]).not.toMatchObject({ hasFloor: false })
    expect(content().description).toContain('2 items (Sofa, Chair)')
  })

  test('ceiling contents come from its children and read neutrally unless they are lights', () => {
    const ceiling = ceilingOf(zoneId)!
    create(item('item_pendant', 'Pendant', ceiling.id, [2, -0.4, 2]), ceiling.id)
    create(item('item_fan', 'Fan', ceiling.id, [6, -0.3, 2]), ceiling.id)
    expect(state().ceiling.hostedIds).toEqual(ceilingOf(zoneId)!.children)
    expect(removeRoomConstruction(zoneId, 'ceiling')).toEqual({ status: 'confirming' })
    // A "lighting" category and a lamp-like name are not enough to call it a light.
    expect(content()).toMatchObject({ keepLabel: 'Keep items', confirmLabel: 'Remove all' })
    expect(content().description).toContain('2 items are on the ceiling (Pendant, Fan).')
    expect(content().description).not.toContain('light')
  })

  test('a hand-drawn ceiling: Use existing keeps it, in one intent step', () => {
    manualCeiling(WHOLE_ROOM)
    // The room's own ceiling is still there: Present, and Remove takes only it.
    expect(state().ceiling).toMatchObject({ state: 'present', manualIds: [] })
    clearSceneHistory()
    expect(removeRoomConstruction(zoneId, 'ceiling')).toEqual({ status: 'applied' })
    expect(ceilingOf(zoneId)).toBeUndefined()
    expect(nodes()['ceiling_manual' as AnyNodeId]).toBeDefined()
    expect(state().ceiling).toMatchObject({
      state: 'partial',
      intent: false,
      manualIds: ['ceiling_manual'],
      actions: { add: false, remove: true, useExisting: true, replace: true },
    })

    clearSceneHistory()
    expect(adoptExistingCeiling(zoneId)).toEqual({ status: 'applied' })
    expect(steps()).toBe(1)
    // The reconciler leaves a room covered by a hand-drawn ceiling alone.
    expect(ceilingOf(zoneId)).toBeUndefined()
    expect(state().ceiling).toMatchObject({
      state: 'partial',
      intent: true,
      actions: { add: false, remove: true, useExisting: false, replace: true },
    })
  })

  test('a hand-drawn ceiling: Replace swaps it for the room ceiling and rehangs its items', () => {
    removeRoomConstruction(zoneId, 'ceiling')
    const manual = manualCeiling(WHOLE_ROOM)
    const light = item('item_pendant', 'Pendant', manual.id, [2, -0.4, 2], { light: true })
    create(light, manual.id)
    clearSceneHistory()
    expect(state().ceiling.manualHostedIds).toEqual([light.id])

    expect(replaceRoomCeiling(zoneId)).toEqual({ status: 'applied' })
    expect(steps()).toBe(1)
    expect(nodes()[manual.id]).toBeUndefined()
    const generated = ceilingOf(zoneId)!
    expect(generated).toBeDefined()
    expect(nodes()[light.id]).toMatchObject({ parentId: generated.id, position: [2, -0.4, 2] })
    expect(state().ceiling).toMatchObject({ state: 'present', intent: true })

    useScene.temporal.getState().undo()
    expect(nodes()[manual.id]).toBeDefined()
    expect(nodes()[light.id]?.parentId).toBe(manual.id)
    expect(state().ceiling.intent).toBe(false)
  })

  test('a hand-drawn ceiling: Remove asks, names it and its items, and keeps them in place', () => {
    const otherId = divide()
    removeRoomConstruction(zoneId, 'ceiling')
    const manual = manualCeiling(WHOLE_ROOM)
    const light = item('item_pendant', 'Pendant', manual.id, [2, -0.4, 2], { light: true })
    create(light, manual.id)
    clearSceneHistory()
    const height = resolveCeilingHeight(manual, nodes())

    expect(removeRoomConstruction(zoneId, 'ceiling')).toEqual({ status: 'confirming' })
    expect(steps()).toBe(0)
    const other = (nodes()[otherId as AnyNodeId] as ZoneNode).name
    expect(content()).toMatchObject({
      title: 'Remove the ceiling from Room?',
      keepLabel: 'Keep lights',
      confirmLabel: 'Remove all',
    })
    expect(content().description).toContain('Removes the hand-drawn ceiling (Loft ceiling).')
    expect(content().description).toContain(`It also covers ${other.trim() || 'another room'}.`)
    expect(content().description).toContain('1 light (Pendant) hangs from it.')
    expect(content().description).not.toContain(manual.id)

    dialog()!.onKeepContents!()
    useDeleteConfirmation.getState().cancel()
    expect(nodes()[manual.id]).toBeUndefined()
    expect(nodes()[light.id]).toMatchObject({ parentId: LEVEL })
    expect((nodes()[light.id] as ItemNode).position[1]).toBeCloseTo(height - 0.4)
    expect(state().ceiling).toMatchObject({
      state: 'absent',
      actions: { add: true, remove: false },
    })
    expect(steps()).toBe(1)

    useScene.temporal.getState().undo()
    clearSceneHistory()
    removeRoomConstruction(zoneId, 'ceiling')
    useDeleteConfirmation.getState().confirm()
    expect(nodes()[manual.id]).toBeUndefined()
    expect(nodes()[light.id]).toBeUndefined()
    expect(steps()).toBe(1)
  })

  test('every row offers Remove exactly when something is there to remove', () => {
    const rows = () => {
      const room = state()
      for (const part of ['floor', 'walls', 'ceiling'] as const)
        if (room[part].state === 'absent') expect(room[part].actions.remove).toBe(false)
    }
    rows()
    removeRoomConstruction(zoneId, 'ceiling')
    rows()
    manualCeiling(WHOLE_ROOM)
    rows()
    expect(state().ceiling.actions.remove).toBe(true)
  })

  test('planner conflicts read as short sentences', () => {
    expect(
      roomConflictMessage([
        {
          code: 'stale-span',
          nodeIds: ['wall_a'],
          message: 'Replan against the current boundary.',
        },
        { code: 'invalid-span', nodeIds: ['wall_b'], message: 'x' },
      ]),
    ).toBe('The room changed. Try again.')
    expect(roomConflictMessage([{ code: 'other', nodeIds: [], message: 'Fallback.' }])).toBe(
      'Fallback.',
    )
  })
})
