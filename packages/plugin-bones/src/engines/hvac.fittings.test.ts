import { describe, expect, test } from 'bun:test'
import type { Member } from '../core/types'
import { buildGroups } from '../framing/renderer'
import { manhattanDuct } from './hvac'

describe('real duct fittings in the layout (2026-09-09): a Manhattan run turns through a radius elbow', () => {
  test('with room for the bend the corner is an elbow and the legs give up the radius; a short leg keeps the square corner', () => {
    const members: Member[] = []
    manhattanDuct(members, [0, 0], [3, 2], 2.5, 0.1, 0.1, 'r1', 'Bath exhaust 4"')
    const elbow = members.find((m) => m.shape === 'elbow') as Member
    expect(elbow).toBeDefined()
    expect(elbow.position).toEqual([3, 2.5, 0])
    expect(elbow.dims[0]).toBeCloseTo(0.1524, 6) // never under 6 in
    expect(elbow.length).toBeCloseTo((Math.PI / 2) * 0.1524, 6)
    expect(elbow.rotation[1]).toBeCloseTo(0, 6) // entering along +x
    expect(elbow.turn).toBe(1) // (+x then +z) turns toward local +z
    const legs = members.filter((m) => m.shape !== 'elbow')
    expect(legs).toHaveLength(2)
    expect(legs[0]!.position[0] + legs[0]!.dims[0] / 2).toBeCloseTo(3 - 0.1524, 6)
    expect(legs[1]!.position[2] - legs[1]!.dims[0] / 2).toBeCloseTo(0.1524, 6)
    expect(legs[0]!.length + legs[1]!.length).toBeCloseTo(5 - 2 * 0.1524, 6)
    const short: Member[] = []
    manhattanDuct(short, [0, 0], [0.2, 2], 2.5, 0.1, 0.1, 'r1', 'x')
    expect(short.some((m) => m.shape === 'elbow')).toBe(false)
  })
  test('the renderer mounts a fitting as its own mesh, never an instanced box, and not in the finished view', () => {
    const members: Member[] = []
    manhattanDuct(members, [0, 0], [3, 2], 2.5, 0.1, 0.1, 'r1', 'Bath exhaust 4"')
    const { group } = buildGroups(members, [], 'xray')
    const meshes = group.children.filter(
      (c) =>
        (c as { isMesh?: boolean }).isMesh && !(c as { isInstancedMesh?: boolean }).isInstancedMesh,
    )
    expect(meshes).toHaveLength(1)
    const off = buildGroups(members, [], 'off')
    expect(off.group.children).toHaveLength(0)
  })
})
