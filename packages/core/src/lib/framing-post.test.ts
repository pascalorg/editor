import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BeamNode,
  BuildingNode,
  ColumnNode,
  LevelNode,
  SiteNode,
} from '../schema'
import {
  createFramingPost,
  FRAMING_POST_MIN_HEIGHT,
  framingPostBasePatch,
  framingPostFields,
  framingPostHeightLimit,
  framingPostSize,
  framingPostTopAt,
  isFramingPost,
} from './framing-post'

const IN = 0.0254
const FT = 12 * IN
type Nodes = Record<AnyNodeId, AnyNode>
const keyed = (nodes: AnyNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n])) as Nodes

function storey(beams: BeamNode[]) {
  return keyed([
    SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
    BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: ['level_g'] }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      height: 2.7,
      children: beams.map((b) => b.id),
    }),
    ...beams,
  ])
}

describe('framing posts', () => {
  test('a post is a plain square column of its dressed size, pressure-treated, marked a post', () => {
    const post = createFramingPost({ position: [3, 4], size: '4x4', height: 2.4 })
    expect(post.type).toBe('column')
    expect(post).toMatchObject({
      role: 'post',
      postBase: 'none',
      style: 'plain',
      crossSection: 'square',
      position: [3, 0, 4],
      height: 2.4,
      baseStyle: 'none',
      capitalStyle: 'none',
      shaftStartScale: 1,
      shaftEndScale: 1,
      shaftCornerRadius: 0,
      edgeSoftness: 0,
      slots: { shaft: 'library:wood-woodplank19' },
    })
    expect(post.width).toBeCloseTo(3.5 * IN)
    expect(post.depth).toBeCloseTo(3.5 * IN)
    expect(isFramingPost(post)).toBe(true)
    expect(framingPostSize(post)).toBe('4x4')
    // ornamental columns are none of this
    const column = ColumnNode.parse({})
    expect(isFramingPost(column)).toBe(false)
    expect(column.role).toBeUndefined()
    expect(column.postBase).toBeUndefined()
  })

  test('its height comes from its top and foot, never under the least a tool makes', () => {
    expect(
      createFramingPost({ position: [0, 0], baseElevation: 0.05, topElevation: 2.5 }).height,
    ).toBeCloseTo(2.45)
    // a deck post on the ground carries the grade as its own y
    const deck = createFramingPost({
      position: [0, -0.4, 0],
      topElevation: 1.6,
      supportSlabId: 'ground',
      levelId: 'level_g',
    })
    expect(deck).toMatchObject({
      position: [0, -0.4, 0],
      supportSlabId: 'ground',
      parentId: 'level_g',
    })
    expect(deck.height).toBeCloseTo(2)
    expect(createFramingPost({ position: [0, 0], height: 0.01 }).height).toBe(
      FRAMING_POST_MIN_HEIGHT,
    )
    expect(createFramingPost({ position: [0, 0] }).height).toBeCloseTo(8 * FT)
  })

  test('a base is the column base block: a steel post base or a concrete pier', () => {
    const pier = createFramingPost({ position: [0, 0], size: '6x6', base: 'pier', height: 2.4 })
    expect(pier).toMatchObject({
      postBase: 'pier',
      baseStyle: 'simple-square',
      slots: { shaft: 'library:wood-woodplank19', base: 'library:concrete-raw' },
    })
    expect(pier.baseHeight).toBeCloseTo(8 * IN)
    expect(pier.width * pier.baseWidthScale).toBeCloseTo(11.5 * IN)
    const stood = framingPostBasePatch(pier, 'post-base')
    expect(stood).toMatchObject({ postBase: 'post-base', slots: { base: 'library:metal-steel' } })
    expect(stood.baseHeight).toBeCloseTo(1.5 * IN)
    // taking the base off keeps the shaft's wood and drops the base's paint
    expect(framingPostBasePatch(pier, 'none')).toEqual({
      postBase: 'none',
      baseStyle: 'none',
      baseHeight: 0,
      baseWidthScale: 1,
      baseDepthScale: 1,
      slots: { shaft: 'library:wood-woodplank19' },
    })
    expect(framingPostFields('8x8').width).toBeCloseTo(7.25 * IN)
  })

  test('a post stands up to the underside of the beam over it, else the ceiling plane', () => {
    const header = BeamNode.parse({
      id: 'beam_h',
      parentId: 'level_g',
      start: [0, 0],
      end: [4, 0],
      width: 5.5 * IN,
      depth: 7.5 * IN,
    })
    const nodes = storey([header])
    expect(framingPostTopAt(nodes, 'level_g', [4, 0], { baseElevation: 0.05 })).toEqual({
      top: 2.7 - 7.5 * IN,
      beamId: 'beam_h',
    })
    expect(framingPostTopAt(nodes, 'level_g', [8, 0])).toEqual({ top: 2.7, beamId: null })
    // a beam under the post's foot is not what it carries
    const girder = { ...header, id: 'beam_g' as BeamNode['id'], topElevation: 0 }
    const low = storey([girder])
    expect(framingPostTopAt(low, 'level_g', [2, 0], { baseElevation: 0.05 }).beamId).toBeNull()
  })

  test('a post taller than its size may stand on a deck is flagged', () => {
    expect(
      framingPostHeightLimit(createFramingPost({ position: [0, 0], size: '4x4', height: 9 * FT })),
    ).toMatchObject({
      size: '4x4',
      limit: expect.closeTo(8 * FT, 6),
    })
    expect(
      framingPostHeightLimit(createFramingPost({ position: [0, 0], size: '6x6', height: 9 * FT })),
    ).toBeNull()
    expect(framingPostHeightLimit(ColumnNode.parse({ height: 9 }))).toBeNull()
  })
})
