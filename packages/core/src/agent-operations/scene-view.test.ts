import { describe, expect, test } from 'bun:test'
import { PerspectiveCamera, Vector3 } from 'three'
import { isAgentRefusal } from '../agent-tools'
import { type AnyNode, BuildingNode, GuideNode, LevelNode, WallNode } from '../schema'
import {
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

// Hawkesbury run 2's builder had no view over the MCP and drew its own elevation from coordinates;
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
