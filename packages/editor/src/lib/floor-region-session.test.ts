import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  area,
  BuildingNode,
  clearSceneHistory,
  createZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  type MultiPolygon,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  bindFloorRegionPointer,
  resolveFloorRegionRoom,
} from '../components/editor/floor-region-controls'
import useEditor from '../store/use-editor'
import {
  CROSSING_MESSAGE,
  clipFloorRegion,
  floorRegionAxisAngle,
  floorRegionRectangle,
  floorRegionSelfIntersects,
} from './floor-region-geometry'
import {
  cancelFloorRegion,
  type FloorRegionRoom,
  finishFloorRegion,
  moveFloorRegion,
  PICK_MATERIAL_MESSAGE,
  pressFloorRegion,
  releaseFloorRegion,
  removeLastFloorRegionPoint,
  useFloorRegionDraft,
} from './floor-region-session'
import {
  type FloorRegionPoint,
  floorRegionSnapTargets,
  snapFloorRegionPoint,
} from './floor-region-snap'
import { usePaintRegionMode } from './paint-region-mode'
import { applyRoomPlan } from './room-structure-commands'

type P = FloorRegionPoint

const L_ROOM: MultiPolygon = [
  {
    outer: [
      [0, 0],
      [6, 0],
      [6, 2],
      [2, 2],
      [2, 5],
      [0, 5],
    ],
    holes: [],
  },
]
const U_ROOM: MultiPolygon = [
  {
    outer: [
      [0, 0],
      [6, 0],
      [6, 4],
      [4, 4],
      [4, 1],
      [2, 1],
      [2, 4],
      [0, 4],
    ],
    holes: [],
  },
]
const BOX_ROOM: MultiPolygon = [
  {
    outer: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    holes: [],
  },
]

const OFF = { mode: 'off', step: 0.5 } as const
const CLOSE = 0.2

const zone = ZoneNode.parse({
  id: 'zone_floor_region',
  name: 'Room',
  parentId: 'level_floor_region',
  polygon: BOX_ROOM[0]!.outer,
})
const room: FloorRegionRoom = {
  zoneId: zone.id,
  levelId: 'level_floor_region',
  clear: BOX_ROOM,
  elevation: 0.05,
  angle: 0,
  targets: floorRegionSnapTargets(BOX_ROOM),
}

const stubbed: string[] = []
const before = useScene.getState()
const regions = () =>
  (useScene.getState().nodes[zone.id as AnyNodeId] as ZoneNode).floor?.regions ?? []
const history = () => useScene.temporal.getState().pastStates.length
const draft = () => useFloorRegionDraft.getState().draft
const draftPoints = () => {
  const current = draft()
  return current?.kind === 'polygon' ? current.points : null
}
function click(point: P) {
  pressFloorRegion('polygon', room, point, OFF, CLOSE)
  releaseFloorRegion(CLOSE)
}

beforeEach(() => {
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
  if (!globalThis.window) {
    globalThis.window = new EventTarget() as Window & typeof globalThis
    stubbed.push('window')
  }
  useScene.setState({ nodes: { [zone.id]: zone }, materials: {}, readOnly: false })
  useScene.temporal.getState().resume()
  clearSceneHistory()
  useEditor.setState({
    mode: 'material-paint',
    activePaintMaterial: { materialPreset: 'library:tile', sourceTarget: 'wall' } as never,
  })
  usePaintRegionMode.getState().setMode('polygon')
  useFloorRegionDraft.setState({ draft: null, hover: null })
})
afterEach(() => {
  useScene.setState(before)
  usePaintRegionMode.getState().setMode('surface')
  useFloorRegionDraft.setState({ draft: null, hover: null })
  useEditor.setState({ mode: 'select', activePaintMaterial: null })
})
afterAll(async () => {
  // The release clears `inputDragging` on a 0 ms timer; let it fire first.
  await new Promise((resolve) => setTimeout(resolve, 50))
  for (const key of stubbed.splice(0)) delete (globalThis as Record<string, unknown>)[key]
})

describe('floor region geometry', () => {
  test('a rectangle clips to an L-shaped room and stores the clipped outline', () => {
    const box = floorRegionRectangle([1, 1], [4, 4], 0)
    expect(box).toEqual([
      [1, 1],
      [4, 1],
      [4, 4],
      [1, 4],
    ])
    const clip = clipFloorRegion(box, L_ROOM)!
    // 3 × 1 along the bottom arm, 1 × 2 up the side arm.
    expect(clip.area).toBeCloseTo(5)
    expect(clip.pieces).toHaveLength(1)
    expect(clip.polygon).toHaveLength(6)
    expect(area([{ outer: clip.polygon, holes: [] }])).toBeCloseTo(5)
    for (const [x, z] of clip.polygon) {
      expect(x >= 1 - 1e-9 && x <= 4 + 1e-9).toBe(true)
      expect(z >= 1 - 1e-9 && z <= 4 + 1e-9).toBe(true)
    }
  })

  test('a box the room splits keeps the drawn outline; nothing inside is null', () => {
    const box = floorRegionRectangle([1, 2], [5, 3], 0)
    const clip = clipFloorRegion(box, U_ROOM)!
    expect(clip.pieces).toHaveLength(2)
    expect(clip.area).toBeCloseTo(2)
    expect(clip.polygon).toEqual(box)
    expect(clipFloorRegion(floorRegionRectangle([2.5, 2], [3.5, 3], 0), U_ROOM)).toBeNull()
    // A click without a drag is not a region.
    expect(clipFloorRegion(floorRegionRectangle([1, 1], [1.05, 1.05], 0), L_ROOM)).toBeNull()
  })

  test('a room at an angle draws boxes along its longest edge', () => {
    const angle = Math.PI / 6
    const corner = (u: number, v: number): P => [
      u * Math.cos(angle) - v * Math.sin(angle),
      u * Math.sin(angle) + v * Math.cos(angle),
    ]
    const tilted: MultiPolygon = [
      { outer: [corner(0, 0), corner(6, 0), corner(6, 3), corner(0, 3)], holes: [] },
    ]
    expect(floorRegionAxisAngle(tilted)).toBeCloseTo(angle)
    expect(floorRegionAxisAngle(L_ROOM)).toBe(0)
    const box = floorRegionRectangle(corner(1, 1), corner(3, 2), angle)
    const expected = [corner(1, 1), corner(3, 1), corner(3, 2), corner(1, 2)]
    box.forEach((point, index) => {
      expect(point[0]).toBeCloseTo(expected[index]![0])
      expect(point[1]).toBeCloseTo(expected[index]![1])
    })
  })

  test('self-intersection', () => {
    expect(
      floorRegionSelfIntersects([
        [0, 0],
        [2, 0],
        [0, 2],
        [2, 2],
      ]),
    ).toBe(true)
    expect(
      floorRegionSelfIntersects([
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ]),
    ).toBe(false)
    // Folding back along the previous edge.
    expect(
      floorRegionSelfIntersects([
        [0, 0],
        [2, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toBe(true)
  })
})

describe('floor region snapping', () => {
  const targets = floorRegionSnapTargets(L_ROOM, [
    [
      [3, 0.5],
      [4, 0.5],
      [4, 1.5],
    ],
  ])
  test('grid rounds to the grid step', () => {
    expect(snapFloorRegionPoint([1.23, 0.76], { mode: 'grid', step: 0.5 }, targets)).toEqual({
      point: [1, 1],
      snap: 'grid',
    })
    expect(snapFloorRegionPoint([1.23, 0.76], { mode: 'grid', step: 0.25 }, targets).point).toEqual(
      [1.25, 0.75],
    )
  })
  test('lines pulls onto room corners, region vertices and edges within 0.1 m', () => {
    const lines = { mode: 'lines', step: 0.5 } as const
    expect(snapFloorRegionPoint([2.05, 1.96], lines, targets)).toEqual({
      point: [2, 2],
      snap: 'vertex',
    })
    expect(snapFloorRegionPoint([3.94, 0.53], lines, targets)).toEqual({
      point: [4, 0.5],
      snap: 'vertex',
    })
    const edge = snapFloorRegionPoint([1, 0.07], lines, targets)
    expect(edge.snap).toBe('edge')
    expect(edge.point[0]).toBeCloseTo(1)
    expect(edge.point[1]).toBeCloseTo(0)
    expect(snapFloorRegionPoint([1, 1], lines, targets)).toEqual({ point: [1, 1], snap: null })
  })
  test('off and Alt keep the raw point', () => {
    expect(snapFloorRegionPoint([1.23, 0.76], OFF, targets)).toEqual({
      point: [1.23, 0.76],
      snap: null,
    })
    expect(
      snapFloorRegionPoint([2.05, 1.96], { mode: 'lines', step: 0.5, free: true }, targets).point,
    ).toEqual([2.05, 1.96])
    expect(
      snapFloorRegionPoint([1.23, 0.76], { mode: 'grid', step: 0.5, free: true }, targets).point,
    ).toEqual([1.23, 0.76])
  })
})

describe('floor region draft', () => {
  test('rectangle: press, drag with grid snap, release paints one region in one undo step', () => {
    const grid = { mode: 'grid', step: 0.5 } as const
    expect(pressFloorRegion('rectangle', room, [1.1, 0.9], grid, CLOSE)).toBe(true)
    moveFloorRegion([2.8, 2.2], grid, CLOSE)
    expect(draft()).toMatchObject({ kind: 'rectangle', start: [1, 1], end: [3, 2] })
    releaseFloorRegion(CLOSE)
    expect(draft()).toBeNull()
    expect(regions()).toEqual([
      expect.objectContaining({
        polygon: [
          [1, 1],
          [3, 1],
          [3, 2],
          [1, 2],
        ],
        finish: 'library:tile',
      }),
    ])
    expect(history()).toBe(1)
  })

  test('rectangle: a box over the wall line is clipped to the room', () => {
    pressFloorRegion('rectangle', room, [3, 2], OFF, CLOSE)
    moveFloorRegion([5, 4], OFF, CLOSE)
    releaseFloorRegion(CLOSE)
    const [region] = regions()
    expect(area([{ outer: region!.polygon, holes: [] }])).toBeCloseTo(1)
    expect(Math.max(...region!.polygon.map(([x]) => x))).toBeCloseTo(4)
  })

  test('rectangle: a click without a drag paints nothing', () => {
    pressFloorRegion('rectangle', room, [1, 1], OFF, CLOSE)
    releaseFloorRegion(CLOSE)
    expect(regions()).toEqual([])
    expect(history()).toBe(0)
  })

  test('polygon: points, Backspace, then closing on the first point paints once', () => {
    click([1, 1])
    click([3, 1])
    click([3, 2.5])
    expect(draftPoints()).toEqual([
      [1, 1],
      [3, 1],
      [3, 2.5],
    ])
    expect(removeLastFloorRegionPoint()).toBe(true)
    expect(draftPoints()).toHaveLength(2)
    click([3, 2])
    click([1, 2])
    // Within the close radius of the first point.
    click([1.1, 1.05])
    expect(draft()).toBeNull()
    expect(regions()).toHaveLength(1)
    expect(area([{ outer: regions()[0]!.polygon, holes: [] }])).toBeCloseTo(2)
    expect(history()).toBe(1)
  })

  test('polygon: Enter closes with three points; Backspace on the last point ends the draft', () => {
    click([1, 1])
    click([3, 1])
    expect(finishFloorRegion()).toBe(false)
    click([2, 2])
    expect(finishFloorRegion()).toBe(true)
    expect(regions()).toHaveLength(1)
    click([1, 1])
    expect(removeLastFloorRegionPoint()).toBe(true)
    expect(draft()).toBeNull()
    expect(history()).toBe(1)
  })

  test('polygon: a crossing edge is refused and stays red', () => {
    click([0.5, 0.5])
    click([3, 0.5])
    click([0.5, 2.5])
    // The live edge back down crosses the first edge.
    pressFloorRegion('polygon', room, [2, 0.2], OFF, CLOSE)
    expect(draft()).toMatchObject({ message: CROSSING_MESSAGE })
    releaseFloorRegion(CLOSE)
    expect(draftPoints()).toHaveLength(3)
    click([3, 2.5])
    expect(draftPoints()).toHaveLength(4)
    // Closing (3, 2.5) → (0.5, 0.5) crosses (3, 0.5) → (0.5, 2.5).
    expect(finishFloorRegion()).toBe(true)
    expect(draft()).toMatchObject({ message: CROSSING_MESSAGE })
    expect(regions()).toEqual([])
    expect(history()).toBe(0)
  })

  test('no material, or the eraser, starts nothing and says why', () => {
    useEditor.setState({ activePaintMaterial: null })
    expect(pressFloorRegion('rectangle', room, [1, 1], OFF, CLOSE)).toBe(true)
    expect(draft()).toBeNull()
    expect(usePaintRegionMode.getState().notice).toBe(PICK_MATERIAL_MESSAGE)
    useEditor.setState({
      activePaintMaterial: { materialPreset: 'library:tile', sourceTarget: 'wall' } as never,
    })
    usePaintRegionMode.getState().setMode('erase')
    click([1, 1])
    expect(draft()).toBeNull()
  })

  test('the bound surface: press/release on the pointer, Backspace/Escape/Enter on the keyboard', () => {
    const surface = new EventTarget()
    const keyboard = new EventTarget()
    let at: P = [1, 1]
    const dispose = bindFloorRegionPointer(
      surface,
      () => ({ room, point: at }),
      () => CLOSE,
      keyboard,
    )
    const pointer = (type: string, target: EventTarget) =>
      target.dispatchEvent(
        Object.assign(new Event(type), { button: 0, pointerId: 1, altKey: true }),
      )
    const key = (value: string) =>
      keyboard.dispatchEvent(Object.assign(new Event('keydown'), { key: value }))
    const tap = (point: P) => {
      at = point
      pointer('pointerdown', surface)
      pointer('pointerup', keyboard)
    }
    try {
      tap([1, 1])
      tap([3, 1])
      tap([3, 2])
      key('Backspace')
      expect(draftPoints()).toEqual([
        [1, 1],
        [3, 1],
      ])
      key('Escape')
      expect(draft()).toBeNull()
      tap([1, 1])
      tap([3, 1])
      tap([2, 2])
      key('Enter')
      expect(draft()).toBeNull()
      expect(regions()).toHaveLength(1)
      expect(history()).toBe(1)
      // Outside the sub-mode the surface ignores the pointer.
      usePaintRegionMode.getState().setMode('surface')
      tap([1, 1])
      expect(draft()).toBeNull()
    } finally {
      dispose()
      cancelFloorRegion()
      useViewer.getState().setInputDragging(false)
    }
  })
})

describe('floor region room resolution', () => {
  const LEVEL = 'level_floor_region_rooms'
  let stop = () => {}
  afterEach(() => stop())

  test('a plan point resolves to the room whose clear floor holds it', () => {
    const building = BuildingNode.parse({ id: 'building_floor_region', children: [LEVEL] })
    const level = LevelNode.parse({ id: LEVEL, parentId: building.id })
    useScene.setState({
      nodes: { [building.id]: building, [level.id]: level },
      rootNodeIds: [building.id],
      dirtyNodes: new Set(),
      materials: {},
      collections: {},
      readOnly: false,
    })
    stop = initSpaceDetectionSync(useScene, {
      getState: () => ({ spaces: {}, setSpaces: () => {} }),
    })
    const add = (polygon: P[]) => {
      const plan = createZone(useScene.getState().nodes, {
        levelId: LEVEL,
        polygon,
        enclose: true,
        mintId: generateId,
      })
      applyRoomPlan(plan)
      return plan.zoneId
    }
    const west = add([
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ])
    const east = add([
      [6, 0],
      [10, 0],
      [10, 4],
      [6, 4],
    ])
    expect(resolveFloorRegionRoom(LEVEL, [2, 2])?.zoneId).toBe(west)
    const eastRoom = resolveFloorRegionRoom(LEVEL, [8, 2])
    expect(eastRoom?.zoneId).toBe(east)
    expect(eastRoom?.levelId).toBe(LEVEL)
    expect(eastRoom?.angle).toBe(0)
    // On the shared wall and outside every room: no floor to paint.
    expect(resolveFloorRegionRoom(LEVEL, [6, 2])).toBeNull()
    expect(resolveFloorRegionRoom(LEVEL, [12, 2])).toBeNull()
  })
})
