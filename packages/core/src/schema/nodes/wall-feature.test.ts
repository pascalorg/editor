import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  AnyNode,
  type AnyNodeId,
  ItemNode,
  LevelNode,
  useScene,
  WallFeatureNode,
  WallNode,
} from '@pascal-app/core'

describe('wall feature persisted contract', () => {
  test('parses both modes and wall faces through the public node union', () => {
    for (const mode of ['niche', 'bump'] as const) {
      for (const face of ['a', 'b'] as const) {
        const feature = WallFeatureNode.parse({
          parentId: 'wall_host',
          mode,
          face,
          u: 1.5,
          bottom: 0.8,
          width: 0.7,
          height: 0.4,
          depth: 0.12,
          slots: { body: 'scene:accent' },
        })
        expect(feature.id).toStartWith('wall-feature_')
        expect(AnyNode.parse(JSON.parse(JSON.stringify(feature)))).toEqual(feature)
      }
    }
  })

  test('stores nested coordinates and inherits the face through ownership', () => {
    const niche = WallFeatureNode.parse({
      parentId: 'wall-feature_bump',
      u: 0.4,
      bottom: 0.7,
    })
    expect(niche).toMatchObject({ parentId: 'wall-feature_bump', u: 0.4, bottom: 0.7 })
    expect(niche.face).toBeUndefined()
    expect(niche.slots).toBeUndefined()
    expect(AnyNode.safeParse({ ...niche, face: 'b' }).success).toBe(false)
    expect(WallFeatureNode.safeParse({ parentId: 'wall_host' }).success).toBe(false)
    expect(WallFeatureNode.safeParse({ parentId: 'level_host', face: 'a' }).success).toBe(false)
  })

  test('rejects nonfinite coordinates and nonpositive dimensions', () => {
    for (const field of ['u', 'bottom', 'width', 'height', 'depth']) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(WallFeatureNode.safeParse({ [field]: value }).success).toBe(false)
      }
    }
    for (const field of ['width', 'height', 'depth']) {
      for (const value of [0, -0.1]) {
        expect(WallFeatureNode.safeParse({ [field]: value }).success).toBe(false)
      }
    }
    expect(WallFeatureNode.safeParse({ bottom: -0.1 }).success).toBe(false)
    expect(WallFeatureNode.parse({ width: 12, height: 8, depth: 3 }).depth).toBe(3)
  })
})

describe('wall feature scene ownership', () => {
  let savedRaf: typeof requestAnimationFrame
  let savedCancelRaf: typeof cancelAnimationFrame

  beforeEach(() => {
    savedRaf = globalThis.requestAnimationFrame
    savedCancelRaf = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
      materials: {},
      readOnly: false,
    })
    useScene.temporal.getState().clear()
  })

  afterEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() })
    useScene.temporal.getState().clear()
    globalThis.requestAnimationFrame = savedRaf
    globalThis.cancelAnimationFrame = savedCancelRaf
  })

  test('creates and reloads wall, bump, nested niche, and hosted item links', () => {
    const level = LevelNode.parse({ level: 0 })
    const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0] })
    const bump = WallFeatureNode.parse({
      parentId: wall.id,
      mode: 'bump',
      face: 'b',
      u: 2,
      bottom: 0,
      width: 1.2,
      height: 2,
      depth: 0.2,
    })
    const niche = WallFeatureNode.parse({
      parentId: bump.id,
      u: 0.6,
      bottom: 1,
      slots: { body: 'library:concrete-drywall' },
    })
    const item = ItemNode.parse({
      parentId: niche.id,
      position: [0, 0, 0],
      asset: {
        id: 'shelf-object',
        category: 'accessory',
        name: 'Shelf object',
        thumbnail: '/thumbnail.webp',
        src: '/model.glb',
        dimensions: [0.1, 0.1, 0.1],
      },
    })
    useScene
      .getState()
      .createNodes(
        [level, wall, bump, niche, item].map((node) => ({ node, parentId: node.parentId })),
      )
    const created = useScene.getState()
    const decoded: { nodes: Record<string, unknown>; rootNodeIds: AnyNodeId[] } = JSON.parse(
      JSON.stringify({ nodes: created.nodes, rootNodeIds: created.rootNodeIds }),
    )
    const nodes = Object.fromEntries(
      Object.entries(decoded.nodes).map(([id, node]) => [id, AnyNode.parse(node)]),
    )
    useScene.getState().setScene(nodes, decoded.rootNodeIds)
    useScene.getState().updateNode(bump.id, { width: 1.4 })

    const loaded = useScene.getState().nodes
    expect(WallNode.parse(loaded[wall.id]).children).toEqual([bump.id])
    expect(WallFeatureNode.parse(loaded[bump.id])).toMatchObject({
      parentId: wall.id,
      face: 'b',
      children: [niche.id],
      width: 1.4,
    })
    expect(WallFeatureNode.parse(loaded[niche.id])).toEqual({ ...niche, children: [item.id] })
    expect(ItemNode.parse(loaded[item.id]).parentId).toBe(niche.id)
    expect(useScene.getState().rootNodeIds).toEqual([level.id])
  })

  test('loads an existing wall scene without adding feature fields', () => {
    const level = LevelNode.parse({ level: 0 })
    const wall = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
    })
    level.children = [wall.id]
    const nodes = { [level.id]: level, [wall.id]: wall }
    useScene.getState().setScene(JSON.parse(JSON.stringify(nodes)), [level.id])
    expect(WallNode.parse(useScene.getState().nodes[wall.id])).toEqual(wall)
    expect(
      Object.values(useScene.getState().nodes)
        .map((node) => node.type)
        .sort(),
    ).toEqual(['level', 'wall'])
  })
})
