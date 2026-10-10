import { BuildingNode, LevelNode, WallNode, type WindowNode } from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * `add_corner_window` (L65): the 290's Bed 4 window wraps the corner of its bay; run 4 built one
 * window on one face and recorded it built. What goes wrong, written first: the two sides not
 * joined or not reaching the corner; a bay's 135° refused or squared; a side wider than its wall,
 * a point no two walls meet at, or a corner too shallow to be one, built anyway.
 */

/** Wall A runs into the corner at the origin; wall B leaves it at `degrees` from A. */
function cornerScene(degrees: number): SceneGraph {
  const rad = (degrees * Math.PI) / 180
  const a = WallNode.parse({ id: 'wall_ca', parentId: 'level_c', start: [4, 0], end: [0, 0] })
  const b = WallNode.parse({
    id: 'wall_cb',
    parentId: 'level_c',
    start: [0, 0],
    end: [3 * Math.cos(rad), 3 * Math.sin(rad)],
  })
  const level = LevelNode.parse({ id: 'level_c', parentId: 'building_c', children: [a.id, b.id] })
  const building = BuildingNode.parse({ id: 'building_c', children: [level.id] })
  const nodes = [building, level, a, b]
  return {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: [building.id],
  }
}

const joined = (result: Record<string, unknown>, nodes: Readonly<Record<string, unknown>>) => {
  const windows = (result.windowIds as string[]).map((id) => nodes[id] as WindowNode | undefined)
  const [a, b] = windows
  return a?.corner?.partnerId === b?.id && b?.corner?.partnerId === a?.id
    ? []
    : [`not joined: ${JSON.stringify(windows.map((w) => w?.corner))}`]
}

export const CORNER_WINDOW_CASES: AgentToolCase[] = [
  {
    name: 'two windows run to a square corner, joined, the glass fused',
    tool: 'add_corner_window',
    scene: () => cornerScene(90),
    input: { corner: [0, 0], width: 1.2 },
    expect: { result: { ok: true, wallIds: ['wall_ca', 'wall_cb'], post: 'none' }, check: joined },
  },
  {
    name: "a bay's 135° corner, a side of its own width, with a post",
    tool: 'add_corner_window',
    scene: () => cornerScene(135),
    input: { corner: [0, 0], width: 1.2, widths: { wall_cb: 0.9 }, post: 'post' },
    expect: {
      result: { ok: true, angle: 135, post: 'post' },
      check: (result, nodes) => {
        const sides = (result.windowIds as string[]).map((id) => nodes[id] as WindowNode)
        const onB = sides.find((window) => window.parentId === 'wall_cb')
        return [
          ...joined(result, nodes),
          ...(onB?.width === 0.9 ? [] : [`wall_cb side ${onB?.width} m`]),
        ]
      },
    },
  },
  {
    name: 'a point where no two walls meet is refused',
    tool: 'add_corner_window',
    scene: () => cornerScene(90),
    input: { corner: [2, 0], width: 1 },
    expect: { refusal: 'no_corner', mentions: ['get_walls'] },
  },
  {
    name: 'a corner nearly straight is refused, pointing to add_window',
    tool: 'add_corner_window',
    scene: () => cornerScene(176),
    input: { corner: [0, 0], width: 1 },
    expect: { refusal: 'corner_angle', mentions: ['add_window'] },
  },
  {
    name: 'a side wider than its wall is refused, naming the wall',
    tool: 'add_corner_window',
    scene: () => cornerScene(90),
    input: { corner: [0, 0], width: 3.5 },
    expect: { refusal: 'width_exceeds_wall', mentions: ['wall_cb'] },
  },
  {
    name: 'a style on a sliding corner window is refused and nothing is written',
    tool: 'add_corner_window',
    scene: () => cornerScene(90),
    input: { corner: [0, 0], width: 1, windowType: 'sliding', style: 'double-hung' },
    expect: { refusal: 'style_needs_fixed_window', mentions: ["'fixed'", 'sliding'] },
  },
]
