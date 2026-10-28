import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  AnyNode as AnyNodeSchema,
  BEAM_SIZE_PRESETS,
  BeamNode,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
} from '../schema'
import {
  beamBottomElevation,
  beamCeilingPlane,
  beamOutline,
  beamSizeLabel,
  beamSizePreset,
  beamSizePresetPatch,
  beamsOverPoint,
  beamTopElevation,
  beamTopReferenceOf,
  beamTopReferencePatch,
  createBeam,
  inchFractionLabel,
  levelFloorAt,
  matchBeamSizePreset,
  postStationsAlong,
} from './beam'

const IN = 0.0254
type Nodes = Record<AnyNodeId, AnyNode>
const keyed = (nodes: AnyNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n])) as Nodes

/** Two storeys 2.7 m apart; the ground floor's slab tops out 0.05 m over its plane, 0.2 m thick. */
function house(beams: BeamNode[], above: SlabNode[] = []) {
  return keyed([
    SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
    BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: ['level_g', 'level_u'] }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      height: 2.7,
      children: ['slab_g', ...beams.map((b) => b.id)],
    }),
    LevelNode.parse({
      id: 'level_u',
      parentId: 'building_a',
      level: 1,
      height: 2.7,
      children: above.map((s) => s.id),
    }),
    SlabNode.parse({
      id: 'slab_g',
      parentId: 'level_g',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      elevation: 0.05,
      thickness: 0.2,
    }),
    ...beams,
    ...above,
  ])
}

const beam = (fields: Partial<BeamNode> = {}) =>
  BeamNode.parse({ id: 'beam_a', parentId: 'level_g', start: [2, 4], end: [6, 4], ...fields })

describe('beam sizes', () => {
  test('the stock sizes carry their dressed sections', () => {
    const size = (id: string) => beamSizePreset(id)!
    expect(size('4x8').width).toBeCloseTo(3.5 * IN)
    expect(size('4x8').depth).toBeCloseTo(7.25 * IN)
    expect(size('6x8').width).toBeCloseTo(5.5 * IN)
    expect(size('6x8').depth).toBeCloseTo(7.5 * IN)
    expect(size('6x12').depth).toBeCloseTo(11.5 * IN)
    // a built-up beam is its plies side by side
    expect(size('(3)2x10')).toMatchObject({ size: '2x10', plies: 3, label: '(3) 2x10' })
    expect(size('(3)2x10').width).toBeCloseTo(4.5 * IN)
    expect(size('(2)lvl-1-3/4x11-7/8').width).toBeCloseTo(3.5 * IN)
    expect(size('W8x10').material).toBe('steel')
    // a label finds its size as well as an id
    expect(beamSizePreset('(2) 2x10')?.id).toBe('(2)2x10')
    expect(new Set(BEAM_SIZE_PRESETS.map((preset) => preset.id)).size).toBe(
      BEAM_SIZE_PRESETS.length,
    )
  })

  test('a beam reads as a framing plan prints its size', () => {
    expect(beamSizeLabel(createBeam({ start: [0, 0], end: [3, 0] }))).toBe('6x8')
    expect(beamSizeLabel(createBeam({ start: [0, 0], end: [3, 0], preset: '(2)2x10' }))).toBe(
      '(2) 2x10',
    )
    expect(
      beamSizeLabel(
        createBeam({ start: [0, 0], end: [3, 0], preset: '6x8', material: 'pressure-treated' }),
      ),
    ).toBe('6x8 PT')
    expect(
      beamSizeLabel(createBeam({ start: [0, 0], end: [3, 0], preset: 'lvl-1-3/4x11-7/8' })),
    ).toBe('1-3/4x11-7/8 LVL')
    expect(beamSizeLabel(createBeam({ start: [0, 0], end: [3, 0], preset: 'W8x10' }))).toBe('W8x10')
    // a section that is no stock size prints its actual inches
    expect(
      beamSizeLabel(createBeam({ start: [0, 0], end: [3, 0], width: 3.5 * IN, depth: 9 * IN })),
    ).toBe('3-1/2x9')
    // a schema default is the 6x8 it is sized as, though it names no size
    expect(beamSizeLabel(BeamNode.parse({ start: [0, 0], end: [3, 0] }))).toBe('6x8')
  })

  test('inches print in sixteenths, reduced', () => {
    expect(inchFractionLabel(3.5 * IN)).toBe('3-1/2')
    expect(inchFractionLabel(11.875 * IN)).toBe('11-7/8')
    expect(inchFractionLabel(0.75 * IN)).toBe('3/4')
    expect(inchFractionLabel(9 * IN)).toBe('9')
  })

  test('a size matches its preset, and switching size keeps a treated beam treated', () => {
    const treated = createBeam({
      start: [0, 0],
      end: [3, 0],
      preset: '(2)2x10',
      material: 'pressure-treated',
    })
    expect(matchBeamSizePreset(treated)?.id).toBe('(2)2x10')
    expect(beamSizePresetPatch(treated, '6x10')).toMatchObject({
      size: '6x10',
      plies: 1,
      material: 'pressure-treated',
    })
    expect(beamSizePresetPatch(treated, 'glulam-5-1/8x12').material).toBe('glulam')
    expect(matchBeamSizePreset({ ...treated, width: 2 * IN })).toBeNull()
  })
})

describe('createBeam', () => {
  test('builds a beam on its level from a centreline and a size', () => {
    const made = createBeam({
      start: [1, 2],
      end: [5, 2],
      preset: '(2) 2x12',
      topElevation: 2.4,
      levelId: 'level_g',
      supportSlabId: 'slab_porch',
    })
    expect(made.type).toBe('beam')
    expect(made.id).toStartWith('beam_')
    expect(made).toMatchObject({
      parentId: 'level_g',
      start: [1, 2],
      end: [5, 2],
      size: '2x12',
      plies: 2,
      material: 'sawn',
      placement: 'dropped',
      topElevation: 2.4,
      supportSlabId: 'slab_porch',
    })
    expect(made.depth).toBeCloseTo(11.25 * IN)
    // it is a node the scene's union accepts
    expect(AnyNodeSchema.parse(made).type).toBe('beam')
  })

  test('a custom section names no size; an unknown size falls back to the 6x8', () => {
    const custom = createBeam({ start: [0, 0], end: [2, 0], width: 0.1, depth: 0.3, plies: 2 })
    expect(custom.size).toBeUndefined()
    expect(custom).toMatchObject({ width: 0.1, depth: 0.3, plies: 2 })
    expect(createBeam({ start: [0, 0], end: [2, 0], preset: 'nope' }).size).toBe('6x8')
  })

  test('its plan outline is its width either side of the centreline', () => {
    const outline = beamOutline(createBeam({ start: [0, 0], end: [4, 0], preset: '6x8' }))
    const half = 2.75 * IN
    expect(outline.map(([x, z]) => [x, Number(z.toFixed(6))])).toEqual([
      [0, Number(half.toFixed(6))],
      [4, Number(half.toFixed(6))],
      [4, Number((-half).toFixed(6))],
      [0, Number((-half).toFixed(6))],
    ])
  })
})

describe('beam elevation', () => {
  test('a dropped beam hangs under the ceiling plane, a flush one sits in the ceiling framing', () => {
    const dropped = beam()
    const nodes = house([dropped])
    expect(beamCeilingPlane(nodes, dropped)).toBeCloseTo(2.7)
    expect(beamTopElevation(nodes, dropped)).toBeCloseTo(2.7)
    expect(beamBottomElevation(nodes, dropped)).toBeCloseTo(2.7 - 7.5 * IN)
    const flush = beam({ placement: 'flush' })
    expect(beamBottomElevation(house([flush]), flush)).toBeCloseTo(2.7)
  })

  test('a stored top stands, and a slab of the level above lowers the plane over it', () => {
    const set = beam({ topElevation: 2.2 })
    expect(beamTopElevation(house([set]), set)).toBe(2.2)
    const covered = beam()
    const above = SlabNode.parse({
      id: 'slab_u',
      parentId: 'level_u',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      elevation: 0.05,
      thickness: 0.3,
    })
    // the slab's body reaches 0.25 m under the upper storey's plane
    expect(beamTopElevation(house([covered], [above]), covered)).toBeCloseTo(2.45)
  })

  test('the top references set it from the ceiling plane or the floor', () => {
    const subject = beam()
    const nodes = house([subject])
    expect(levelFloorAt(nodes, 'level_g', [5, 4])).toEqual({
      top: 0.05,
      underside: 0.05 - 0.2,
      slabId: 'slab_g',
    })
    expect(levelFloorAt(nodes, 'level_g', [20, 4]).slabId).toBeNull()
    expect(beamTopReferenceOf(nodes, subject)).toBe('ceiling-dropped')
    const flushFloor = { ...subject, ...beamTopReferencePatch(nodes, subject, 'floor-flush') }
    expect(flushFloor).toMatchObject({ topElevation: 0.05, placement: 'flush' })
    expect(beamTopReferenceOf(nodes, flushFloor)).toBe('floor-flush')
    const underFloor = { ...subject, ...beamTopReferencePatch(nodes, subject, 'floor-under') }
    expect(underFloor.topElevation).toBeCloseTo(-0.15)
    expect(beamTopReferenceOf(nodes, underFloor)).toBe('floor-under')
    expect(beamTopReferenceOf(nodes, { ...subject, topElevation: 1.9 })).toBeNull()
    expect(beamTopReferencePatch(nodes, flushFloor, 'ceiling-flush')).toEqual({
      topElevation: undefined,
      placement: 'flush',
    })
  })
})

describe('posts under beams', () => {
  test('finds the beams over a point, the lowest first', () => {
    const high = beam({ id: 'beam_high' as BeamNode['id'] })
    const low = beam({ id: 'beam_low' as BeamNode['id'], topElevation: 2.2 })
    const nodes = house([high, low])
    expect(beamsOverPoint(nodes, 'level_g', [4, 4]).map((b) => b.id)).toEqual([
      'beam_low',
      'beam_high',
    ])
    // at an end, inside the width
    expect(beamsOverPoint(nodes, 'level_g', [6, 4 + 2 * IN])).toHaveLength(2)
    // past the end, beside it
    expect(beamsOverPoint(nodes, 'level_g', [6.2, 4])).toHaveLength(0)
    expect(beamsOverPoint(nodes, 'level_g', [4, 4.2])).toHaveLength(0)
  })

  test('posts stand at both ends and evenly between, no further apart than asked', () => {
    expect(postStationsAlong([0, 0], [6, 0], 2.4)).toEqual([
      [0, 0],
      [2, 0],
      [4, 0],
      [6, 0],
    ])
    expect(postStationsAlong([0, 0], [2, 0], 2.4)).toEqual([
      [0, 0],
      [2, 0],
    ])
  })
})
