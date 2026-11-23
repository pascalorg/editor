import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools'
import type { AnyNode, WallFace, WallNode } from '../schema'
import { twoRooms } from './__fixtures__/dressing-scenes'
import { applySceneChanges, type SetWallFaceRegionsInput, setWallFaceRegions } from './index'
import type { SceneNodes } from './types'

const OWNER = 'dress:zone_salon:'

type Setup = Parameters<typeof twoRooms>[0]
const scene = (setup?: Setup) => twoRooms(setup).nodes as SceneNodes
// Fixture walls bound the salon on their left. The geometric oracle is face a,
// independent of the production room-face reader.
const salonFace = (_nodes: SceneNodes, _wallId: string): WallFace => 'a'

const run = (nodes: SceneNodes, input: SetWallFaceRegionsInput) => {
  const outcome = setWallFaceRegions(nodes, input, { activeLevelId: 'level_0' })
  return { ...outcome, nodes: applySceneChanges(nodes, outcome.changes) as Record<string, AnyNode> }
}
const regionsOf = (nodes: Record<string, AnyNode>, id: string) =>
  (nodes[id] as WallNode).faceRegions
const code = (action: () => unknown) => {
  try {
    action()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return 'no refusal'
}
const hand = (face: WallFace, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `hand_${i}`,
    face,
    v1: 0.1 + i / 10,
    finish: '#aaaaaa',
  }))

describe('the regions of a face, for one owner', () => {
  test('are numbered by owner in the order given, and clamped to the face', () => {
    const nodes = scene()
    const face = salonFace(nodes, 'wall_w')
    const { nodes: after, result } = run(nodes, {
      owner: OWNER,
      faces: [
        {
          wallId: 'wall_w',
          face,
          regions: [
            { v1: 0.9, finish: 'library:preset-cream' },
            { u0: -1, u1: 99, v0: 0.9, v1: 99, finish: '#ffffff' },
          ],
        },
      ],
    })
    expect(regionsOf(after, 'wall_w')).toEqual([
      { id: 'dress:zone_salon:0', face, v1: 0.9, finish: 'library:preset-cream' },
      { id: 'dress:zone_salon:1', face, u0: 0, u1: 3, v0: 0.9, v1: 2.5, finish: '#ffffff' },
    ])
    expect(result.faces).toEqual([expect.objectContaining({ wallId: 'wall_w', face, count: 2 })])
  })

  test('a call replaces its own regions and never touches one drawn by hand', () => {
    const nodes = scene()
    const face = salonFace(nodes, 'wall_w')
    const drawn = scene({ walls: { wall_w: { faceRegions: hand(face, 1) } } })
    const first = run(drawn, {
      owner: OWNER,
      faces: [{ wallId: 'wall_w', face, regions: [{ v1: 0.9, finish: '#111111' }] }],
    })
    const second = run(first.nodes, {
      owner: OWNER,
      faces: [{ wallId: 'wall_w', face, regions: [{ v1: 1.2, finish: '#222222' }] }],
    })
    expect(regionsOf(second.nodes, 'wall_w')).toEqual([
      hand(face, 1)[0],
      { id: 'dress:zone_salon:0', face, v1: 1.2, finish: '#222222' },
    ])
  })

  test('are taken off with an empty list, and the ones by hand stay', () => {
    const nodes = scene()
    const face = salonFace(nodes, 'wall_w')
    const dressed = run(scene({ walls: { wall_w: { faceRegions: hand(face, 1) } } }), {
      owner: OWNER,
      faces: [{ wallId: 'wall_w', face, regions: [{ v1: 0.9, finish: '#111111' }] }],
    })
    const bare = run(dressed.nodes, { owner: OWNER, faces: [], clearWallIds: ['wall_w'] })
    expect(regionsOf(bare.nodes, 'wall_w')).toEqual(hand(face, 1))
  })

  test('a call that changes nothing writes nothing', () => {
    const nodes = scene()
    const face = salonFace(nodes, 'wall_w')
    const input = {
      owner: OWNER,
      faces: [{ wallId: 'wall_w', face, regions: [{ v1: 0.9, finish: '#111111' }] }],
    }
    const first = run(nodes, input)
    expect(run(first.nodes, input).changes?.update).toEqual([])
  })

  test('a face holds eight, the ones by hand counted: the ninth is refused and nothing is written', () => {
    const nodes = scene()
    const face = salonFace(nodes, 'wall_w')
    const full = scene({ walls: { wall_w: { faceRegions: hand(face, 7) } } })
    const two = [
      { v1: 0.9, finish: '#111111' },
      { v0: 0.9, finish: '#222222' },
    ]
    const before = structuredClone(full)
    expect(
      code(() =>
        run(full, {
          owner: OWNER,
          faces: [
            { wallId: 'wall_an', face, regions: two },
            { wallId: 'wall_w', face, regions: two },
          ],
        }),
      ),
    ).toBe('region_limit')
    expect(full).toEqual(before)
    expect(
      regionsOf(
        run(full, { owner: OWNER, faces: [{ wallId: 'wall_w', face, regions: two.slice(0, 1) }] })
          .nodes,
        'wall_w',
      ),
    ).toHaveLength(8)
    // the other face of the wall is another face
    const other: WallFace = face === 'a' ? 'b' : 'a'
    expect(
      code(() =>
        run(full, { owner: OWNER, faces: [{ wallId: 'wall_w', face: other, regions: two }] }),
      ),
    ).toBe('no refusal')
  })

  test('a face a script builds to the top is refused; one that stops at a height is not', () => {
    const nodes = scene()
    const face = salonFace(nodes, 'wall_w')
    const input = {
      owner: OWNER,
      faces: [{ wallId: 'wall_w', face, regions: [{ v1: 0.9, finish: '#111111' }] }],
    }
    const owned = scene({
      raw: { wall_w: { finishScripts: { [face]: { kind: 'script', inputs: 'k' } } } },
    })
    expect(code(() => run(owned, input))).toBe('script_owns_face')
    const dado = scene({
      raw: { wall_w: { finishScripts: { [face]: { kind: 'script', inputs: 'k', toHeight: 1 } } } },
    })
    expect(code(() => run(dado, input))).toBe('no refusal')
  })

  test('refuses what is not a wall and a curtain wall, and skips a region off the face', () => {
    const nodes = scene({ walls: { wall_an: { wallType: 'curtain' } } })
    const face = salonFace(nodes, 'wall_w')
    const lay =
      (wallId: string, regions = [{ v1: 0.9, finish: '#111111' }]) =>
      () =>
        run(nodes, { owner: OWNER, faces: [{ wallId, face, regions }] })
    expect(code(lay('zone_salon'))).toBe('target_not_found')
    expect(code(lay('wall_an'))).toBe('curtain_wall')
    expect(
      run(nodes, {
        owner: OWNER,
        faces: [{ wallId: 'wall_w', face, regions: [{ v0: 5, finish: '#111111' }] }],
      }).result.skipped,
    ).toEqual([{ wallId: 'wall_w', face, why: 'it lies off the face' }])
  })
})
