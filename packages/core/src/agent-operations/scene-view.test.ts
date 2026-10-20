import { describe, expect, test } from 'bun:test'
import { PerspectiveCamera, Vector3 } from 'three'
import { z } from 'zod'
import { furnishRoomTool, isAgentRefusal, viewSceneTool } from '../agent-tools'
import hillside from '../lib/__fixtures__/owner-hillside-grade.json'
import { encodeTerrainField } from '../lib/terrain-codec'
import { createTerrainField } from '../lib/terrain-field'
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
  SiteNode,
  SlabNode,
  StairNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../schema'
import { VIEW_SCENE_CASES, viewSceneCaseProblems } from './__fixtures__/view-scene-cases'
import { pointInPolygon } from './plan-geometry'
import {
  photoCropSize,
  type SceneViewBox,
  sceneViewBounds,
  sceneViewFacing,
  sceneViewInterior,
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

test('level captures frame the settled Solo and Exploded geometry without changing the graph', () => {
  const nodes = building()
  const before = structuredClone(nodes)
  const solo = sceneViewPlan(nodes, { presentation: { mode: 'solo', levelId: 'level_1' } })
  expect(solo.presentation).toEqual({ mode: 'solo', levelId: 'level_1' })
  expect(solo).not.toHaveProperty('interior')
  expect(solo.pose.target[1]).toBe(4.5)
  const exploded = sceneViewPlan(nodes, { presentation: { mode: 'exploded' } })
  expect(framesBox(exploded.pose, { min: [0, 0, 0], max: [20, 11, 10] })).toBe(true)
  expect(exploded.pose.target[1]).toBe(5.5)
  expect(sceneViewBounds(nodes, 'wall_level_1_0', { mode: 'exploded' }).min[1]).toBe(8)
  expect(z.object(viewSceneTool.input).safeParse({ presentation: { mode: 'solo' } }).success).toBe(
    false,
  )
  expect(() =>
    sceneViewPlan(nodes, {
      presentation: { mode: 'solo', levelId: 'level_1' },
      target: 'wall_level_0_0',
    }),
  ).toThrow('The target must belong')
  expect(() =>
    sceneViewPlan(nodes, {
      presentation: { mode: 'solo', levelId: 'level_1' },
      target: 'item_missing',
    }),
  ).toThrow('The target is not in the scene')
  expect(() =>
    sceneViewPlan(nodes, {
      presentation: { mode: 'exploded' },
      interior: { levelId: 'level_0' },
    }),
  ).toThrow('Choose a level presentation')
  expect(() =>
    sceneViewPlan(nodes, {
      presentation: { mode: 'solo', levelId: 'level_missing' },
    }),
  ).toThrow('Solo needs an existing level')
  expect(() =>
    sceneViewPlan(
      { ...nodes, level_1: { ...nodes.level_1!, visible: false } },
      {
        presentation: { mode: 'solo', levelId: 'level_1' },
      },
    ),
  ).toThrow('Show the level')
  expect(nodes).toEqual(before)
})

test('capture framing includes retained roof extents beyond the occupied walls in every level presentation', () => {
  const nodes = building()
  const roof = ItemNode.parse({
    id: 'item_capture_roof',
    parentId: 'level_1',
    metadata: { role: 'roof' },
    position: [-10, 0, 0],
    asset: {
      id: 'retained',
      name: 'Roof',
      category: 'roof',
      thumbnail: '',
      src: '/roof.glb',
      dimensions: [10, 8, 10],
    },
  })
  nodes[roof.id] = roof
  const bounds = sceneViewBounds(nodes, 'level_1')
  expect(bounds.min[0]).toBe(-15)
  expect(bounds.max[1]).toBe(11)
  const exploded = sceneViewBounds(nodes, undefined, { mode: 'exploded' })
  expect(exploded.max[1]).toBe(16)
  const plan = sceneViewPlan(nodes, { presentation: { mode: 'solo', levelId: 'level_1' } })
  expect(framesBox(plan.pose, bounds)).toBe(true)
})

/** The two-storey house with a ceiling over the ground floor and a roof on the upper one. */
function finishedBuilding(): Record<string, AnyNode> {
  const nodes = building()
  const ceiling = CeilingNode.parse({
    id: 'ceiling_0',
    parentId: 'level_0',
    polygon: [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ],
  })
  const roof = RoofNode.parse({ id: 'roof_1', parentId: 'level_1' })
  const level = (id: string) => nodes[id] as LevelNode
  return {
    ...nodes,
    level_0: { ...level('level_0'), children: [...level('level_0').children, ceiling.id] },
    level_1: { ...level('level_1'), children: [...level('level_1').children, roof.id] },
    [ceiling.id]: ceiling,
    [roof.id]: roof,
  } as Record<string, AnyNode>
}

// Inside a floor the walls, the floors above and the ceilings hide the rooms: an interior view leaves
// the rest of the house out of the picture, for the picture only.
describe('a look inside one floor', () => {
  test('frames the floor from above, the other floors and its ceilings left out', () => {
    const nodes = finishedBuilding()
    const before = structuredClone(nodes)
    const inside = sceneViewInterior(nodes, 'level_0')
    expect(inside.bounds).toEqual({ min: [0, 0, 0], max: [20, 3, 10] })
    expect(inside.cutHeight).toBeCloseTo(1.95, 6)
    expect(inside.hiddenIds.sort()).toEqual(['ceiling_0', 'level_1'])

    const plan = sceneViewPlan(nodes, { interior: { levelId: 'level_0' } })
    expect(plan.interior).toEqual({ levelId: 'level_0' })
    expect(framesBox(plan.pose, inside.bounds)).toBe(true)
    // It looks down into the rooms over the cut walls.
    const [x, y, z] = plan.pose.position
    const [tx, ty, tz] = plan.pose.target
    expect(Math.atan2(y - ty, Math.hypot(x - tx, z - tz))).toBeCloseTo((55 * Math.PI) / 180, 2)
    expect(nodes).toEqual(before)
  })

  test('the upper floor is cut on its own storey, the ground floor and its roof left out', () => {
    const inside = sceneViewInterior(finishedBuilding(), 'level_1')
    expect([inside.bounds.min[1], inside.bounds.max[1]]).toEqual([3, 6])
    expect(inside.cutHeight).toBeCloseTo(4.95, 6)
    expect(inside.hiddenIds.sort()).toEqual(['level_0', 'roof_1'])
  })

  test('interior capture leaves out explicitly classified retained roofs, not similarly named objects', () => {
    const nodes = finishedBuilding()
    const asset = {
      id: 'retained',
      name: 'Retained geometry',
      category: 'roof',
      thumbnail: '',
      src: '/retained.glb',
      dimensions: [1, 1, 1],
    }
    const roof = ItemNode.parse({
      id: 'item_retained_roof',
      parentId: 'level_1',
      metadata: { role: 'roof' },
      asset,
    })
    const item = ItemNode.parse({
      id: 'item_roof_furniture',
      name: 'Roof terrace chair',
      parentId: 'level_1',
      asset,
    })
    nodes[roof.id] = roof
    nodes[item.id] = item
    const level = nodes.level_1 as LevelNode
    level.children.push(roof.id, item.id)
    const before = structuredClone(nodes)
    expect(sceneViewInterior(nodes, level.id).hiddenIds).toContain(roof.id)
    expect(sceneViewInterior(nodes, level.id).hiddenIds).not.toContain(item.id)
    expect(
      refusalOf(() => sceneViewPlan(nodes, { interior: { levelId: level.id }, target: roof.id })),
    ).toBe('interior_target_elsewhere')
    expect(nodes).toEqual(before)
  })

  test('a target in the floor frames it, and an eye given is kept', () => {
    const nodes = finishedBuilding()
    const wall = sceneViewPlan(nodes, {
      interior: { levelId: 'level_0' },
      target: 'wall_level_0_0',
    })
    expect(framesBox(wall.pose, sceneViewBounds(nodes, 'wall_level_0_0'))).toBe(true)
    const street = sceneViewPlan(nodes, { interior: { levelId: 'level_0' }, eyeHeight: 1.7 })
    expect(street.pose.position[1]).toBe(1.7)
    // The upper floor is left out of the picture: its wall would frame nothing shown.
    expect(
      refusalOf(() =>
        sceneViewPlan(nodes, { interior: { levelId: 'level_0' }, target: 'wall_level_1_0' }),
      ),
    ).toBe('interior_target_elsewhere')
  })

  test("the floor's roofs and ceilings are no target: the picture leaves them out", () => {
    const nodes = finishedBuilding()
    for (const [levelId, target] of [
      ['level_1', 'roof_1'],
      ['level_0', 'ceiling_0'],
    ] as const)
      expect(refusalOf(() => sceneViewPlan(nodes, { interior: { levelId }, target }))).toBe(
        'interior_target_elsewhere',
      )
  })

  test('a roof level has no inside, its roofs left out of the picture: the floor below has', () => {
    expect(refusalOf(() => sceneViewInterior(hipHouse(), 'level_roof'))).toBe(
      'interior_level_invalid',
    )
    expect(sceneViewInterior(hipHouse(), 'level_0').hiddenIds).toEqual(['level_roof'])
  })

  test("a photo's camera keeps its pose, and the floor is still checked", () => {
    const nodes = finishedBuilding()
    const camera = { position: [25, 14, 18], target: [10, 1, 5], fov: 53, aspect: 4 / 3 }
    const ordinary = sceneViewPlan(nodes, { camera })
    const interior = sceneViewPlan(nodes, { camera, interior: { levelId: 'level_0' } })
    expect(ordinary.interior).toBeUndefined()
    expect(interior.pose).toEqual(ordinary.pose)
    expect(interior.size).toEqual(ordinary.size)
    expect(interior.interior).toEqual({ levelId: 'level_0' })
    for (const levelId of ['level_missing', 'building_main', 'wall_level_0_0'])
      expect(refusalOf(() => sceneViewPlan(nodes, { camera, interior: { levelId } }))).toBe(
        'interior_level_invalid',
      )
  })

  test('a hidden floor, or a building tipped off the vertical, has no inside to show', () => {
    const nodes = finishedBuilding()
    const hidden = { ...nodes, level_0: { ...nodes.level_0!, visible: false } } as typeof nodes
    expect(refusalOf(() => sceneViewInterior(hidden, 'level_0'))).toBe('interior_hidden')
    const tipped = {
      ...nodes,
      building_main: { ...nodes.building_main!, rotation: [0.2, 0, 0] },
    } as typeof nodes
    expect(refusalOf(() => sceneViewInterior(tipped, 'level_0'))).toBe(
      'interior_transform_unsupported',
    )
  })

  test('a hidden site hides its ground only: the floors on it are still shown', () => {
    const nodes = finishedBuilding()
    const site = SiteNode.parse({ id: 'site_main', visible: false, children: ['building_main'] })
    const onHiddenSite = {
      ...nodes,
      [site.id]: site,
      building_main: { ...nodes.building_main!, parentId: site.id },
    } as typeof nodes
    expect(sceneViewInterior(onHiddenSite, 'level_0').bounds).toEqual(
      sceneViewInterior(nodes, 'level_0').bounds,
    )
  })

  test('a floor of a building away from the origin is cut where it stands', () => {
    const nodes = finishedBuilding()
    const moved = {
      ...nodes,
      building_main: { ...nodes.building_main!, position: [5.7, 0.5, 16.5] },
    } as typeof nodes
    const inside = sceneViewInterior(moved, 'level_0')
    expect(inside.bounds.min.map((v) => Math.round(v * 100) / 100)).toEqual([5.7, 0.5, 16.5])
    expect(inside.bounds.max.map((v) => Math.round(v * 100) / 100)).toEqual([25.7, 3.5, 26.5])
    expect(inside.cutHeight).toBeCloseTo(2.45, 6)
  })
})

/**
 * The two-storey house over a basement with the owner's villa numbers (13 Oct): the Lower Ground at
 * -3.63 m, 3.4 m tall, standing on a 0.28 m plate, so its floor lies 3.35 m under the lawn.
 */
function houseOverBasement(): Record<string, AnyNode> {
  const nodes = building()
  const corners: [number, number][] = [
    [0, 0],
    [20, 0],
    [20, 10],
    [0, 10],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_level_b_${index}`,
      parentId: 'level_b',
      start,
      end: corners[(index + 1) % corners.length],
    }),
  )
  const plate = SlabNode.parse({
    id: 'slab_b',
    parentId: 'level_b',
    polygon: corners,
    elevation: 0.28,
  })
  const basement = LevelNode.parse({
    id: 'level_b',
    parentId: 'building_main',
    level: -1,
    baseElevation: -3.63,
    height: 3.4,
    children: [...walls.map((wall) => wall.id), plate.id],
  })
  const house = nodes.building_main as BuildingNode
  return {
    ...nodes,
    building_main: { ...house, children: [basement.id, ...house.children] },
    ...Object.fromEntries([basement, plate, ...walls].map((node) => [node.id, node])),
  } as Record<string, AnyNode>
}

// From outside, the ground covers a floor below it: a picture of that floor looks inside it.
describe('a floor below grade', () => {
  test('targeted, it is looked into from above, the whole floor in frame', () => {
    const nodes = houseOverBasement()
    const plan = sceneViewPlan(nodes, { target: 'level_b' })
    expect(plan.interior).toEqual({ levelId: 'level_b' })
    expect(framesBox(plan.pose, sceneViewBounds(nodes, 'level_b'))).toBe(true)
    const [x, y, z] = plan.pose.position
    const [tx, ty, tz] = plan.pose.target
    expect(Math.atan2(y - ty, Math.hypot(x - tx, z - tz))).toBeCloseTo((55 * Math.PI) / 180, 2)
  })

  test('a floor at grade, targeted, is still seen from outside', () => {
    expect(sceneViewPlan(houseOverBasement(), { target: 'level_0' }).interior).toBeUndefined()
  })

  test("the picture's note says the ground over it is drawn as a veil", () => {
    const nodes = houseOverBasement()
    const { interior } = sceneViewPlan(nodes, { target: 'level_b' })
    expect(sceneViewNote(nodes, interior)).toContain('below grade')
    expect(sceneViewNote(nodes, { levelId: 'level_0' })).not.toContain('below grade')
    expect(sceneViewNote(nodes)).not.toContain('below grade')
  })

  test('the note states the fact of ground between the viewpoint and the hillside house', () => {
    // The owner's hillside house (14 Oct): a 6 m plateau on the street side (-z), the pad
    // under the house flat at 0 — no floor buried, the hill in the way from the street.
    const nodes = hillside.nodes as unknown as Record<string, AnyNode>
    const fromStreet = sceneViewNote(nodes, undefined, {
      projection: 'perspective',
      position: [0, 7, -20],
      target: [0, 1, 0],
      fov: 45,
    })
    expect(fromStreet).toContain('Ground stands between this viewpoint and the building')
    const fromGarden = sceneViewNote(nodes, undefined, {
      projection: 'perspective',
      position: [0, 3, 20],
      target: [0, 1, 0],
      fov: 45,
    })
    expect(fromGarden).not.toContain('Ground stands between')
  })

  test('a floor partly below grade: the note states the standing, and a veil only where the viewpoint is blocked', () => {
    // The review's plate (14 Oct): [-5,5] × [-4,4] at Y 0.2, terrain 2 m only inside
    // x 0…4, z -3…3, one wall along its south edge so the floor frames.
    const field = createTerrainField({ cols: 25, rows: 25, spacing: 1, origin: [-12, -12] })
    const heights = new Int16Array(field.heights)
    for (let row = 0; row < field.rows; row += 1)
      for (let col = 0; col < field.cols; col += 1) {
        const x = field.origin[0] + col * field.spacing
        const z = field.origin[1] + row * field.spacing
        if (x >= 0 && x <= 4 && z >= -3 && z <= 3) heights[row * field.cols + col] = 200
      }
    const list: AnyNode[] = [
      SiteNode.parse({
        id: 'site_a',
        children: ['building_a'],
        terrain: encodeTerrainField({ ...field, heights }),
      }),
      BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: ['level_0'] }),
      LevelNode.parse({
        id: 'level_0',
        level: 0,
        height: 3,
        parentId: 'building_a',
        children: ['slab_0', 'wall_0'],
      }),
      SlabNode.parse({
        id: 'slab_0',
        parentId: 'level_0',
        elevation: 0.2,
        polygon: [
          [-5, -4],
          [5, -4],
          [5, 4],
          [-5, 4],
        ],
      }),
      WallNode.parse({ id: 'wall_0', parentId: 'level_0', start: [-5, -4], end: [5, -4] }),
    ]
    const nodes = Object.fromEntries(list.map((node) => [node.id, node])) as Record<string, AnyNode>
    // Targeted, it keeps its outside view: only a floor buried everywhere is looked into.
    expect(sceneViewPlan(nodes, { target: 'level_0' }).interior).toBeUndefined()
    const interior = { levelId: 'level_0' }
    const overhead = {
      projection: 'perspective',
      position: [0, 15, 0],
      target: [0, 0, 0],
      fov: 45,
    } as const
    const note = sceneViewNote(nodes, interior, overhead)
    expect(note).toContain('The floor lies partly below grade: the ground stands over part of it.')
    expect(note).toContain('Ground stands between this viewpoint and the building')
    // Without a viewpoint the note makes no veil claim it cannot back.
    expect(sceneViewNote(nodes, interior)).not.toContain('faint veil')
  })
})

function refusalOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return undefined
}

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

// Both hosts return a crop at most 1920 px long, as a view is (the hosted one capped, the chat's
// did not: a whole 4000-px photo as the region went to the model at full size).
describe("a crop's size", () => {
  test('kept below 1920 px on its longer side', () => {
    expect(photoCropSize(4000, 3000)).toEqual({ width: 1920, height: 1440 })
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

/** A 10 x 8 m house on a 2.45 m storey under a 22.5 degree hip roof, on a roof level of its own. */
function hipHouse({ rotation = 0 }: { rotation?: number } = {}): Record<string, AnyNode> {
  const corners: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: 'level_0',
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
    parentId: 'level_roof',
    position: [5, 0, 4],
    rotation,
    children: [segment.id],
  })
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_main', children: ['level_0', 'level_roof'] }),
    LevelNode.parse({
      id: 'level_0',
      parentId: 'building_main',
      level: 0,
      height: 2.45,
      children: walls.map((wall) => wall.id),
    }),
    LevelNode.parse({ id: 'level_roof', parentId: 'building_main', level: 1, children: [roof.id] }),
    ...walls,
    roof,
    segment,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

// A roof on a roof level of its own holds no wall: a look at it, or at its level, framed nothing.
describe('a close-up of a roof', () => {
  const r = (v: number) => Math.round(v * 100) / 100

  test('a roof, and the level it is on, frame its footprint from its seat to its peak', () => {
    for (const target of ['roof_main', 'level_roof']) {
      const box = sceneViewBounds(hipHouse(), target)
      // 10 × 8 m about (5, 4), seated on the 2.45 m storey; a 22.5° hip over the 4 m half-span.
      expect([r(box.min[0]), r(box.max[0]), r(box.min[2]), r(box.max[2])]).toEqual([0, 10, 0, 8])
      expect(r(box.min[1])).toBe(2.45)
      expect(box.max[1]).toBeGreaterThan(3.5)
    }
  })

  test('a turned roof frames the footprint it covers in the plan', () => {
    const box = sceneViewBounds(hipHouse({ rotation: Math.PI / 2 }), 'roof_main')
    // A quarter turn about its centre swaps the half-extents: 8 m east-west, 10 m north-south.
    expect([r(box.max[0] - box.min[0]), r(box.max[2] - box.min[2])]).toEqual([8, 10])
  })

  test('the building frames its walls and the roof on its roof level, up to the peak', () => {
    for (const target of ['building_main', undefined]) {
      const box = sceneViewBounds(hipHouse(), target)
      // The 2.45 m storey, then the 22.5° hip rising 4 tan(22.5°) m over its 4 m half-span.
      expect([r(box.min[1]), r(box.max[1])]).toEqual([0, r(2.45 + 4 * Math.tan(Math.PI / 8))])
      expect([r(box.min[0]), r(box.max[0]), r(box.min[2]), r(box.max[2])]).toEqual([0, 10, 0, 8])
    }
  })

  test('the picture is taken from outside the roof, centred on it', () => {
    const { pose } = sceneViewPlan(hipHouse(), {
      target: 'roof_main',
      from: 'south-west',
      elevation: 35,
    })
    expect(pose.target[0]).toBeCloseTo(5, 1)
    expect(pose.target[2]).toBeCloseTo(4, 1)
    expect(pose.position[1]).toBeGreaterThan(pose.target[1])
  })
})

// Everything under a building is drawn in that building's frame, and the views were planned in it
// unmoved: a window of a building standing at (5.7, 16.5) as target framed bare ground beside it.
describe('a building away from the origin', () => {
  const at: [number, number, number] = [5.7, 0, 16.5]
  const placed = () => facadeScene('back', { position: at })
  const r = (v: number) => Math.round(v * 100) / 100
  const rounded = (box: SceneViewBox) => ({ min: box.min.map(r), max: box.max.map(r) })
  const moved = (box: SceneViewBox): SceneViewBox => ({
    min: [box.min[0] + at[0], box.min[1] + at[1], box.min[2] + at[2]],
    max: [box.max[0] + at[0], box.max[1] + at[1], box.max[2] + at[2]],
  })

  test('every target frames where it stands: its box at the origin, moved with the building', () => {
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
    expect(framesBox(pose, window)).toBe(true)
    // The wall is drawn so its outside is the north (-z) side, as it was at the origin.
    expect(pose.position[2]).toBeLessThan(window.min[2])
  })

  test('a turned building turns its boxes and the side an opening is seen from', () => {
    const turned = facadeScene('back', { position: at, rotation: [0, Math.PI / 2, 0] })
    const local = sceneViewBounds(facadeScene('back'), 'window_face')
    const centre = (box: SceneViewBox) =>
      [0, 1, 2].map((axis) => (box.min[axis]! + box.max[axis]!) / 2) as [number, number, number]
    const [lx, ly, lz] = centre(local)
    // A quarter turn about the building's origin: local (x, z) lands at (z, -x) on the site.
    const box = sceneViewBounds(turned, 'window_face')
    expect(centre(box).map(r)).toEqual([at[0] + lz, ly, at[2] - lx].map(r))
    // Its outside was north (-z) in the building's frame: after the turn, west (-x) on the site.
    const { pose } = sceneViewPlan(turned, { target: 'window_face' })
    expect(framesBox(pose, box)).toBe(true)
    expect(pose.position[0]).toBeLessThan(box.min[0])
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

  test('a wall with an exterior face faces the way that face does, whichever way it was drawn', () => {
    for (const outside of ['back', 'front'] as const)
      expect(sceneViewFacing(facadeScene(outside), 'wall_face')).toEqual([0, -1])
  })

  test('nothing for a wall with no exterior face, or for what is not an opening or a wall', () => {
    const scene = facadeScene('back')
    const wall = scene.wall_face as WallNode
    const interior = { ...scene, wall_face: { ...wall, backSide: 'interior' } } as typeof scene
    expect(sceneViewFacing(interior, 'wall_face')).toBeNull()
    expect(sceneViewFacing(scene, 'item_lamp')).toBeNull()
    expect(sceneViewFacing(scene, 'nothing_here')).toBeNull()
  })
})

// The case table of view_scene (__fixtures__/view-scene-cases.ts), as core plans it: the MCP and the
// chat run the same table through their own runners.
describe('the case table', () => {
  const contract = z.object(viewSceneTool.input)
  for (const c of VIEW_SCENE_CASES) {
    if (c.surfaces && !c.surfaces.includes('core')) continue
    test(c.name, () => {
      // What the contract's schema refuses never reaches the planner, on any surface.
      const valid = contract.safeParse(c.input).success
      const plan = () => sceneViewPlan(c.scene(), c.input, { currentCamera: c.currentCamera })
      if ('refusal' in c.expect)
        expect(valid ? refusalOf(plan) : 'invalid_input').toBe(c.expect.refusal)
      else {
        expect(valid).toBe(true)
        expect(viewSceneCaseProblems(c, plan())).toEqual([])
      }
    })
  }
})

// The study of 15 Oct: no interior view in 4 of 4 turns, and the model said it could not see
// inside. interior {zoneId} puts the eye in a room at a person's height, looking across it.
describe('a look from inside a room', () => {
  type Poly = [number, number][]
  const room = (id: string, polygon: Poly, levelId = 'level_0', holes: Poly[] = []) =>
    ZoneNode.parse({ id, parentId: levelId, name: `Room ${id}`, polygon, holes })
  const withRooms = (zones: ZoneNode[], base = finishedBuilding()) => {
    const nodes = { ...base } as Record<string, AnyNode>
    for (const zone of zones) {
      nodes[zone.id] = zone
      const level = nodes[zone.parentId!] as LevelNode
      nodes[level.id] = { ...level, children: [...level.children, zone.id] } as AnyNode
    }
    return nodes
  }
  const rect = (x0: number, z0: number, x1: number, z1: number): Poly => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  const L: Poly = [
    [0, 0],
    [8, 0],
    [8, 3],
    [3, 3],
    [3, 9],
    [0, 9],
  ]
  const standsIn = (pose: ReturnType<typeof sceneViewPose>, polygon: Poly) =>
    pointInPolygon([pose.position[0], pose.position[2]], polygon, false)

  const SHAPES: [string, Poly][] = [
    ['a bedroom', rect(1, 1, 5, 5)],
    ['a long corridor', rect(0.2, 0.2, 1.4, 7)],
    ['an L-shaped living room', L],
    ['a small bathroom', rect(8, 1, 9.6, 2.5)],
    ['a room with a pillar-sized hole in its middle', rect(10, 1, 16, 7)],
  ]

  for (const [name, polygon] of SHAPES) {
    test(`the camera stands inside ${name}, at eye height, looking across it`, () => {
      const hole: Poly = [
        [12.8, 3.8],
        [13.2, 3.8],
        [13.2, 4.2],
        [12.8, 4.2],
      ]
      const holes = name.includes('hole') ? [hole] : []
      const nodes = withRooms([room('zone_a', polygon, 'level_0', holes)])
      const before = structuredClone(nodes)
      const plan = sceneViewPlan(nodes, { interior: { zoneId: 'zone_a' } })
      expect(plan.interior).toEqual({ levelId: 'level_0', roomId: 'zone_a' })
      expect(plan.pose.projection).toBe('perspective')
      expect(standsIn(plan.pose, polygon)).toBe(true)
      for (const h of holes) expect(standsIn(plan.pose, h)).toBe(false)
      expect(plan.pose.position[1]).toBe(1.6)
      // It looks at the room, across it, and not at the floor under its feet.
      expect(standsIn({ ...plan.pose, position: plan.pose.target }, polygon)).toBe(true)
      const [dx, dz] = [
        plan.pose.target[0] - plan.pose.position[0],
        plan.pose.target[2] - plan.pose.position[2],
      ]
      // A gentle look across, under 25 degrees down, not at the floor a step away.
      const pitch = Math.atan2(plan.pose.position[1] - plan.pose.target[1], Math.hypot(dx, dz))
      expect(pitch).toBeLessThan((25 * Math.PI) / 180)
      expect(plan.pose.target[1]).toBeLessThan(plan.pose.position[1])
      expect(plan.pose).toMatchObject({ fov: 75 })
      expect(plan.size).toEqual({ w: VIEW_SIZE.w, h: VIEW_SIZE.h })
      expect(nodes).toEqual(before)
    })
  }

  test('the eye is a step in from the walls, never in one', () => {
    const polygon = rect(1, 1, 5, 5)
    const { pose } = sceneViewPlan(withRooms([room('zone_a', polygon)]), {
      interior: { zoneId: 'zone_a' },
    })
    const nearest = Math.min(
      pose.position[0] - 1,
      5 - pose.position[0],
      pose.position[2] - 1,
      5 - pose.position[2],
    )
    expect(nearest).toBeGreaterThanOrEqual(0.25)
  })

  test('a room on the upper floor is stood in at that floor, its own storey cut', () => {
    const nodes = withRooms([room('zone_up', rect(2, 2, 7, 6), 'level_1')])
    const plan = sceneViewPlan(nodes, { interior: { zoneId: 'zone_up' } })
    expect(plan.interior).toEqual({ levelId: 'level_1', roomId: 'zone_up' })
    expect(plan.pose.position[1]).toBeCloseTo(3 + 1.6, 6)
    expect(standsIn(plan.pose, rect(2, 2, 7, 6))).toBe(true)
  })

  test('a building away from the origin and turned is stood in where it stands', () => {
    const base = finishedBuilding()
    const building = base.building_main as BuildingNode
    const turned = {
      ...base,
      building_main: { ...building, position: [30, 0, -12], rotation: [0, Math.PI / 2, 0] },
    } as Record<string, AnyNode>
    const nodes = withRooms([room('zone_a', rect(1, 1, 5, 5))], turned)
    const { pose } = sceneViewPlan(nodes, { interior: { zoneId: 'zone_a' } })
    // The building's frame turned a quarter about its origin, then moved: (x, z) → (30 + z, -12 - x).
    const onSite = rect(1, 1, 5, 5).map(([x, z]) => [30 + z, -12 - x]) as Poly
    expect(standsIn(pose, onSite)).toBe(true)
  })

  test('eyeHeight, fov and the side the eye stands on are the agent’s', () => {
    const polygon = rect(1, 1, 9, 5)
    const nodes = withRooms([room('zone_a', polygon)])
    const sat = sceneViewPlan(nodes, { interior: { zoneId: 'zone_a' }, eyeHeight: 1.1, fov: 60 })
    expect(sat.pose).toMatchObject({ fov: 60 })
    expect(sat.pose.position[1]).toBe(1.1)
    const west = sceneViewPlan(nodes, { interior: { zoneId: 'zone_a' }, from: 'west' }).pose
    const east = sceneViewPlan(nodes, { interior: { zoneId: 'zone_a' }, from: 'east' }).pose
    expect(west.position[0]).toBeLessThan(5)
    expect(east.position[0]).toBeGreaterThan(5)
    expect(standsIn(west, polygon) && standsIn(east, polygon)).toBe(true)
  })

  test('a target in the room is what the eye looks at', () => {
    const polygon = rect(1, 1, 9, 5)
    const sofa = ItemNode.parse({
      id: 'item_sofa',
      parentId: 'level_0',
      name: 'Sofa',
      position: [8, 0, 3],
      asset: {
        id: 'sofa',
        category: 'furniture',
        name: 'Sofa',
        thumbnail: '',
        src: '/items/sofa/model.glb',
        dimensions: [2, 0.8, 0.9],
      },
    })
    const base = withRooms([room('zone_a', polygon)])
    const nodes = {
      ...base,
      item_sofa: sofa,
      level_0: {
        ...(base.level_0 as LevelNode),
        children: [...(base.level_0 as LevelNode).children, 'item_sofa'],
      },
    } as Record<string, AnyNode>
    const { pose } = sceneViewPlan(nodes, { interior: { zoneId: 'zone_a' }, target: 'item_sofa' })
    expect(pose.target[0]).toBeCloseTo(8, 1)
    expect(pose.target[2]).toBeCloseTo(3, 1)
    expect(standsIn(pose, polygon)).toBe(true)
    expect(pose.position[0]).toBeLessThan(5)
  })

  test('an eye put (position), lifted (elevation, above) or square on (orthographic) is outside, over the cut room', () => {
    const nodes = withRooms([room('zone_a', rect(1, 1, 5, 5))])
    const placed = sceneViewPlan(nodes, { interior: { zoneId: 'zone_a' }, position: [12, 4, 12] })
    expect(placed.pose.position).toEqual([12, 4, 12])
    expect(placed.interior).toEqual({ levelId: 'level_0', roomId: 'zone_a' })
    for (const input of [
      { elevation: 50 },
      { from: 'above' as const },
      { projection: 'orthographic' as const },
    ]) {
      const { pose } = sceneViewPlan(nodes, { interior: { zoneId: 'zone_a' }, ...input })
      // Over the room, not in it: above its walls' height, or off to one side.
      expect(standsIn(pose, rect(1, 1, 5, 5)) && pose.position[1] <= 3).toBe(false)
      // Framed on the room, not on the whole floor of 20 × 10 m.
      expect(Math.abs(pose.target[0] - 3)).toBeLessThan(0.01)
      expect(Math.abs(pose.target[2] - 3)).toBeLessThan(0.01)
    }
  })

  test('it is refused when the room is not one, or the request is neither a floor nor a room', () => {
    const nodes = withRooms([room('zone_a', rect(1, 1, 5, 5))])
    const refusal = (interior: Record<string, string>) =>
      refusalOf(() => sceneViewPlan(nodes, { interior }))
    expect(refusal({})).toBe('interior_one_of')
    expect(refusal({ levelId: 'level_0', zoneId: 'zone_a' })).toBe('interior_one_of')
    expect(refusal({ zoneId: 'wall_level_0_0' })).toBe('interior_room_invalid')
    expect(refusal({ zoneId: 'zone_missing' })).toBe('interior_room_invalid')
    const hidden = {
      ...nodes,
      building_main: { ...nodes.building_main!, visible: false },
    } as Record<string, AnyNode>
    expect(refusalOf(() => sceneViewPlan(hidden, { interior: { zoneId: 'zone_a' } }))).toBe(
      'interior_hidden',
    )
  })

  test('the picture says the eye is inside the room, and not when it is outside', () => {
    const nodes = withRooms([room('zone_a', rect(1, 1, 5, 5))])
    const inside = sceneViewPlan(nodes, { interior: { zoneId: 'zone_a' } })
    const note = sceneViewNote(nodes, inside.interior, inside.pose)
    expect(note).toContain('The eye stands inside Room zone_a')
    expect(note).toContain('0.65')
    const above = sceneViewPlan(nodes, { interior: { zoneId: 'zone_a' }, from: 'above' })
    expect(sceneViewNote(nodes, above.interior, above.pose)).not.toContain('The eye stands inside')
    const floor = sceneViewPlan(nodes, { interior: { levelId: 'level_0' } })
    expect(sceneViewNote(nodes, floor.interior, floor.pose)).not.toContain('The eye stands inside')
  })

  test('the contract takes a zone id beside a level id, and the tools say so', () => {
    const contract = z.object(viewSceneTool.input)
    expect(contract.safeParse({ interior: { zoneId: 'zone_a' } }).success).toBe(true)
    expect(contract.safeParse({ interior: { levelId: 'level_0' } }).success).toBe(true)
    expect(viewSceneTool.description).toContain('interior {zoneId}')
    expect(furnishRoomTool.description).toContain('view_scene with interior { zoneId }')
  })
})
