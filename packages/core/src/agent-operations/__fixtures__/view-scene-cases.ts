import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SiteNode,
  WallNode,
} from '../../schema'
import type {
  SceneViewBox,
  SceneViewCurrentCamera,
  SceneViewInput,
  SceneViewLighting,
  SceneViewPose,
} from '../scene-view'

/**
 * `view_scene`'s case table: every view the house picture tool it replaces (`screenshot_3d`, a
 * street-relative picture of the finished house) was asked for, as the `view_scene` call that
 * covers it, run without a model by the core, MCP and chat runners. `was` is the call it replaces:
 * its every view, light and size, and the calls stored Pro threads made (`{}`, `street-left`,
 * `back-left` in daylight). The expected sides and boxes are worked by hand from each lot, not read
 * back from the planner.
 */

type Pt = [number, number]
type Surface = 'core' | 'mcp' | 'chat'

export type ViewSceneCase = {
  name: string
  was: string
  scene: () => Record<string, AnyNode>
  input: SceneViewInput
  /** The person's own view, for the hosts that have one (the chat). */
  currentCamera?: SceneViewCurrentCamera
  surfaces?: Surface[]
  expect:
    | { refusal: string }
    | {
        /** The plan direction (x, z) the eye stands in from what it looks at, within 2°. */
        eyeToward?: Pt
        /** The least angle above the horizon the eye looks down from, in degrees. */
        eyeAbove?: number
        /** A box every corner of which is in the picture. */
        frames?: SceneViewBox
        pose?: SceneViewPose
        size?: { w: number; h: number }
        /** The light the host renders in; absent for the scene's own. */
        lighting?: SceneViewLighting
      }
}

const H = Math.SQRT1_2

/** Links parents' children; the graph's roots are its sites, or its buildings with none. */
function scene(...nodes: AnyNode[]): Record<string, AnyNode> {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, { ...node }])) as Record<
    string,
    AnyNode & { children?: string[] }
  >
  for (const node of Object.values(byId)) {
    const parent = node.parentId ? byId[node.parentId] : undefined
    if (parent && Array.isArray(parent.children) && !parent.children.includes(node.id))
      parent.children = [...parent.children, node.id]
  }
  return byId
}

const LOT: Pt[] = [
  [0, 0],
  [30, 0],
  [30, 30],
  [0, 30],
]

/**
 * A two-storey house, 12 × 8 m and 2.7 m a storey, its hip roof (30°, 12 × 8 m) on a roof level
 * of its own, standing at `at` on a 30 m lot. Edge 1 of the lot runs from (30, 0) to (30, 30): the
 * east line. The roof peaks 4 tan 30° m over its 4 m half-span, on the 5.4 m of the two storeys.
 */
function house(
  site: Record<string, unknown> | null,
  {
    at = [9, 0, 11],
    yaw = 0,
    roof = 'core',
    suffix = '',
  }: {
    at?: [number, number, number]
    yaw?: number
    /** Core's hip roof, or Architect's roof planes (a plugin's nodes core cannot measure). */
    roof?: 'core' | 'planes'
    /** Ids of a second house in the same scene. */
    suffix?: string
  } = {},
): Record<string, AnyNode> {
  const lot = site && SiteNode.parse({ id: `site_lot${suffix}`, children: [], ...site })
  const building = BuildingNode.parse({
    id: `building_house${suffix}`,
    ...(lot ? { parentId: lot.id } : {}),
    children: [],
    position: at,
    rotation: [0, yaw, 0],
  })
  const storeys = [0, 1].map((index) =>
    LevelNode.parse({
      id: `level_${index}${suffix}`,
      parentId: building.id,
      level: index,
      height: 2.7,
      children: [],
    }),
  )
  const corners: Pt[] = [
    [0, 0],
    [12, 0],
    [12, 8],
    [0, 8],
  ]
  const walls = storeys.flatMap((level) =>
    corners.map((start, index) =>
      WallNode.parse({
        id: `wall_${level.id}_${index}`,
        parentId: level.id,
        start,
        end: corners[(index + 1) % 4]!,
      }),
    ),
  )
  const roofLevel = LevelNode.parse({
    id: `level_roof${suffix}`,
    parentId: building.id,
    level: 2,
    height: 3,
    children: [],
  })
  const segment = RoofSegmentNode.parse({
    id: `rseg_house${suffix}`,
    parentId: `roof_house${suffix}`,
    roofType: 'hip',
    width: 12,
    depth: 8,
    pitch: 30,
    wallHeight: 0,
  })
  const roofNodes: AnyNode[] =
    roof === 'core'
      ? [
          RoofNode.parse({
            id: `roof_house${suffix}`,
            parentId: roofLevel.id,
            position: [6, 0, 4],
            children: [segment.id],
          }),
          segment,
        ]
      : [
          {
            id: `roofplane_house${suffix}`,
            type: 'procedural:roof-plane',
            parentId: roofLevel.id,
            polygon: [
              [-0.5, -0.5],
              [12.5, -0.5],
              [12.5, 4],
              [-0.5, 4],
            ],
            baseline: [
              [-0.5, -0.5],
              [12.5, -0.5],
            ],
            baseHeight: 0,
            pitch: 12,
          } as unknown as AnyNode,
        ]
  return scene(...(lot ? [lot] : []), building, ...storeys, ...walls, roofLevel, ...roofNodes)
}

const PEAK = 5.4 + 4 * Math.tan(Math.PI / 6)

/** The house at (9, 0, 11), square to the lot: every storey and the roof. */
const WHOLE_HOUSE: SceneViewBox = { min: [9, 0, 11], max: [21, PEAK, 19] }

/** A lot whose recorded front is its east line. */
const eastFront = () => house({ polygon: { type: 'polygon', points: LOT }, frontEdge: 1 })

const STREET_SIDES: { from: SceneViewInput['from']; toward: Pt; words: string }[] = [
  { from: 'street', toward: [1, 0], words: 'straight at the front, from the street (east)' },
  {
    from: 'street-left',
    toward: [H, H],
    words: "the street viewer's left front corner: facing west from the street, the south-east",
  },
  { from: 'street-right', toward: [H, -H], words: 'the right front corner, the north-east' },
  { from: 'left', toward: [0, 1], words: "the street viewer's left side, the south" },
  { from: 'right', toward: [0, -1], words: 'the right side, the north' },
  { from: 'back', toward: [-1, 0], words: 'the back, away from the street: the west' },
  { from: 'back-left', toward: [-H, H], words: 'the back-left corner, the south-west' },
  { from: 'back-right', toward: [-H, -H], words: 'the back-right corner, the north-west' },
]

/** Two lots side by side, each with a house: the west lot's street is north, the east lot's east. */
function twoLots(): Record<string, AnyNode> {
  const west = house({ polygon: { type: 'polygon', points: LOT }, frontEdge: 0 })
  const east = house(
    {
      polygon: { type: 'polygon', points: LOT.map(([x, z]) => [x + 40, z]) },
      frontEdge: 1,
    },
    { at: [49, 0, 11], suffix: '_east' },
  )
  return { ...west, ...east }
}

const PERSON: SceneViewCurrentCamera = {
  position: [-6, 9, 30],
  target: [15, 2, 15],
  projection: 'perspective',
  fov: 50,
  viewWidth: 24,
  aspect: 16 / 9,
}

export const VIEW_SCENE_CASES: readonly ViewSceneCase[] = [
  {
    name: 'by default, every storey and the roof, whatever floor the person is on',
    was: "every screenshot_3d picture: the finished house, every storey and the roof (from view_scene's own default, the south-west; screenshot_3d {} was street-left, the next row)",
    scene: eastFront,
    input: {},
    expect: { eyeToward: [-H, H], frames: WHOLE_HOUSE },
  },
  ...STREET_SIDES.map(
    ({ from, toward, words }): ViewSceneCase => ({
      name: `${from}: ${words}, every storey and the roof in frame`,
      was:
        from === 'street-left'
          ? "screenshot_3d {} or { view: 'street-left' }, as stored Pro threads call it"
          : `screenshot_3d { view: '${from}' }`,
      scene: eastFront,
      input: { from },
      expect: { eyeToward: toward, frames: WHOLE_HOUSE },
    }),
  ),
  {
    name: 'an aerial view: the street-left corner, high',
    was: "screenshot_3d { view: 'aerial' }",
    scene: eastFront,
    input: { from: 'street-left', elevation: 40 },
    expect: { eyeToward: [H, H], eyeAbove: 39, frames: WHOLE_HOUSE },
  },
  {
    name: 'the house from above',
    was: "screenshot_3d { view: 'top' }",
    scene: eastFront,
    input: { from: 'above' },
    expect: { eyeAbove: 85, frames: WHOLE_HOUSE },
  },
  {
    name: 'a lot that records only its street edges takes the first as its street',
    was: "screenshot_3d { view: 'street' }",
    // Edge 2 runs from (30, 30) to (0, 30): the south line.
    scene: () => house({ polygon: { type: 'polygon', points: LOT }, streetEdges: [2] }),
    input: { from: 'street' },
    expect: { eyeToward: [0, 1], frames: WHOLE_HOUSE },
  },
  {
    name: 'a house turned on its lot is still seen from the street, not from its own front',
    was: "screenshot_3d { view: 'street' }",
    // A quarter turn at (15, 0, 15): its (x, z) lands at (15 + z, 15 - x), x 15 to 23, z 3 to 15.
    scene: () =>
      house(
        { polygon: { type: 'polygon', points: LOT }, frontEdge: 1 },
        { at: [15, 0, 15], yaw: Math.PI / 2 },
      ),
    input: { from: 'street' },
    expect: { eyeToward: [1, 0], frames: { min: [15, 0, 3], max: [23, PEAK, 15] } },
  },
  {
    name: "a roof of Architect's roof planes is framed to its roof level's top",
    was: "screenshot_3d {} over a roof drawn with create_roof_plane (it framed every level's top)",
    scene: () =>
      house({ polygon: { type: 'polygon', points: LOT }, frontEdge: 1 }, { roof: 'planes' }),
    input: { from: 'street' },
    // The roof level's 3 m over the two storeys' 5.4 m.
    expect: { eyeToward: [1, 0], frames: { min: [9, 0, 11], max: [21, 8.4, 19] } },
  },
  {
    name: 'an empty site beside the one the house stands on takes nothing from the view',
    was: "screenshot_3d { view: 'street' }",
    scene: () => ({
      ...house({ polygon: { type: 'polygon', points: LOT }, frontEdge: 1 }),
      site_empty: SiteNode.parse({ id: 'site_empty', children: [] }),
    }),
    input: { from: 'street' },
    expect: { eyeToward: [1, 0], frames: WHOLE_HOUSE },
  },
  {
    name: 'houses on two lots, each facing its own street, need the house as target',
    was: "screenshot_3d { view: 'street' } (it took the lowest storey it found)",
    scene: twoLots,
    input: { from: 'street' },
    expect: { refusal: 'which_building' },
  },
  {
    name: 'the house on the east lot, as target, is seen from its own street',
    was: "screenshot_3d { view: 'street' }",
    scene: twoLots,
    input: { from: 'street', target: 'building_house_east' },
    expect: { eyeToward: [1, 0], frames: { min: [49, 0, 11], max: [61, PEAK, 19] } },
  },
  {
    name: 'the house on the west lot, as target, is seen from its own street (north)',
    was: "screenshot_3d { view: 'street' }",
    scene: twoLots,
    input: { from: 'street', target: 'building_house' },
    expect: { eyeToward: [0, -1], frames: WHOLE_HOUSE },
  },
  {
    name: "a lot that records no street is seen from the house's own front (-z), as Architect's tools read it",
    was: "screenshot_3d { view: 'street' } on a lot with no street (Pro's placeholder lot)",
    scene: () => house({ polygon: { type: 'polygon', points: LOT } }),
    input: { from: 'street' },
    expect: { eyeToward: [0, -1], frames: WHOLE_HOUSE },
  },
  {
    name: "on a lot with no street, street-left is the left front corner of the house's own front: the north-east",
    was: 'screenshot_3d {} on a lot with no street',
    scene: () => house({ polygon: { type: 'polygon', points: LOT } }),
    input: { from: 'street-left' },
    expect: { eyeToward: [H, -H], frames: WHOLE_HOUSE },
  },
  {
    name: 'a house turned a quarter on a lot with no street is seen from its own front, the west',
    was: "screenshot_3d { view: 'street' } on a lot with no street",
    scene: () =>
      house({ polygon: { type: 'polygon', points: LOT } }, { at: [15, 0, 15], yaw: Math.PI / 2 }),
    input: { from: 'street' },
    expect: { eyeToward: [-1, 0], frames: { min: [15, 0, 3], max: [23, PEAK, 15] } },
  },
  {
    name: "a scene with no site is seen from the house's own front",
    was: 'screenshot_3d {} in a scene with no site',
    scene: () => house(null),
    input: { from: 'street-left' },
    expect: { eyeToward: [H, -H], frames: WHOLE_HOUSE },
  },
  {
    name: "inside a floor of the house on the east lot, the street is that house's own",
    was: "screenshot_3d { view: 'street' }, looking into a floor",
    scene: twoLots,
    input: { interior: { levelId: 'level_0_east' }, from: 'street' },
    expect: { eyeToward: [1, 0] },
  },
  {
    name: 'the back-left corner in daylight',
    was: "screenshot_3d { view: 'back-left', lighting: 'day' }, as a stored Pro thread calls it",
    scene: eastFront,
    input: { from: 'back-left', lighting: 'day' },
    expect: { eyeToward: [-H, H], frames: WHOLE_HOUSE, lighting: 'day' },
  },
  ...(['day', 'overcast', 'sunset', 'dusk', 'night'] as const).map(
    (lighting): ViewSceneCase => ({
      name: `in the ${lighting} light`,
      was: `screenshot_3d { lighting: '${lighting}' }`,
      scene: eastFront,
      input: { from: 'street', lighting },
      expect: { eyeToward: [1, 0], lighting },
    }),
  ),
  {
    name: "in the scene's own light",
    was: "screenshot_3d { lighting: 'current' }",
    scene: eastFront,
    input: { from: 'street', lighting: 'current' },
    expect: { eyeToward: [1, 0] },
  },
  {
    name: 'a thumbnail, 320 px on its longest side',
    was: 'screenshot_3d { maxPx: 320 } (a saved design’s thumbnail)',
    scene: eastFront,
    input: { from: 'street-left', maxPx: 320 },
    expect: { size: { w: 320, h: 200 }, frames: WHOLE_HOUSE },
  },
  {
    name: 'a picture 1600 px across',
    was: 'screenshot_3d { maxPx: 1600 } (its default)',
    scene: eastFront,
    input: { from: 'street-left', maxPx: 1600 },
    expect: { size: { w: 1600, h: 1000 } },
  },
  {
    name: 'the smallest picture, 64 px on its longest side',
    was: 'screenshot_3d { maxPx: 64 }',
    scene: eastFront,
    input: { from: 'street-left', maxPx: 64 },
    expect: { size: { w: 64, h: 40 } },
  },
  {
    name: 'the largest picture, 1920 px on its longest side',
    was: 'screenshot_3d { maxPx: 1920 }',
    scene: eastFront,
    input: { from: 'street-left', maxPx: 1920 },
    expect: { size: { w: 1920, h: 1200 } },
  },
  {
    name: 'a picture past 1920 px is refused: a vision model would scale it down',
    was: 'screenshot_3d { maxPx: 2048 }',
    scene: eastFront,
    input: { from: 'street-left', maxPx: 2048 },
    // The contract's schema refuses it before anything runs; the chat's model API does the same.
    surfaces: ['core'],
    expect: { refusal: 'invalid_input' },
  },
  {
    name: "the person's own view, at their canvas' aspect",
    was: "screenshot_3d { view: 'current' }",
    scene: eastFront,
    input: { camera: 'current' },
    currentCamera: PERSON,
    surfaces: ['core', 'chat'],
    expect: {
      pose: { projection: 'perspective', position: [-6, 9, 30], target: [15, 2, 15], fov: 50 },
      size: { w: 1920, h: 1080 },
    },
  },
  {
    name: "the person's own view through an orthographic camera stays orthographic",
    was: "screenshot_3d { view: 'current' }",
    scene: eastFront,
    input: { camera: 'current', maxPx: 960 },
    currentCamera: { ...PERSON, projection: 'orthographic' },
    surfaces: ['core', 'chat'],
    expect: {
      pose: {
        projection: 'orthographic',
        position: [-6, 9, 30],
        target: [15, 2, 15],
        viewWidth: 24,
      },
      size: { w: 960, h: 540 },
    },
  },
  {
    name: "the person's view on a tall, narrow canvas is 1920 px on its longest side",
    was: "screenshot_3d { view: 'current' } in a portrait window",
    scene: eastFront,
    input: { camera: 'current' },
    currentCamera: { ...PERSON, aspect: 0.6 },
    surfaces: ['core', 'chat'],
    expect: { size: { w: 1152, h: 1920 } },
  },
  {
    name: "the MCP has no view of the person's to look through",
    was: "screenshot_3d { view: 'current' }",
    scene: eastFront,
    input: { camera: 'current' },
    surfaces: ['mcp'],
    expect: { refusal: 'no_current_camera' },
  },
  {
    name: "the person's view and a side of the agent's own are refused together",
    was: "screenshot_3d { view: 'current' }",
    scene: eastFront,
    input: { camera: 'current', from: 'street' },
    currentCamera: PERSON,
    expect: { refusal: 'camera_and_viewpoint' },
  },
]

const DEG = 180 / Math.PI

/** What a planned view gets wrong against its case: the problems, if any. */
export function viewSceneCaseProblems(
  c: ViewSceneCase,
  plan: { pose: SceneViewPose; size: { w: number; h: number }; lighting?: SceneViewLighting },
): string[] {
  if ('refusal' in c.expect) return [`planned a view, expected the refusal ${c.expect.refusal}`]
  const { eyeToward, eyeAbove, frames, pose, size } = c.expect
  const problems: string[] = []
  const [ex, ey, ez] = plan.pose.position
  const [tx, ty, tz] = plan.pose.target
  const flat = Math.hypot(ex - tx, ez - tz)
  if (eyeToward) {
    const off = Math.acos(
      Math.min(1, ((ex - tx) * eyeToward[0] + (ez - tz) * eyeToward[1]) / (flat || 1)),
    )
    if (off * DEG > 2) problems.push(`the eye stands ${Math.round(off * DEG)}° off its side`)
  }
  if (eyeAbove !== undefined && Math.atan2(ey - ty, flat) * DEG < eyeAbove)
    problems.push(`the eye is ${Math.round(Math.atan2(ey - ty, flat) * DEG)}° up, not ${eyeAbove}`)
  if (frames && !framesBox(plan.pose, plan.size.w / plan.size.h, frames))
    problems.push('part of what it should frame is outside the picture')
  if (pose && JSON.stringify(plan.pose) !== JSON.stringify(pose))
    problems.push(`the pose is ${JSON.stringify(plan.pose)}`)
  if (size && (plan.size.w !== size.w || plan.size.h !== size.h))
    problems.push(`the picture is ${plan.size.w} × ${plan.size.h}`)
  if (plan.lighting !== c.expect.lighting) problems.push(`the light is ${plan.lighting ?? 'its own'}`)
  return problems
}

/** Every corner of the box in front of a perspective eye, inside its frame at `aspect`. */
function framesBox(pose: SceneViewPose, aspect: number, box: SceneViewBox): boolean {
  if (pose.projection !== 'perspective') return false
  const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  const unit = (a: number[]) => a.map((v) => v / (Math.hypot(...a) || 1))
  const cross = (a: number[], b: number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ]
  const forward = unit(sub(pose.target, pose.position))
  const right = unit(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)
  const half = Math.tan((pose.fov * Math.PI) / 360)
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) {
        const v = sub([x, y, z], pose.position)
        const depth = dot(v, forward)
        if (depth <= 0) return false
        if (Math.abs(dot(v, right) / depth) > half * aspect + 1e-9) return false
        if (Math.abs(dot(v, up) / depth) > half + 1e-9) return false
      }
  return true
}
