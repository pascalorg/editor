// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import { Box3, BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { RoomLighting, type RoomSceneInput } from './rooms'

const material = new MeshBasicMaterial()

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  mesh.updateMatrixWorld(true)
  return mesh
}

/**
 * Two 4 × 4 m rooms side by side (x 0…4 and 4…8), 2.7 m high, under one ceiling slab: a
 * partition at x = 4 with a 1 m doorway, exterior walls all round, one window in the west wall.
 */
function twoRooms(): RoomSceneInput {
  const walls = [
    // partition at x = 4, doorway between z = 1.5 and 2.5
    box(0.1, 2.7, 1.5, 4, 1.35, 0.75),
    box(0.1, 2.7, 1.5, 4, 1.35, 3.25),
    // exterior
    box(8.2, 2.7, 0.1, 4, 1.35, -0.05),
    box(8.2, 2.7, 0.1, 4, 1.35, 4.05),
    box(0.1, 2.7, 4, 8.05, 1.35, 2),
    // west wall with a window hole (sill 0.9 m, head 2.1 m, z 1.5…2.5)
    box(0.1, 0.9, 4, -0.05, 0.45, 2),
    box(0.1, 0.6, 4, -0.05, 2.4, 2),
    box(0.1, 1.2, 1.5, -0.05, 1.5, 0.75),
    box(0.1, 1.2, 1.5, -0.05, 1.5, 3.25),
  ]
  const window = new Group()
  window.position.set(-0.05, 1.5, 2)
  const glass = box(0.02, 1.2, 1, 0, 0, 0)
  glass.userData.slotId = 'glass'
  window.add(glass)
  window.updateMatrixWorld(true)
  return {
    bounds: new Box3(new Vector3(0, 0, 0), new Vector3(8, 2.7, 4)),
    levelY: [0],
    zones: [
      {
        id: 'west',
        levelIndex: 0,
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      },
      {
        id: 'east',
        levelIndex: 0,
        polygon: [
          [4, 0],
          [8, 0],
          [8, 4],
          [4, 4],
        ],
      },
    ],
    covers: [{ object: box(8.2, 0.2, 4.2, 4, 2.8, 2), kind: 'ceiling' }],
    walls,
    openings: [{ object: window, kind: 'window', id: 'window' }],
    lamps: [
      {
        position: new Vector3(6, 2.3, 2),
        color: new Color(1, 0.9, 0.8),
        intensity: 10,
        range: 6,
        itemId: 'lamp',
        on: true,
      },
    ],
    virtualLampsOn: false,
  }
}

describe('room lighting', () => {
  test('finds enclosed rooms, the window portal and the doorway between the rooms', () => {
    const rooms = new RoomLighting()
    rooms.build(twoRooms())
    expect(rooms.rooms.map((room) => room.enclosed)).toEqual([true, true])
    expect(rooms.roomAt(new Vector3(1, 1, 1))).toBe(0)
    expect(rooms.roomAt(new Vector3(7, 1, 1))).toBe(1)
    expect(rooms.roomAt(new Vector3(-3, 1, 1))).toBe(-1)
    // the window lights the west room, facing in (+x)
    const windows = rooms.portals.filter((portal) => portal.kind === 0)
    expect(windows).toHaveLength(1)
    expect(windows[0]!.room).toBe(0)
    expect(windows[0]!.normal.x).toBeCloseTo(1)
    // the doorway is the only walkable opening (the window has a sill)
    expect(rooms.openings).toHaveLength(1)
    expect(new Set([rooms.openings[0]!.a, rooms.openings[0]!.b])).toEqual(new Set([0, 1]))
    expect(rooms.openings[0]!.width).toBeGreaterThan(0.6)
  })

  test('puts lamps in their room, a virtual lamp in rooms without one, and meters daylight', () => {
    const rooms = new RoomLighting()
    rooms.build(twoRooms())
    expect(rooms.rooms[1]!.lamps.map((lamp) => lamp.itemId)).toEqual(['lamp'])
    expect(rooms.rooms[0]!.lamps).toHaveLength(1)
    expect(rooms.rooms[0]!.lamps[0]!.itemId).toBeUndefined()
    // soft cap: never above the room target
    expect(rooms.rooms[1]!.lampE).toBeLessThanOrEqual(1.1)
    rooms.updateSky(
      () => new Color(1, 1, 1),
      new Vector3(-1, 0.5, 0).normalize(),
      new Color(1, 1, 1),
      3,
    )
    expect(rooms.rooms[0]!.dayE).toBeGreaterThan(rooms.rooms[1]!.dayE)
    // lamp switches flow into the meter
    const lit = rooms.meter(1, 0)
    rooms.setLampStates(() => false)
    expect(rooms.meter(1, 0)).toBeLessThan(lit)
  })
})
