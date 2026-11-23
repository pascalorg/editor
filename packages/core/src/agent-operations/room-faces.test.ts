import { describe, expect, test } from 'bun:test'
import type { ZoneNode } from '../schema'
import { twoRooms } from './__fixtures__/dressing-scenes'
import { roomBoundaryWalls, roomWallFaces } from './room-faces'
import type { SceneNodes } from './types'

const faces = (zone: string, overrides?: Parameters<typeof twoRooms>[0]) => {
  const nodes = twoRooms(overrides).nodes as SceneNodes
  return roomWallFaces(nodes, nodes[zone] as ZoneNode)
}
const byWall = (list: ReturnType<typeof faces>) =>
  Object.fromEntries(list.map((f) => [f.wallId, f]))

describe('the faces that look into a room', () => {
  test('a partition gives each room its own face, and the faces are opposite', () => {
    const [salon, bath] = [byWall(faces('zone_salon')), byWall(faces('zone_bath'))]
    expect(salon.wall_p?.face).toBeDefined()
    expect(bath.wall_p?.face).toBeDefined()
    expect(salon.wall_p?.face).not.toBe(bath.wall_p?.face)
    expect(Object.keys(salon).sort()).toEqual(['wall_an', 'wall_p', 'wall_s', 'wall_w'])
    expect(Object.keys(bath).sort()).toEqual(['wall_bn', 'wall_e', 'wall_p', 'wall_s'])
  })

  test('a wall that runs on past the room gives only the stretch the room stands on', () => {
    const [salon, bath] = [byWall(faces('zone_salon')), byWall(faces('zone_bath'))]
    expect(salon.wall_s).toMatchObject({ t0: 0, t1: 0.5, u0: 0, u1: 4, length: 8, whole: false })
    expect(bath.wall_s).toMatchObject({ t0: 0.5, t1: 1, u0: 4, u1: 8, length: 8, whole: false })
    expect(salon.wall_s?.face).toBe(bath.wall_s?.face)
    expect(salon.wall_w).toMatchObject({ u0: 0, u1: 3, length: 3, whole: true })
  })

  test('a curtain wall carries no finish', () => {
    expect(
      faces('zone_salon', { walls: { wall_an: { wallType: 'curtain' } } }).map((f) => f.wallId),
    ).not.toContain('wall_an')
    const nodes = twoRooms({ walls: { wall_an: { wallType: 'curtain' } } }).nodes as SceneNodes
    expect(roomBoundaryWalls(nodes, nodes.zone_salon as ZoneNode).map((w) => w.id)).toEqual([
      'wall_s',
      'wall_p',
      'wall_w',
    ])
  })
})
