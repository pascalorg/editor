import { describe, expect, test } from 'bun:test'
import {
  collectWalls,
  coverFrontPose,
  findFrontDoor,
  isExteriorWall,
  wallBounds,
  type PoseNodes,
} from './pose'

/**
 * A 10 × 8 m box on a lot, x east and z south. The front door sits on the
 * NORTH wall (z = 0) which is where the street is; a second door sits on the
 * south wall, and an interior partition runs down the middle.
 */
function house(): PoseNodes {
  return {
    site_1: {
      id: 'site_1',
      type: 'site',
      polygon: {
        type: 'polygon',
        points: [
          [-5, -8],
          [15, -8],
          [15, 16],
          [-5, 16],
        ],
      },
    },
    level_0: { id: 'level_0', type: 'level', level: 0, children: [] },
    wall_n: { id: 'wall_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], height: 3 },
    wall_e: { id: 'wall_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], height: 3 },
    wall_s: { id: 'wall_s', type: 'wall', parentId: 'level_0', start: [10, 8], end: [0, 8], height: 3 },
    wall_w: { id: 'wall_w', type: 'wall', parentId: 'level_0', start: [0, 8], end: [0, 0], height: 3 },
    wall_mid: { id: 'wall_mid', type: 'wall', parentId: 'level_0', start: [5, 1], end: [5, 7], height: 3 },
    // +1.5 m along the north wall from its midpoint (5,0) → (6.5, 0).
    door_front: { id: 'door_front', type: 'door', wallId: 'wall_n', position: [1.5, 0, 0] },
    door_back: { id: 'door_back', type: 'door', wallId: 'wall_s', position: [0, 0, 0] },
    door_inner: { id: 'door_inner', type: 'door', wallId: 'wall_mid', position: [0, 0, 0] },
  }
}

describe('footprint', () => {
  test('walls of the level bound the building', () => {
    const bounds = wallBounds(collectWalls(house(), 'level_0'))
    expect(bounds).toEqual({ minX: 0, minZ: 0, maxX: 10, maxZ: 8 })
  })

  test('the middle partition is not an exterior wall', () => {
    const walls = collectWalls(house(), 'level_0')
    const bounds = wallBounds(walls)!
    const byId = new Map(walls.map((w) => [w.id, w]))
    expect(isExteriorWall(byId.get('wall_n')!, bounds)).toBe(true)
    expect(isExteriorWall(byId.get('wall_s')!, bounds)).toBe(true)
    expect(isExteriorWall(byId.get('wall_mid')!, bounds)).toBe(false)
  })
})

describe('front door', () => {
  test('the door nearest the street wins, and interior doors never do', () => {
    const front = findFrontDoor(house())
    expect(front?.doorId).toBe('door_front')
    expect(front?.wall.id).toBe('wall_n')
  })

  test('the wall normal points out of the building (north = -z)', () => {
    const front = findFrontDoor(house())!
    expect(front.normal[1]).toBeLessThan(0)
  })

  test('with no site the most north-facing exterior door is chosen', () => {
    const nodes = house()
    delete nodes.site_1
    expect(findFrontDoor(nodes)?.doorId).toBe('door_front')
  })

  test('a door on the south side of the lot is chosen when the lot flips', () => {
    const nodes = house()
    // Put the street south of the house: the front edge midpoint moves to z ≈ 16.
    nodes.site_1 = { ...nodes.site_1!, frontEdge: 2 }
    expect(findFrontDoor(nodes)?.doorId).toBe('door_back')
  })
})

describe('cover-front pose', () => {
  test('stands outside the north wall, above the horizon, looking at the centre', () => {
    const pose = coverFrontPose(house())!
    expect(pose.target[0]).toBeCloseTo(5, 6)
    expect(pose.target[2]).toBeCloseTo(4, 6)
    // North of the building (world +z is south, so the camera z is small).
    expect(pose.position[2]).toBeLessThan(0)
    expect(pose.position[1]).toBeGreaterThan(0)
  })

  test('the elevation angle is 25° above the target', () => {
    const pose = coverFrontPose(house())!
    const dx = pose.position[0] - pose.target[0]
    const dy = pose.position[1] - pose.target[1]
    const dz = pose.position[2] - pose.target[2]
    const angle = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI
    expect(angle).toBeCloseTo(25, 1)
  })

  test('it is a standard pose, not the current camera — same scene, same answer', () => {
    expect(coverFrontPose(house())).toEqual(coverFrontPose(house()))
  })

  test('the camera is swung off the wall normal by 30° in yaw', () => {
    const pose = coverFrontPose(house())!
    const dx = pose.position[0] - pose.target[0]
    const dz = pose.position[2] - pose.target[2]
    // The wall normal is (0, -1); measure the swing away from it.
    const swing = (Math.atan2(dx, -dz) * 180) / Math.PI
    expect(Math.abs(swing)).toBeCloseTo(30, 1)
  })

  test('an empty scene has nothing to frame', () => {
    expect(coverFrontPose({})).toBeNull()
  })

  test('a house with no doors still gets a three-quarter pose', () => {
    const nodes = house()
    delete nodes.door_front
    delete nodes.door_back
    delete nodes.door_inner
    const pose = coverFrontPose(nodes)
    expect(pose).not.toBeNull()
    expect(pose!.position[1]).toBeGreaterThan(0)
  })
})
