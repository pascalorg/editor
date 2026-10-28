import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BeamNode,
  BuildingNode,
  ColumnNode,
  createFramingPost,
  type FloorplanGeometry,
  type GeometryContext,
  LevelNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { buildColumnFloorplan } from './floorplan'
import { columnPlaceOption, postBaseOption } from './post-options'
import {
  armFramingPostTool,
  framingPostAt,
  framingPostsUnderBeam,
  framingPostToolChoices,
  framingPostToolDefaults,
  postSnapTargets,
  snapPostPoint,
} from './post-placement'
import { framingPostFit, framingPostSizePatch } from './post-section'

const IN = 0.0254
type Nodes = Record<AnyNodeId, AnyNode>
const previous = useEditor.getState()

afterEach(() => {
  useEditor.setState(previous, true)
})

/** A header 6x8 over a porch's front, 8 ft of it, its top at the 2.7 m plane. */
const HEADER = BeamNode.parse({
  id: 'beam_h',
  parentId: 'level_g',
  start: [0, 0],
  end: [4.8768, 0],
  width: 5.5 * IN,
  depth: 7.5 * IN,
})

function storey(extra: AnyNode[] = []): Nodes {
  return Object.fromEntries(
    [
      BuildingNode.parse({ id: 'building_a', children: ['level_g'] }),
      LevelNode.parse({
        id: 'level_g',
        parentId: 'building_a',
        level: 0,
        height: 2.7,
        children: [HEADER.id, ...extra.map((node) => node.id)],
      }),
      HEADER,
      ...extra,
    ].map((node) => [node.id, node]),
  ) as Nodes
}

/** Every post stands on the floor plane here: what the floor stacking elects in the editor. */
const onFloor = (post: ColumnNode) => post.position[1]

describe('the Post tool', () => {
  test('is the column tool armed with a framing post, at the size and base picked', () => {
    expect(framingPostToolChoices(null)).toBeNull()
    expect(framingPostToolChoices({ thickness: 1 })).toBeNull()
    expect(framingPostToolChoices(framingPostToolDefaults('8x8', 'pier'))).toEqual({
      size: '8x8',
      base: 'pier',
    })
    armFramingPostTool('4x4')
    const editor = useEditor.getState()
    expect(editor).toMatchObject({ mode: 'build', tool: 'column' })
    expect(framingPostToolChoices(editor.toolDefaults.column)).toEqual({
      size: '4x4',
      base: 'none',
    })
    // the base row keeps the size; the place row reads both
    postBaseOption.set('post-base')
    expect(framingPostToolChoices(useEditor.getState().toolDefaults.column)).toEqual({
      size: '4x4',
      base: 'post-base',
    })
    expect(columnPlaceOption.value()).toBe('4x4')
    expect(postBaseOption.visible!.value()).toBe(true)
    // back to columns: the ornamental column tool, the base row hidden
    columnPlaceOption.set('column')
    expect(useEditor.getState().toolDefaults.column).toBeUndefined()
    expect(columnPlaceOption.value()).toBe('column')
    expect(postBaseOption.visible!.value()).toBe(false)
    // the tile comes back as it was left
    armFramingPostTool()
    expect(framingPostToolChoices(useEditor.getState().toolDefaults.column)).toEqual({
      size: '4x4',
      base: 'post-base',
    })
  })

  test("snaps under a beam's end, along a beam, and onto another post", () => {
    const post = createFramingPost({ position: [2, 3], levelId: 'level_g' })
    const nodes = storey([post])
    expect(
      postSnapTargets(nodes, 'level_g')
        .map((target) => target.id)
        .sort(),
    ).toEqual([HEADER.id, post.id].sort())
    const at = (point: [number, number]) =>
      snapPostPoint({ point, nodes, levelId: 'level_g' }).point
    expect(at([4.83, 0.05])).toEqual([4.8768, 0])
    const along = at([1.3, 0.08])
    expect(along[0]).toBeCloseTo(1.3)
    expect(along[1]).toBeCloseTo(0)
    expect(at([2.04, 2.97])).toEqual([2, 3])
    expect(snapPostPoint({ point: [1.3, 0.08], nodes, levelId: 'level_g', free: true })).toEqual({
      point: [1.3, 0.08],
      snap: null,
    })
  })

  test('a post stands up to the underside of the beam over it, else the ceiling plane', () => {
    const nodes = storey()
    const under = framingPostAt({
      nodes,
      levelId: 'level_g',
      point: [0, 0],
      choices: { size: '6x6', base: 'none' },
      foot: onFloor,
    })
    expect(under.beamId).toBe(HEADER.id)
    expect(under.post.height).toBeCloseTo(2.7 - 7.5 * IN)
    expect(under.post).toMatchObject({ role: 'post', parentId: 'level_g', position: [0, 0, 0] })
    const open = framingPostAt({
      nodes,
      levelId: 'level_g',
      point: [3, 3],
      choices: { size: '4x4', base: 'pier' },
      foot: () => 0.05,
    })
    expect(open.beamId).toBeNull()
    expect(open.post.height).toBeCloseTo(2.65)
    expect(open.post.postBase).toBe('pier')
  })

  test('a beam gets posts at each end and no further apart than 8 ft, skipping one standing', () => {
    const standing = createFramingPost({ position: [0, 0], levelId: 'level_g' })
    const posts = framingPostsUnderBeam({
      nodes: storey([standing]),
      beam: { ...HEADER, end: [6, 0] },
      choices: { size: '6x6', base: 'none' },
      foot: onFloor,
    })
    // 6 m is three bays of 2 m (two of 8 ft would not reach); the near end has its post already
    expect(posts.map((post) => [post.position[0], post.position[2]])).toEqual([
      [2, 0],
      [4, 0],
      [6, 0],
    ])
    for (const post of posts) expect(post.height).toBeCloseTo(2.7 - 7.5 * IN)
  })
})

describe('a framing post in the column panel and the plan', () => {
  test('changes size with its base in proportion, and fits to the beam over it', () => {
    const post = createFramingPost({ position: [1, 0], size: '4x4', base: 'pier', height: 2 })
    const patch = framingPostSizePatch(post, '6x6')
    expect(patch.width).toBeCloseTo(5.5 * IN)
    expect(patch.width! * patch.baseWidthScale!).toBeCloseTo(11.5 * IN)
    const fit = framingPostFit(storey(), { ...post, parentId: 'level_g' }, 0)
    expect(fit?.beamId).toBe(HEADER.id)
    expect(fit?.height).toBeCloseTo(2.7 - 7.5 * IN)
  })

  test('is drawn as a framing plan draws a post: its own square crossed corner to corner', () => {
    const view = {
      viewState: { selected: false, highlighted: false, hovered: false, moving: false },
    } as unknown as GeometryContext
    const lines = (node: ColumnNode) => {
      const flat = (g: FloorplanGeometry | null): FloorplanGeometry[] =>
        !g ? [] : g.kind === 'group' ? g.children.flatMap(flat) : [g]
      return flat(buildColumnFloorplan(node, view)).filter((g) => g.kind === 'line')
    }
    const post = createFramingPost({ position: [2, 2], size: '6x6', base: 'pier' })
    const cross = lines(post).filter(
      (line) => line.kind === 'line' && Math.abs(Math.abs(line.x2 - line.x1) - 5.5 * IN) < 1e-9,
    )
    expect(cross).toHaveLength(2)
    // an ornamental column keeps its small centre mark only
    expect(lines(ColumnNode.parse({ position: [2, 0, 2] }))).toHaveLength(2)
    // the post's plan footprint is the post, not a capital's or a base's spread
    const bare = createFramingPost({ position: [2, 2], size: '6x6' })
    const outline = (() => {
      const flat = (g: FloorplanGeometry | null): FloorplanGeometry[] =>
        !g ? [] : g.kind === 'group' ? g.children.flatMap(flat) : [g]
      return flat(buildColumnFloorplan(bare, view)).find((g) => g.kind === 'polygon')
    })()
    const xs = outline?.kind === 'polygon' ? outline.points.map((point) => point[0]) : []
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(5.5 * IN)
  })
})
