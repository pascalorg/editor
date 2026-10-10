import { describe, expect, test } from 'bun:test'
import { PerspectiveCamera, Vector3 } from 'three'
import { isAgentRefusal } from '../agent-tools'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  ColumnNode,
  DoorNode,
  FenceNode,
  GuideNode,
  ItemNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  StairNode,
  WallNode,
  WindowNode,
} from '../schema'
import {
  photoCropSize,
  type SceneViewBox,
  sceneViewBounds,
  sceneViewFacing,
  sceneViewNote,
  sceneViewPlan,
  sceneViewPose,
  VIEW_SIZE,
} from './scene-view'

/**
 * `view_scene`: the agent looks at what it built from a viewpoint it picks, to compare it with a
 * reference (the facade against the photo). The ways it can go wrong, written before the tool:
 * - the frame misses the target, or the eye stands inside the building;
 * - a compass side read the wrong way round (north is the plan's top edge, z down);
 * - an imported plan, larger than the building, sets the frame;
 * - a street view not at street height; an elevation that cuts the face off;
 * - a render from the photo's camera at another aspect than the photo's, so the two do not overlay.
 * The capture itself is the host's: the chat's editor, or an editor tab the MCP asks.
 */

// Two storeys of 3 m, a 20 × 10 m outline from (0, 0) to (20, 10), and a 60 m plan guide.
function building(): Record<string, AnyNode> {
  const site = BuildingNode.parse({ id: 'building_main', children: ['level_0', 'level_1'] })
  const levels = [0, 1].map((index) =>
    LevelNode.parse({ id: `level_${index}`, parentId: site.id, level: index, height: 3 }),
  )
  const walls = levels.flatMap((level) =>
    (
      [
        [
          [0, 0],
          [20, 0],
        ],
        [
          [20, 0],
          [20, 10],
        ],
        [
          [20, 10],
          [0, 10],
        ],
        [
          [0, 10],
          [0, 0],
        ],
      ] as [number, number][][]
    ).map(([start, end], index) =>
      WallNode.parse({ id: `wall_${level.id}_${index}`, parentId: level.id, start, end }),
    ),
  )
  const guide = GuideNode.parse({
    id: 'guide_plan',
    parentId: 'level_0',
    url: '/plans/floor.svg',
    scale: 60,
  })
  const nodes = [
    site,
    ...levels.map((level) => ({
      ...level,
      children: walls.filter((wall) => wall.parentId === level.id).map((wall) => wall.id),
    })),
    ...walls,
    guide,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node as AnyNode]))
}

const box: SceneViewBox = { min: [0, 0, 0], max: [20, 6, 10] }

describe('an explicitly requested floor interior', () => {
  // Capture-only policy: preserve authored geometry and exact camera choice.
  // The mounted renderer test, not these plan assertions, proves visible interiors.
  test('plans the floor without changing the scene or the ordinary exterior request', () => {
    const nodes = building()
    const before = structuredClone(nodes)
    const camera = { position: [25, 14, 18], target: [10, 1, 5], fov: 53, aspect: 4 / 3 }
    const ordinary = sceneViewPlan(nodes, { camera })
    const interior = sceneViewPlan(nodes, { camera, interior: { levelId: 'level_0' } })
    expect(ordinary.interior).toBeUndefined()
    expect(interior.pose).toEqual(ordinary.pose)
    expect(interior.size).toEqual(ordinary.size)
    expect(interior.interior).toMatchObject({
      levelId: 'level_0',
      bounds: { min: [0, 0, 0], max: [20, 3, 10] },
    })
    expect(interior.interior!.cutHeight).toBeGreaterThan(0)
    expect(interior.interior!.cutHeight).toBeLessThan(3)
    expect(nodes).toEqual(before)
  })

  test('an exact camera does not bypass validation of the requested interior level', () => {
    const nodes = building()
    const camera = { position: [25, 14, 18], target: [10, 1, 5], fov: 53, aspect: 4 / 3 }
    for (const levelId of ['level_missing', 'building_main', 'wall_level_0_0']) {
      expect(() => sceneViewPlan(nodes, { camera, interior: { levelId } })).toThrow()
    }
  })
})

/** Every corner of the box inside the frame of a camera at the pose. */
function framesBox(pose: ReturnType<typeof sceneViewPose>, target: SceneViewBox) {
  if (pose.projection !== 'perspective') throw new Error('perspective expected')
  const camera = new PerspectiveCamera(pose.fov, VIEW_SIZE.w / VIEW_SIZE.h, 0.1, 10_000)
  camera.position.fromArray(pose.position)
  camera.lookAt(new Vector3(...pose.target))
  camera.updateMatrixWorld()
  for (const x of [target.min[0], target.max[0]])
    for (const y of [target.min[1], target.max[1]])
      for (const z of [target.min[2], target.max[2]]) {
        const ndc = new Vector3(x, y, z).project(camera)
        if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || ndc.z > 1) return false
      }
  return true
}

describe('what a view frames', () => {
  test("a building's walls at their storeys' heights, not its imported plan", () => {
    expect(sceneViewBounds(building())).toEqual({ min: [0, 0, 0], max: [20, 6, 10] })
    expect(sceneViewBounds(building(), 'building_main')).toEqual({
      min: [0, 0, 0],
      max: [20, 6, 10],
    })
  })

  test('a level, or one wall, at its own storey', () => {
    expect(sceneViewBounds(building(), 'level_1')).toEqual({ min: [0, 3, 0], max: [20, 6, 10] })
    expect(sceneViewBounds(building(), 'wall_level_0_0')).toEqual({
      min: [0, 0, 0],
      max: [20, 3, 0],
    })
  })

  test('an unknown target is refused', () => {
    let code: string | null = null
    try {
      sceneViewBounds(building(), 'wall_nowhere')
    } catch (error) {
      if (isAgentRefusal(error)) code = error.code
    }
    expect(code).toBe('target_not_found')
  })
})

describe('where the eye stands', () => {
  test('from the north-west it stands past the north-west corner (north is the plan top, -z)', () => {
    const pose = sceneViewPose(box, { from: 'north-west' })
    expect(pose.position[0]).toBeLessThan(0)
    expect(pose.position[2]).toBeLessThan(0)
    expect(pose.position[1]).toBeGreaterThan(0)
    expect(pose.target).toEqual([10, 3, 5])
    expect(framesBox(pose, box)).toBe(true)
  })

  test('every side frames the whole target, from outside it', () => {
    for (const from of ['north', 'east', 'south', 'west', 'south-east', 'above'] as const) {
      const pose = sceneViewPose(box, { from })
      expect({ from, frames: framesBox(pose, box) }).toEqual({ from, frames: true })
      const [x, y, z] = pose.position
      const inside = x > 0 && x < 20 && z > 0 && z < 10 && y < 6
      expect({ from, inside }).toEqual({ from, inside: false })
    }
  })

  test('a street view keeps the eye at the height asked, and still frames the building', () => {
    const pose = sceneViewPose(box, { from: 'south', eyeHeight: 1.7 })
    expect(pose.position[1]).toBe(1.7)
    expect(framesBox(pose, box)).toBe(true)
  })

  test('an orthographic elevation from the south covers the whole south face', () => {
    const pose = sceneViewPose(box, { from: 'south', projection: 'orthographic' })
    if (pose.projection !== 'orthographic') throw new Error('orthographic expected')
    expect(pose.position[2]).toBeGreaterThan(10)
    expect(pose.viewWidth).toBeGreaterThanOrEqual(20)
    // and its height, at the frame's aspect
    expect(pose.viewWidth).toBeGreaterThanOrEqual((6 * VIEW_SIZE.w) / VIEW_SIZE.h)
  })

  test('an eye placed by hand stays where it was put, looking at the target', () => {
    const pose = sceneViewPose(box, { position: [-5, 1.7, 30] })
    expect(pose.position).toEqual([-5, 1.7, 30])
    expect(pose.target).toEqual([10, 3, 5])
  })
})

// An agent with no view over the MCP drew its own elevation from coordinates;
// straighten_facade_photo gives the photo's camera (camera.pose) to render the build from.
describe("the photo's camera", () => {
  const pose = {
    projection: 'perspective',
    position: [8, 1.6, 24],
    target: [8, 2.5, 5],
    up: [0, 1, 0],
    fov: 52,
    aspect: 1.5,
    shift: 0,
    anchoredBy: 'row height',
    focalAssumed: true,
    edgeResidualPx: 1.2,
  }

  test('the render stands where the photo was taken, at the photo’s aspect', () => {
    const plan = sceneViewPlan(building(), { camera: pose })
    expect(plan.pose).toEqual({
      projection: 'perspective',
      position: [8, 1.6, 24],
      target: [8, 2.5, 5],
      fov: 52,
    })
    expect(plan.size).toEqual({ w: VIEW_SIZE.w, h: Math.round(VIEW_SIZE.w / 1.5) })
  })

  test('a camera and a viewpoint of its own are refused together', () => {
    let code: string | null = null
    try {
      sceneViewPlan(building(), { camera: pose, from: 'south' })
    } catch (error) {
      if (isAgentRefusal(error)) code = error.code
    }
    expect(code).toBe('camera_and_viewpoint')
  })

  test('without one, the view frames the target at the standard size', () => {
    const plan = sceneViewPlan(building(), { from: 'south', eyeHeight: 1.7 })
    expect(plan.size).toEqual({ ...VIEW_SIZE })
    expect(plan.pose.position[1]).toBe(1.7)
  })
})

// Run 3 (2026-10-05) compared whole facades with view_scene and never recorded what the photo
// showed: the note a view comes with invites the inventory until one exists (L15).
describe('the note a view comes with', () => {
  const building = (inventory?: unknown[]) => ({
    building_note: BuildingNode.parse({
      id: 'building_note',
      ...(inventory ? { metadata: { referenceInventory: { items: inventory } } } : {}),
    }),
  })

  test('says a view is not a measure, and invites the inventory until one exists', () => {
    const bare = sceneViewNote(building())
    expect(bare).toContain('not a measure')
    expect(bare).toContain('record_reference')
    const recorded = sceneViewNote(
      building([{ image: 'p', id: 'x', kind: 'fixture', what: 'A lamp', status: 'to_build' }]),
    )
    expect(recorded).toContain('not a measure')
    expect(recorded).not.toContain('record_reference')
  })
})

describe('the note a view comes with', () => {
  test('says a view is a picture to compare, not a measure', () => {
    expect(sceneViewNote()).toContain('not a measure')
  })
})

// An agent that compared whole facades only settled for a plain door against the photo's door
// with three glass strips. A view frames one opening or item at detail scale, an opening from its
// outside face, so it can be laid beside the photo's crop of the same element.
/** A 10 m wall along x drawn so its outside is the north (-z) side, a door and a window in it. */
function facadeScene(
  outside: 'front' | 'back',
  placed: { position?: [number, number, number]; rotation?: [number, number, number] } = {},
) {
  const wall = WallNode.parse({
    id: 'wall_face',
    parentId: 'level_face',
    start: outside === 'back' ? [0, 0] : [10, 0],
    end: outside === 'back' ? [10, 0] : [0, 0],
    thickness: 0.2,
    height: 2.8,
    frontSide: outside === 'front' ? 'exterior' : 'interior',
    backSide: outside === 'front' ? 'interior' : 'exterior',
    children: ['door_face', 'window_face'],
  })
  const along = (x: number) => (outside === 'back' ? x : 10 - x)
  const door = DoorNode.parse({
    id: 'door_face',
    parentId: wall.id,
    wallId: wall.id,
    position: [along(3), 1.05, 0],
    width: 0.9,
    height: 2.1,
  })
  const window = WindowNode.parse({
    id: 'window_face',
    parentId: wall.id,
    wallId: wall.id,
    position: [along(7), 1.5, 0],
    width: 1.2,
    height: 1.2,
  })
  const lamp = ItemNode.parse({
    id: 'item_lamp',
    parentId: 'level_face',
    position: [5, 0, 4],
    asset: {
      id: 'floor-lamp',
      name: 'Floor lamp',
      category: 'lighting',
      thumbnail: '/items/floor-lamp/thumbnail.webp',
      src: '/items/floor-lamp/model.glb',
      dimensions: [0.4, 1.6, 0.4],
    },
  })
  const level = LevelNode.parse({
    id: 'level_face',
    parentId: 'building_face',
    level: 0,
    height: 2.8,
    children: [wall.id, lamp.id],
  })
  const building = BuildingNode.parse({ id: 'building_face', children: [level.id], ...placed })
  return Object.fromEntries(
    [building, level, wall, door, window, lamp].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
}

describe('a close-up of one element', () => {
  const facade = (outside: 'front' | 'back') => facadeScene(outside)

  test('a door frames its own box, at detail scale', () => {
    const box = sceneViewBounds(facade('back'), 'door_face')
    expect(box.min.map((v) => Math.round(v * 100) / 100)).toEqual([2.55, 0, -0.1])
    expect(box.max.map((v) => Math.round(v * 100) / 100)).toEqual([3.45, 2.1, 0.1])
  })

  test('an opening is seen from its outside face, whichever way its wall was drawn', () => {
    for (const outside of ['back', 'front'] as const) {
      const { pose } = sceneViewPlan(facade(outside), { target: 'door_face' })
      expect(pose.position[2]).toBeLessThan(0)
      const [cx, , cz] = pose.target as number[]
      expect(Math.hypot(pose.position[0] - cx!, pose.position[2] - cz!)).toBeLessThan(6)
    }
  })

  test('a window frames its own box too, and a floor item by its dimensions', () => {
    const window = sceneViewBounds(facade('back'), 'window_face')
    expect(window.max[1] - window.min[1]).toBeCloseTo(1.2, 6)
    expect(window.max[0] - window.min[0]).toBeCloseTo(1.2, 6)
    const lamp = sceneViewBounds(facade('back'), 'item_lamp')
    expect(lamp.min.map((v) => Math.round(v * 100) / 100)).toEqual([4.8, 0, 3.8])
    expect(lamp.max.map((v) => Math.round(v * 100) / 100)).toEqual([5.2, 1.6, 4.2])
  })
})

// The other half: the photo's crop of the same element comes back beside the close-up, in one
// call. The region is in the photo's pixels, as an agent measures it; the host crops.
describe("the photo's crop beside the view", () => {
  const scene = () => {
    const wall = WallNode.parse({ id: 'wall_p', parentId: 'level_p', start: [0, 0], end: [8, 0] })
    const level = LevelNode.parse({ id: 'level_p', parentId: 'building_p', children: [wall.id] })
    const building = BuildingNode.parse({ id: 'building_p', children: [level.id] })
    return Object.fromEntries([building, level, wall].map((n) => [n.id, n])) as Record<
      string,
      AnyNode
    >
  }

  test('a region of the photo is passed on to crop, whole numbers of pixels', () => {
    const { crop } = sceneViewPlan(scene(), {
      photo: { source: 'data:image/png;base64,AAAA', region: [60.4, 200, 620, 470.6] },
    })
    expect(crop).toEqual({ source: 'data:image/png;base64,AAAA', region: [60, 200, 620, 471] })
  })

  test('an empty or inverted region is refused', () => {
    for (const region of [
      [100, 100, 100, 200],
      [300, 100, 200, 200],
    ]) {
      let code = ''
      try {
        sceneViewPlan(scene(), { photo: { source: 'x', region } })
      } catch (error) {
        if (isAgentRefusal(error)) code = error.code
      }
      expect(code).toBe('photo_region_invalid')
    }
  })
})

// Both hosts return a crop at most 1280 px long, as a view is (the hosted one capped, the chat's
// did not: a whole 4000-px photo as the region went to the model at full size).
describe("a crop's size", () => {
  test('kept below 1280 px on its longer side', () => {
    expect(photoCropSize(4000, 3000)).toEqual({ width: 1280, height: 960 })
    expect(photoCropSize(560, 270)).toEqual({ width: 560, height: 270 })
  })

  // A front door's crop came back 85 × 155 px, its four glass strips
  // about 8 px each, under what a vision model resolves. A small crop is enlarged to 512 px: no
  // new detail, but the strips stand apart.
  test('a small crop is enlarged to 512 px on its longer side', () => {
    expect(photoCropSize(85, 155)).toEqual({ width: 281, height: 512 })
  })
})

// view_scene could not look at the steps an agent built (nothing_to_view: "no walls
// to look at"). A stair, a column, a fence or a slab frames by its own bounds, as an opening does.
describe('a close-up of a site element', () => {
  function site() {
    const column = ColumnNode.parse({
      id: 'column_s',
      parentId: 'level_s',
      position: [2, 0, 3],
      height: 2.5,
    })
    const fence = FenceNode.parse({
      id: 'fence_s',
      parentId: 'level_s',
      start: [0, 8],
      end: [6, 8],
      height: 1.8,
    })
    const lawn = SlabNode.parse({
      id: 'slab_lawn',
      parentId: 'level_s',
      polygon: [
        [0, 4],
        [6, 4],
        [6, 7],
        [0, 7],
      ],
      elevation: 0.01,
    })
    const steps = StairNode.parse({
      id: 'stair_s',
      parentId: 'level_s',
      position: [4, 0, 1],
      width: 1.2,
      totalRise: 0.45,
      fromLevelId: 'level_s',
      toLevelId: null,
    })
    const level = LevelNode.parse({
      id: 'level_s',
      parentId: 'building_s',
      level: 0,
      children: [column.id, fence.id, lawn.id, steps.id],
    })
    const building = BuildingNode.parse({ id: 'building_s', children: [level.id] })
    return Object.fromEntries(
      [building, level, column, fence, lawn, steps].map((n) => [n.id, n]),
    ) as Record<string, AnyNode>
  }
  const r = (v: number) => Math.round(v * 100) / 100

  // furnish_from_plan live (22:30): a level with furniture and no walls yet answered
  // nothing_to_view. A level, a building or the scene frames all it holds when it has no walls.
  test('a level, its building or the scene with no walls frames everything on it', () => {
    for (const target of ['level_s', 'building_s', undefined]) {
      const box = sceneViewBounds(site(), target)
      expect(box.min[0]).toBeLessThanOrEqual(0)
      expect(box.max[0]).toBeGreaterThanOrEqual(6)
      expect(box.max[2]).toBeGreaterThanOrEqual(8)
      expect(box.max[1]).toBeGreaterThan(box.min[1])
    }
    const bed = ItemNode.parse({
      id: 'item_bed',
      parentId: 'level_i',
      position: [3, 0, 2],
      asset: {
        id: 'double-bed',
        category: 'furniture',
        name: 'Double bed',
        thumbnail: '',
        src: '/items/double-bed/model.glb',
        dimensions: [1.6, 0.5, 2.1],
      },
    })
    const level = LevelNode.parse({ id: 'level_i', parentId: 'building_i', children: [bed.id] })
    const building = BuildingNode.parse({ id: 'building_i', children: [level.id] })
    const nodes = Object.fromEntries([building, level, bed].map((n) => [n.id, n])) as Record<
      string,
      AnyNode
    >
    const box = sceneViewBounds(nodes, 'level_i')
    expect([r(box.min[0]), r(box.max[0]), r(box.min[2]), r(box.max[2])]).toEqual([
      2.2, 3.8, 0.95, 3.05,
    ])
  })

  test('a column, a fence and a slab frame their own boxes', () => {
    const column = sceneViewBounds(site(), 'column_s')
    expect([r(column.min[1]), r(column.max[1])]).toEqual([0, 2.5])
    expect(column.min[0]).toBeLessThan(2)
    expect(column.max[0]).toBeGreaterThan(2)
    const fence = sceneViewBounds(site(), 'fence_s')
    // Along its run, padded by half its thickness.
    expect(fence.min[0]).toBeCloseTo(-0.04, 6)
    expect(fence.max[0]).toBeCloseTo(6.04, 6)
    expect(r(fence.max[1])).toBe(1.8)
    const lawn = sceneViewBounds(site(), 'slab_lawn')
    expect([r(lawn.min[0]), r(lawn.max[0]), r(lawn.min[2]), r(lawn.max[2])]).toEqual([0, 6, 4, 7])
    expect(lawn.max[1] - lawn.min[1]).toBeGreaterThan(0.2)
  })

  test('steps frame round their foot, as tall as they rise', () => {
    const steps = sceneViewBounds(site(), 'stair_s')
    expect(steps.min[0]).toBeLessThan(4)
    expect(steps.max[0]).toBeGreaterThan(4)
    expect(r(steps.max[1])).toBeGreaterThanOrEqual(0.45)
    const { pose } = sceneViewPlan(site(), { target: 'stair_s' })
    expect(pose.position.every(Number.isFinite)).toBe(true)
  })
})

// A piece place_items hosts (art on a wall, a lamp on a table, a pendant under a ceiling) has its
// parent's frame, not the level's: it frames where it hangs, rests or stands, never nothing_to_view.
describe('a close-up of a hosted item', () => {
  const asset = (id: string, dimensions: [number, number, number]) => ({
    id,
    category: 'decor',
    name: id,
    thumbnail: '',
    src: `/items/${id}/model.glb`,
    dimensions,
  })
  function room() {
    const wall = WallNode.parse({ id: 'wall_h', parentId: 'level_h', start: [0, 0], end: [4, 0] })
    const art = ItemNode.parse({
      id: 'item_art',
      parentId: wall.id,
      position: [1, 1.2, 0.05],
      asset: asset('art', [0.8, 0.6, 0.04]),
    })
    const table = ItemNode.parse({
      id: 'item_table',
      parentId: 'level_h',
      position: [2, 0, 2],
      rotation: [0, Math.PI / 2, 0],
      asset: asset('table', [1.2, 0.75, 0.8]),
    })
    const lamp = ItemNode.parse({
      id: 'item_lamp',
      parentId: table.id,
      position: [0.3, 0.75, 0],
      asset: asset('lamp', [0.3, 0.5, 0.3]),
    })
    const ceiling = CeilingNode.parse({
      id: 'ceiling_h',
      parentId: 'level_h',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      height: 2.5,
    })
    const pendant = ItemNode.parse({
      id: 'item_pendant',
      parentId: ceiling.id,
      position: [3, -0.4, 3],
      asset: asset('pendant', [0.4, 0.4, 0.4]),
    })
    const level = LevelNode.parse({
      id: 'level_h',
      parentId: 'building_h',
      level: 0,
      children: [wall.id, table.id, ceiling.id],
    })
    const building = BuildingNode.parse({ id: 'building_h', children: [level.id] })
    return Object.fromEntries(
      [building, level, wall, art, table, lamp, ceiling, pendant].map((n) => [n.id, n]),
    ) as Record<string, AnyNode>
  }
  const centre = (box: SceneViewBox) => box.min.map((v, axis) => (v + box.max[axis]!) / 2)

  test('art on a wall, a lamp on a table and a pendant under a ceiling frame where they are', () => {
    const nodes = room()
    // Art 1 m along a wall drawn +x, its bottom 1.2 m up: centred at x 1, y 1.5, just off the wall.
    const [ax, ay, az] = centre(sceneViewBounds(nodes, 'item_art'))
    expect([Math.round(ax! * 10) / 10, Math.round(ay! * 10) / 10]).toEqual([1, 1.5])
    expect(Math.abs(az!)).toBeLessThan(0.3)
    // The lamp 0.3 m along a table turned a quarter: beside the table's centre, on its top.
    const lamp = sceneViewBounds(nodes, 'item_lamp')
    const [lx, , lz] = centre(lamp)
    expect(Math.hypot(lx! - 2, lz! - 2)).toBeCloseTo(0.3, 1)
    expect(lamp.min[1]).toBeCloseTo(0.75, 2)
    // The pendant hangs 0.4 m under a 2.5 m ceiling at (3, 3).
    const pendant = sceneViewBounds(nodes, 'item_pendant')
    const [px, , pz] = centre(pendant)
    expect([Math.round(px! * 10) / 10, Math.round(pz! * 10) / 10]).toEqual([3, 3])
    expect(pendant.min[1]).toBeCloseTo(2.1, 2)
  })
})

/** A 10 x 8 m house on a 2.45 m storey under a 22.5 degree hip roof seated on its top. */
function hipHouse({ rotation = 0 }: { rotation?: number } = {}) {
  const building = BuildingNode.parse({ id: 'building_main' })
  const storey = LevelNode.parse({ id: 'level_0', parentId: building.id, level: 0, height: 2.45 })
  const roofLevel = LevelNode.parse({ id: 'level_roof', parentId: building.id, level: 1 })
  const corners: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: storey.id,
      start,
      end: corners[(index + 1) % 4]!,
    }),
  )
  const segment = RoofSegmentNode.parse({
    id: 'rseg_main',
    parentId: 'roof_main',
    roofType: 'hip',
    width: 10,
    depth: 8,
    pitch: 22.5,
    wallHeight: 0,
  })
  const roof = RoofNode.parse({
    id: 'roof_main',
    parentId: roofLevel.id,
    position: [5, 0, 4],
    rotation,
    children: [segment.id],
  })
  const nodes = [building, storey, roofLevel, ...walls, roof, segment].map((node) => ({
    ...node,
    children: 'children' in node && Array.isArray(node.children) ? node.children : [],
  })) as unknown as AnyNode[]
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, AnyNode>
  const attach = (parentId: string, ids: string[]) => {
    ;(byId[parentId] as { children: string[] }).children = ids
  }
  attach(building.id, [storey.id, roofLevel.id])
  attach(
    storey.id,
    walls.map((wall) => wall.id),
  )
  attach(roofLevel.id, [roof.id])
  return { nodes: byId }
}

// A check of a roof against what carries it (coherence items) asks to look at the roof: its level
// held nothing a view could frame, so the look failed with nothing_to_view where the defect was.
describe('a close-up of a roof', () => {
  const r = (v: number) => Math.round(v * 100) / 100
  const house = () => hipHouse().nodes

  test('a roof, and the level it is on, frame its footprint from its seat to its peak', () => {
    for (const target of ['roof_main', 'level_roof']) {
      const box = sceneViewBounds(house(), target)
      // 10 × 8 m about (5, 4), seated on the 2.45 m storey; a 22.5° hip over the 4 m half-span.
      expect([r(box.min[0]), r(box.max[0]), r(box.min[2]), r(box.max[2])]).toEqual([0, 10, 0, 8])
      expect(r(box.min[1])).toBe(2.45)
      expect(box.max[1]).toBeGreaterThan(3.5)
    }
  })

  test('a turned roof frames the footprint it covers in the plan', () => {
    const box = sceneViewBounds(hipHouse({ rotation: Math.PI / 2 }).nodes, 'roof_main')
    // A quarter turn about its centre swaps the half-extents: 8 m east-west, 10 m north-south.
    expect([r(box.max[0] - box.min[0]), r(box.max[2] - box.min[2])]).toEqual([8, 10])
  })

  test('the building still frames its walls, and the roof level is not in its frame', () => {
    const box = sceneViewBounds(house(), 'building_main')
    expect([r(box.min[1]), r(box.max[1])]).toEqual([0, 2.45])
  })

  test('the picture is taken from outside the roof, centred on it', () => {
    const { pose } = sceneViewPlan(house(), {
      target: 'roof_main',
      from: 'south-west',
      elevation: 35,
    })
    expect(pose.target[0]).toBeCloseTo(5, 1)
    expect(pose.target[2]).toBeCloseTo(4, 1)
    expect(pose.position[1]).toBeGreaterThan(pose.target[1])
  })
})

// The plancrafters cottage stands at [5.7, 0, 16.5] on its site. Everything under a building is
// drawn in that building's frame, and the views were planned in it unmoved: a window as target
// framed bare ground 16 m north of the house, a wall showed the house off to one side.
describe('a building away from the origin', () => {
  const at: [number, number, number] = [5.7, 0, 16.5]
  const placed = () => facadeScene('back', { position: at })
  const r = (v: number) => Math.round(v * 100) / 100
  const rounded = (box: SceneViewBox) => ({ min: box.min.map(r), max: box.max.map(r) })
  const moved = (box: SceneViewBox): SceneViewBox => ({
    min: [box.min[0] + at[0], box.min[1] + at[1], box.min[2] + at[2]],
    max: [box.max[0] + at[0], box.max[1] + at[1], box.max[2] + at[2]],
  })

  test('every target frames where it stands: the box it has at the origin, moved with the building', () => {
    for (const target of [
      'door_face',
      'window_face',
      'wall_face',
      'level_face',
      'building_face',
      'item_lamp',
    ]) {
      expect(rounded(sceneViewBounds(placed(), target)), target).toEqual(
        rounded(moved(sceneViewBounds(facadeScene('back'), target))),
      )
    }
    expect(rounded(sceneViewBounds(placed()))).toEqual(
      rounded(moved(sceneViewBounds(facadeScene('back')))),
    )
  })

  test('the eye looks at the window, and from its outside', () => {
    const { pose } = sceneViewPlan(placed(), { target: 'window_face' })
    const window = sceneViewBounds(placed(), 'window_face')
    expect(framesBox(pose as never, window)).toBe(true)
    // The wall is drawn so its outside is the north (-z) side, as it was at the origin.
    expect(pose.position[2]).toBeLessThan(window.min[2])
  })

  test('a turned building turns its boxes and the side an opening is seen from', () => {
    const quarter: [number, number, number] = [0, Math.PI / 2, 0]
    const turned = facadeScene('back', { position: at, rotation: quarter })
    const local = sceneViewBounds(facadeScene('back'), 'window_face')
    const centre = [
      (local.min[0] + local.max[0]) / 2,
      (local.min[1] + local.max[1]) / 2,
      (local.min[2] + local.max[2]) / 2,
    ]
    // A quarter turn about the building's origin: local (x, z) lands at (z, -x) in the site.
    const expected = [at[0] + centre[2]!, centre[1]!, at[2] - centre[0]!].map(r)
    const box = sceneViewBounds(turned, 'window_face')
    expect(
      [
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
      ].map(r),
    ).toEqual(expected)
    // Its outside was north (-z) in the building's frame: after the turn, one side of the site.
    const { pose } = sceneViewPlan(turned, { target: 'window_face' })
    expect(framesBox(pose as never, box)).toBe(true)
    expect(Math.abs(pose.position[0] - (box.min[0] + box.max[0]) / 2)).toBeGreaterThan(
      Math.abs(pose.position[2] - (box.min[2] + box.max[2]) / 2),
    )
  })
})

// Follow Pascal looks at an opening from the way it faces; the agent's own view of it takes the same side.
describe('which way an opening faces', () => {
  test('outward, in the site plan, whichever way its wall was drawn', () => {
    for (const outside of ['back', 'front'] as const) {
      expect(sceneViewFacing(facadeScene(outside), 'door_face')).toEqual([0, -1])
      expect(sceneViewFacing(facadeScene(outside), 'window_face')).toEqual([0, -1])
    }
  })

  test('turned with the building', () => {
    const facing = sceneViewFacing(
      facadeScene('back', { position: [5.7, 0, 16.5], rotation: [0, Math.PI / 2, 0] }),
      'door_face',
    )!
    expect(facing[0]).toBeCloseTo(-1, 9)
    expect(facing[1]).toBeCloseTo(0, 9)
  })

  test('nothing for what is not an opening', () => {
    expect(sceneViewFacing(facadeScene('back'), 'wall_face')).toBeNull()
    expect(sceneViewFacing(facadeScene('back'), 'item_lamp')).toBeNull()
    expect(sceneViewFacing(facadeScene('back'), 'nothing_here')).toBeNull()
  })
})
