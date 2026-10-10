import { BuildingNode, LevelNode, WallNode, WindowNode } from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * `merge_windows` (the owner, 8 October): two windows that already exist become one. On two walls
 * meeting at a corner, each reaching it within 0.30 m, they become one corner window (adopted, slid
 * to the corner, the glass fused, one sill); side by side on one wall with at most 0.30 m between
 * them and nothing between, one window spanning both. What goes wrong, written first: a window
 * recreated instead of adopted; the sides left on two sills; the second window's type or style
 * winning over the first's; a door, a window or an item between them swallowed; two windows that
 * are nowhere near each other joined anyway; a window already joined to another stolen.
 */

type WindowSpec = {
  id: string
  wall: string
  /** Centre along the wall (m). */
  x: number
  width: number
  /** Bottom edge (m); the height is `height`. */
  sill: number
  height: number
  extra?: Record<string, unknown>
}

const window = ({ id, wall, x, width, sill, height, extra }: WindowSpec) =>
  WindowNode.parse({
    id,
    parentId: wall,
    wallId: wall,
    position: [x, sill + height / 2, 0],
    width,
    height,
    ...extra,
  })

type WallSpec = { id: string; start: [number, number]; end: [number, number]; height?: number }

function scene(walls: WallSpec[], windows: WindowSpec[]): SceneGraph {
  const nodeWalls = walls.map((spec) =>
    WallNode.parse({
      id: spec.id,
      parentId: 'level_m',
      start: spec.start,
      end: spec.end,
      height: spec.height ?? 2.5,
      children: windows.filter((w) => w.wall === spec.id).map((w) => w.id),
    }),
  )
  const level = LevelNode.parse({
    id: 'level_m',
    parentId: 'building_m',
    children: nodeWalls.map((wall) => wall.id),
  })
  const building = BuildingNode.parse({ id: 'building_m', children: [level.id] })
  const nodes = [building, level, ...nodeWalls, ...windows.map(window)]
  return {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: [building.id],
  }
}

/** A 4 m wall running into the corner at the origin and a 3 m wall leaving it at `degrees`. */
const corner = (degrees: number, windows: WindowSpec[], height?: number) => {
  const rad = (degrees * Math.PI) / 180
  return scene(
    [
      { id: 'wall_ca', start: [4, 0], end: [0, 0] },
      {
        id: 'wall_cb',
        start: [0, 0],
        end: [3 * Math.cos(rad), 3 * Math.sin(rad)],
        ...(height === undefined ? {} : { height }),
      },
    ],
    windows,
  )
}

/** On wall_ca: 0.10 m short of the corner end (right edge at 3.9 m), sill 0.5, 1.5 m tall. */
const nearA: WindowSpec = { id: 'window_a', wall: 'wall_ca', x: 3.3, width: 1.2, sill: 0.5, height: 1.5 }
/** On wall_cb: 0.20 m short of the corner end (left edge at 0.2 m), sill 0.8, 1.2 m tall. */
const nearB: WindowSpec = { id: 'window_b', wall: 'wall_cb', x: 0.7, width: 1, sill: 0.8, height: 1.2 }

/** One 5 m wall: the first window 0.5-1.5 m, the second 1.7-2.7 m (0.20 m between), sills differ. */
const wall5: WallSpec = { id: 'wall_m', start: [0, 0], end: [5, 0] }
const left: WindowSpec = {
  id: 'window_l',
  wall: 'wall_m',
  x: 1,
  width: 1,
  sill: 0.5,
  height: 1.5,
  extra: { windowType: 'fixed' },
}
const right: WindowSpec = {
  id: 'window_r',
  wall: 'wall_m',
  x: 2.2,
  width: 1,
  sill: 0.9,
  height: 1.2,
  extra: { windowType: 'casement' },
}

const sillOf = (w: WindowNode) => w.position[1] - w.height / 2
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

export const MERGE_WINDOWS_CASES: AgentToolCase[] = [
  {
    name: 'two windows near a square corner become one corner window, adopted and slid to it',
    tool: 'merge_windows',
    scene: () => corner(90, [nearA, nearB]),
    input: { windowIds: ['window_a', 'window_b'] },
    expect: {
      result: {
        ok: true,
        kind: 'corner',
        windowIds: ['window_a', 'window_b'],
        removedIds: [],
        wallIds: ['wall_ca', 'wall_cb'],
        angle: 90,
      },
      after: {
        window_a: { corner: { end: 'end', partnerId: 'window_b', post: 'none' }, width: 1.2 },
        window_b: { corner: { end: 'start', partnerId: 'window_a', post: 'none' }, width: 1 },
      },
      check: (_result, nodes) => {
        const [a, b] = ['window_a', 'window_b'].map((id) => nodes[id] as WindowNode)
        return [
          ...(a && near(a.position[0], 4 - 0.6) ? [] : [`window_a at ${a?.position[0]}, not 3.4`]),
          ...(b && near(b.position[0], 0.5) ? [] : [`window_b at ${b?.position[0]}, not 0.5`]),
        ]
      },
    },
  },
  {
    name: "the second window takes the first's height, sill and type, and the answer says so",
    tool: 'merge_windows',
    scene: () => corner(90, [nearA, { ...nearB, extra: { windowType: 'casement' } }]),
    input: { windowIds: ['window_a', 'window_b'] },
    expect: {
      result: { ok: true, kind: 'corner', height: 1.5, sillHeight: 0.5 },
      mentions: ['window_a', 'height', 'sill'],
      check: (_result, nodes) => {
        const [a, b] = ['window_a', 'window_b'].map((id) => nodes[id] as WindowNode)
        return a && b && near(b.height, a.height) && near(sillOf(b), sillOf(a)) && b.windowType === a.windowType
          ? []
          : [`not aligned: ${JSON.stringify([b?.height, b && sillOf(b), b?.windowType])}`]
      },
    },
  },
  {
    name: "the first window named sets the sill: named the other way round, the other's wins",
    tool: 'merge_windows',
    scene: () => corner(90, [nearA, nearB]),
    input: { windowIds: ['window_b', 'window_a'] },
    expect: {
      result: { ok: true, kind: 'corner', height: 1.2, sillHeight: 0.8 },
    },
  },
  {
    name: "a bay's 135° corner joins like a square one",
    tool: 'merge_windows',
    scene: () => corner(135, [nearA, nearB]),
    input: { windowIds: ['window_a', 'window_b'] },
    expect: { result: { ok: true, kind: 'corner', angle: 135 } },
  },
  {
    name: 'two windows side by side on one wall become one spanning both outer edges',
    tool: 'merge_windows',
    scene: () => scene([wall5], [left, right]),
    input: { windowIds: ['window_l', 'window_r'] },
    expect: {
      result: {
        ok: true,
        kind: 'same_wall',
        windowIds: ['window_l'],
        removedIds: ['window_r'],
        wallIds: ['wall_m'],
        width: 2.2,
      },
      check: (_result, nodes) => {
        const merged = nodes.window_l as WindowNode | undefined
        return [
          ...(nodes.window_r ? ['window_r is still there'] : []),
          ...(merged &&
          near(merged.position[0], 1.6) &&
          near(merged.width, 2.2) &&
          near(sillOf(merged), 0.5) &&
          near(merged.position[1] + merged.height / 2, 2.1)
            ? []
            : [`merged window ${JSON.stringify([merged?.position, merged?.width, merged?.height])}`]),
          // The wall no longer lists the window that went.
          ...((nodes.wall_m as WallNode).children.includes('window_r')
            ? ['wall_m still lists window_r']
            : []),
        ]
      },
    },
  },
  {
    name: "the merged window keeps the first window's type; named the other way, the other's",
    tool: 'merge_windows',
    scene: () => scene([wall5], [left, right]),
    input: { windowIds: ['window_r', 'window_l'] },
    expect: {
      result: { ok: true, kind: 'same_wall', windowIds: ['window_r'], removedIds: ['window_l'] },
      after: { window_r: { windowType: 'casement' } },
    },
  },
  {
    name: 'windows more than 0.30 m apart on one wall are refused, with the gap',
    tool: 'merge_windows',
    scene: () => scene([wall5], [left, { ...right, x: 3.2 }]),
    input: { windowIds: ['window_l', 'window_r'] },
    expect: { refusal: 'windows_not_adjacent', mentions: ['1.20 m', '0.30 m'] },
  },
  {
    name: 'another window between them is refused, named',
    tool: 'merge_windows',
    scene: () =>
      scene(
        [wall5],
        [left, right, { id: 'window_s', wall: 'wall_m', x: 1.6, width: 0.2, sill: 0.9, height: 0.6 }],
      ),
    input: { windowIds: ['window_l', 'window_r'] },
    expect: { refusal: 'opening_between', mentions: ['window_s'] },
  },
  {
    name: 'windows on two walls that do not meet are refused',
    tool: 'merge_windows',
    scene: () =>
      scene(
        [
          { id: 'wall_p', start: [0, 0], end: [4, 0] },
          { id: 'wall_q', start: [0, 5], end: [4, 5] },
        ],
        [
          { id: 'window_a', wall: 'wall_p', x: 3.3, width: 1.2, sill: 0.5, height: 1.5 },
          { id: 'window_b', wall: 'wall_q', x: 0.7, width: 1, sill: 0.5, height: 1.5 },
        ],
      ),
    input: { windowIds: ['window_a', 'window_b'] },
    expect: { refusal: 'walls_not_meeting', mentions: ['wall_p', 'wall_q'] },
  },
  {
    name: 'a corner nearly straight is refused, pointing to the same-wall merge',
    tool: 'merge_windows',
    scene: () => corner(176, [nearA, nearB]),
    input: { windowIds: ['window_a', 'window_b'] },
    expect: { refusal: 'corner_angle', mentions: ['176'] },
  },
  {
    name: 'a window more than 0.30 m from the corner is refused, with how far',
    tool: 'merge_windows',
    scene: () => corner(90, [{ ...nearA, x: 2.9 }, nearB]),
    input: { windowIds: ['window_a', 'window_b'] },
    expect: { refusal: 'window_not_at_corner', mentions: ['window_a', '0.30 m'] },
  },
  {
    name: 'sliding to the corner onto another window is refused',
    tool: 'merge_windows',
    scene: () =>
      corner(90, [
        nearA,
        nearB,
        { id: 'window_s', wall: 'wall_ca', x: 3.95, width: 0.1, sill: 0.9, height: 0.6 },
      ]),
    input: { windowIds: ['window_a', 'window_b'] },
    expect: { refusal: 'opening_overlap', mentions: ['window_s'] },
  },
  {
    name: "a window taller than the other wall cannot be matched by it, and the wall is named",
    tool: 'merge_windows',
    scene: () => corner(90, [nearA, nearB], 1.8),
    input: { windowIds: ['window_a', 'window_b'] },
    expect: { refusal: 'height_exceeds_wall', mentions: ['wall_cb'] },
  },
  {
    name: 'a window already joined to another is not taken from it',
    tool: 'merge_windows',
    scene: () =>
      corner(90, [
        { ...nearA, extra: { corner: { end: 'end', partnerId: 'window_c', post: 'none' } } },
        nearB,
        {
          id: 'window_c',
          wall: 'wall_cb',
          x: 0.6,
          width: 1.2,
          sill: 0.5,
          height: 1.5,
          extra: { corner: { end: 'start', partnerId: 'window_a', post: 'none' } },
        },
      ]),
    input: { windowIds: ['window_a', 'window_b'] },
    expect: { refusal: 'window_already_joined', mentions: ['window_a', 'window_c'] },
  },
  {
    name: 'the same window twice is refused',
    tool: 'merge_windows',
    scene: () => corner(90, [nearA, nearB]),
    input: { windowIds: ['window_a', 'window_a'] },
    expect: { refusal: 'same_window' },
  },
  {
    name: 'a node that is not a window is refused, naming its kind',
    tool: 'merge_windows',
    scene: () => corner(90, [nearA, nearB]),
    input: { windowIds: ['window_a', 'wall_cb'] },
    expect: { refusal: 'not_a_window', mentions: ['wall'] },
  },
  {
    name: 'an unknown window is refused, named',
    tool: 'merge_windows',
    scene: () => corner(90, [nearA, nearB]),
    input: { windowIds: ['window_a', 'window_missing'] },
    expect: { refusal: 'window_not_found', mentions: ['window_missing'] },
  },
]
