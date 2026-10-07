import { describe, expect, test } from 'bun:test'
import { PerspectiveCamera, Vector3 } from 'three'
import { isAgentRefusal } from '../agent-tools'
import {
  type AnyNode,
  BuildingNode,
  ColumnNode,
  DoorNode,
  FenceNode,
  GuideNode,
  ItemNode,
  LevelNode,
  SlabNode,
  StairNode,
  WallNode,
  WindowNode,
} from '../schema'
import {
  photoCropSize,
  type SceneViewBox,
  sceneViewBounds,
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

describe('the note a view comes with', () => {
  test('says a view is a picture to compare, not a measure', () => {
    expect(sceneViewNote()).toContain('not a measure')
  })
})

// An agent that compared whole facades only settled for a plain door against the photo's door
// with three glass strips. A view frames one opening or item at detail scale, an opening from its
// outside face, so it can be laid beside the photo's crop of the same element.
describe('a close-up of one element', () => {
  /** A 10 m wall along x drawn so its outside is the north (-z) side, a door and a window in it. */
  function facade(outside: 'front' | 'back') {
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
    const building = BuildingNode.parse({ id: 'building_face', children: [level.id] })
    return Object.fromEntries(
      [building, level, wall, door, window, lamp].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
  }

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
