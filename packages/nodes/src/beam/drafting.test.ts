import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BeamNode,
  BuildingNode,
  ColumnNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SlabNode,
  WallNode,
} from '@pascal-app/core'
import { type SnappingMode, useEditor } from '@pascal-app/editor'
import { beamDefinition } from './definition'
import { useBeamDraft } from './draft-settings'
import { beamSnapTargets, draftBeam, snapBeamPoint } from './drafting'

const IN = 0.0254
type Nodes = Record<AnyNodeId, AnyNode>
const previous = useEditor.getState()
let restore: () => void = () => {}

beforeAll(() => {
  restore = nodeRegistry._snapshot()
  if (!nodeRegistry.has('beam')) registerNode(beamDefinition)
})
afterAll(() => restore())
afterEach(() => {
  useEditor.setState(previous, true)
  useBeamDraft.setState({ preset: '6x8', material: 'sawn', top: 'ceiling-dropped' })
})

/** The beam tool armed, drafting under `mode`. */
function drafting(mode: SnappingMode) {
  useEditor.setState((state) => ({
    mode: 'build',
    tool: 'beam',
    gridSnapStep: 0.5,
    snappingModeByContext: { ...state.snappingModeByContext, wall: mode },
  }))
}

const WALL = WallNode.parse({
  id: 'wall_a',
  parentId: 'level_g',
  start: [0, 0],
  end: [4, 0],
  thickness: 0.2,
})
const OTHER = BeamNode.parse({ id: 'beam_b', parentId: 'level_g', start: [0, 3], end: [4, 3] })
const POST = ColumnNode.parse({ id: 'column_p', parentId: 'level_g', position: [6, 0, 6] })
const ELSEWHERE = BeamNode.parse({ id: 'beam_u', parentId: 'level_u', start: [0, 9], end: [4, 9] })

function storey(extra: AnyNode[] = []): Nodes {
  return Object.fromEntries(
    [
      BuildingNode.parse({ id: 'building_a', children: ['level_g', 'level_u'] }),
      LevelNode.parse({
        id: 'level_g',
        parentId: 'building_a',
        level: 0,
        height: 2.7,
        children: ['slab_g', WALL.id, OTHER.id, POST.id, ...extra.map((n) => n.id)],
      }),
      LevelNode.parse({ id: 'level_u', parentId: 'building_a', level: 1, height: 2.7 }),
      SlabNode.parse({
        id: 'slab_g',
        parentId: 'level_g',
        polygon: [
          [-1, -1],
          [9, -1],
          [9, 9],
          [-1, 9],
        ],
        elevation: 0.05,
        thickness: 0.25,
      }),
      WALL,
      OTHER,
      POST,
      ELSEWHERE,
      ...extra,
    ].map((node) => [node.id, node]),
  ) as Nodes
}

describe('what a beam snaps to', () => {
  test("the level's walls and both faces, other beams' centrelines and post centres", () => {
    const targets = beamSnapTargets(storey(), 'level_g')
    expect(targets.map((target) => target.id).sort()).toEqual(
      ['beam_b', 'column_p', 'wall_a', 'wall_a:a', 'wall_a:b'].sort(),
    )
    const faceA = targets.find((target) => target.id === 'wall_a:a')!
    expect(faceA.start).toEqual([0, 0.1])
    expect(faceA.end).toEqual([4, 0.1])
    expect(targets.find((target) => target.id === 'column_p')).toMatchObject({
      start: [6, 6],
      end: [6, 6],
    })
    // the beam being edited is no target of its own
    expect(beamSnapTargets(storey(), 'level_g', ['beam_b']).map((t) => t.id)).not.toContain(
      'beam_b',
    )
  })

  test('a point near a beam end, a post or a wall face corner lands on it', () => {
    drafting('lines')
    const nodes = storey()
    const at = (point: [number, number]) =>
      snapBeamPoint({ point, nodes, levelId: 'level_g' }).point
    expect(at([4.05, 3.04])).toEqual([4, 3])
    expect(at([6.03, 5.98])).toEqual([6, 6])
    const corner = at([0.03, 0.14])
    expect(corner[0]).toBeCloseTo(0)
    expect(corner[1]).toBeCloseTo(0.1)
    // Alt places it where the pointer is
    expect(snapBeamPoint({ point: [4.05, 3.04], nodes, levelId: 'level_g', free: true })).toEqual({
      point: [4.05, 3.04],
      snap: null,
    })
  })

  test('on the grid, a point lands on the grid away from anything to catch', () => {
    drafting('grid')
    expect(snapBeamPoint({ point: [2.2, 6.7], nodes: storey(), levelId: 'level_g' }).point).toEqual(
      [2, 6.5],
    )
  })
})

describe('the beam a draft makes', () => {
  test('takes the Build panel size, material and top', () => {
    const nodes = storey()
    const beam = draftBeam([1, 1], [5, 1], 'level_g', nodes, {
      preset: '(3)2x12',
      material: 'pressure-treated',
      top: 'floor-under',
    })
    expect(beam).toMatchObject({
      type: 'beam',
      parentId: 'level_g',
      start: [1, 1],
      end: [5, 1],
      size: '2x12',
      plies: 3,
      material: 'pressure-treated',
      placement: 'dropped',
    })
    expect(beam.width).toBeCloseTo(4.5 * IN)
    // under the floor slab's body: 0.05 top, 0.25 thick
    expect(beam.topElevation).toBeCloseTo(-0.2)
    const under = draftBeam([1, 1], [5, 1], 'level_g', nodes, {
      preset: '6x8',
      material: 'sawn',
      top: 'ceiling-dropped',
    })
    expect(under.topElevation).toBeUndefined()
  })

  test('a preset the host armed the tool with wins over the panel', () => {
    const beam = draftBeam(
      [0, 0],
      [3, 0],
      'level_g',
      storey(),
      { preset: '6x8', material: 'sawn', top: 'ceiling-dropped' },
      { material: 'glulam', width: 0.13, depth: 0.3, size: '5-1/8x12', topElevation: 2.4 },
    )
    expect(beam).toMatchObject({ material: 'glulam', width: 0.13, topElevation: 2.4 })
    expect(beam.start).toEqual([0, 0])
  })
})
