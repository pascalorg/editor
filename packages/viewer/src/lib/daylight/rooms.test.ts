// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import {
  Box3,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
} from 'three'
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
  ].map((object) => ({ object, levelIndex: 0 }))
  const window = new Group()
  window.position.set(-0.05, 1.5, 2)
  const glass = box(0.02, 1.2, 1, 0, 0, 0)
  glass.userData.slotId = 'glass'
  window.add(glass)
  window.updateMatrixWorld(true)
  return {
    bounds: new Box3(new Vector3(0, 0, 0), new Vector3(8, 2.7, 4)),
    levels: [{ y: 0, building: 0 }],
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

  test('measures a doorway in a rotated building along its wall, never with a negative width', () => {
    // Off the grid axes the room boundary is a staircase of cells; clustering it as if it ran
    // along one axis gave negative widths, portals that took light away (black rooms, streaks).
    const input = twoRooms()
    const angle = 0.7
    const turn = (x: number, z: number): [number, number] => [
      x * Math.cos(angle) + z * Math.sin(angle),
      -x * Math.sin(angle) + z * Math.cos(angle),
    ]
    const building = new Group()
    building.rotation.y = angle
    for (const { object } of [...input.walls, ...input.covers]) building.add(object)
    building.add(input.openings[0]!.object)
    building.updateMatrixWorld(true)
    const zones = input.zones.map((zone) => ({
      ...zone,
      polygon: zone.polygon.map(([x, z]) => turn(x, z)),
    }))
    const bounds = new Box3()
    for (const zone of zones)
      for (const [x, z] of zone.polygon) bounds.expandByPoint(new Vector3(x, 0, z))
    const rooms = new RoomLighting()
    rooms.build({ ...input, zones, bounds, lamps: [] })

    expect(rooms.openings.every((opening) => opening.width > 0)).toBe(true)
    const doorway = rooms.openings.filter((o) => new Set([o.a, o.b]).size === 2 && o.b >= 0)
    expect(doorway).toHaveLength(1)
    expect(doorway[0]!.width).toBeGreaterThan(0.6)
    expect(doorway[0]!.width).toBeLessThan(1.6)
    // It faces across the partition (the building's local x axis).
    const across = new Vector3(Math.cos(angle), 0, -Math.sin(angle))
    expect(Math.abs(doorway[0]!.normal.dot(across))).toBeGreaterThan(0.9)
    expect(rooms.portals.every((portal) => portal.width > 0)).toBe(true)
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

  test('a camera in a hidden level is outdoors', () => {
    const rooms = new RoomLighting()
    rooms.build(twoRooms())
    const eye = new Vector3(1, 1.6, 1)
    expect(rooms.isEnclosedAt(eye)).toEqual({ room: 0, inside: true })
    rooms.levelShown = [false]
    expect(rooms.isEnclosedAt(eye)).toEqual({ room: -1, inside: false })
  })

  test("lit rooms in view lower an outside camera's exposure, never raise it", () => {
    const rooms = new RoomLighting()
    rooms.build(twoRooms())
    const camera = new PerspectiveCamera(50, 1.5, 0.1, 500)
    camera.position.set(4, 14, 9)
    camera.lookAt(4, 0, 2)
    camera.updateMatrixWorld()
    // Night: the moonlit exterior reads far darker than the lamplit rooms seen from above.
    const night = rooms.viewedMeter(camera, 0.02, 0.01)
    expect(night.roomsE).toBeGreaterThan(0.1)
    expect(night.sceneE).toBeGreaterThan(0.04)
    expect(night.sceneE).toBeLessThan(night.roomsE)
    // The eye adapts from the blue moonlit outdoors towards the warm lamplit rooms.
    const moonlight = new Color(0.05, 0.07, 0.14)
    const adapted = rooms.viewedMeter(camera, 0.02, 0.01, moonlight, 0.07).illuminant!
    expect(adapted.r / adapted.b).toBeGreaterThan(moonlight.r / moonlight.b)
    // Day: the exterior outshines the rooms; the reading stays the exterior's.
    expect(rooms.viewedMeter(camera, 5, 2).sceneE).toBe(5)
    // Looking away, the rooms don't count.
    camera.lookAt(4, 14, 100)
    camera.updateMatrixWorld()
    expect(rooms.viewedMeter(camera, 0.02, 0.01)).toEqual({
      sceneE: 0.02,
      roomsE: 0,
      illuminant: null,
    })
  })

  test('every floor of a 40-storey tower keeps its own rooms', () => {
    const levels = Array.from({ length: 40 }, (_, f) => ({ y: f * 3.2, building: 0 }))
    const rooms = new RoomLighting()
    rooms.build(
      bare({
        levels,
        zones: levels.map((_, f) => ({
          id: `floor ${f}`,
          levelIndex: f,
          polygon: square(0, 0, 8),
        })),
      }),
    )
    for (let f = 0; f < 40; f++)
      expect(rooms.rooms[rooms.roomAt(new Vector3(4, f * 3.2 + 1.2, 4))]!.zone.id).toBe(
        `floor ${f}`,
      )
  })

  test('side-by-side buildings with different floor heights each keep their floors', () => {
    const rooms = new RoomLighting()
    rooms.build(
      bare({
        levels: [
          { y: 0, building: 0 },
          { y: 3, building: 0 },
          { y: 0, building: 1 },
          { y: 3.6, building: 1 },
        ],
        zones: [
          { id: 'a0', levelIndex: 0, polygon: square(0, 0, 8) },
          { id: 'a1', levelIndex: 1, polygon: square(0, 0, 8) },
          { id: 'b0', levelIndex: 2, polygon: square(8.2, 0, 8) },
          { id: 'b1', levelIndex: 3, polygon: square(8.2, 0, 8) },
        ],
      }),
    )
    const at = (x: number, y: number) => rooms.rooms[rooms.roomAt(new Vector3(x, y, 4))]?.zone.id
    expect(at(4, 1.2)).toBe('a0')
    expect(at(12, 1.2)).toBe('b0')
    // 3.3 m: building A is on its upper floor, building B still on its ground floor.
    expect(at(4, 3.3)).toBe('a1')
    expect(at(12, 3.3)).toBe('b0')
    expect(at(12, 4.8)).toBe('b1')
  })

  test('a courtyard (zone hole) is outside the room around it', () => {
    const rooms = new RoomLighting()
    rooms.build(
      bare({
        levels: [{ y: 0, building: 0 }],
        zones: [{ id: 'ring', levelIndex: 0, polygon: square(0, 0, 20), holes: [square(6, 6, 8)] }],
      }),
    )
    expect(rooms.roomAt(new Vector3(2, 1, 2))).toBe(0)
    expect(rooms.roomAt(new Vector3(10, 1, 10))).toBe(-1)
  })

  test('a 300 × 200 m hall costs memory along its walls, not its area', () => {
    const rooms = new RoomLighting()
    rooms.build(
      bare({
        levels: [{ y: 0, building: 0 }],
        zones: [
          {
            id: 'hall',
            levelIndex: 0,
            polygon: [
              [0, 0],
              [300, 0],
              [300, 200],
              [0, 200],
            ],
          },
        ],
      }),
    )
    // A dense 10 cm map of the floor would be 6 M cells; the tiled map keeps only the perimeter.
    expect(rooms.map.memoryBytes()).toBeLessThan(2 * 2 ** 20)
    expect(rooms.roomAt(new Vector3(150, 1, 100))).toBe(0)
    expect(rooms.roomAt(new Vector3(0.05, 1, 100))).toBe(0)
    expect(rooms.roomAt(new Vector3(-2, 1, 100))).toBe(-1)
  })
})

describe('room map edge cases', () => {
  test('a room off the tile grid builds and resolves (tile rects in whole tiles)', () => {
    const rooms = new RoomLighting()
    rooms.build(
      bare({
        levels: [{ y: 0, building: 0 }],
        zones: [{ id: 'r', levelIndex: 0, polygon: square(27.55, 0, 8) }],
      }),
    )
    expect(rooms.roomAt(new Vector3(31, 1, 4))).toBe(0)
  })

  test('the index texture stays within the device limit on a vast site', () => {
    const rooms = new RoomLighting()
    rooms.map.textureLimit = 2048
    rooms.build(
      bare({
        levels: [{ y: 0, building: 0 }],
        zones: [
          { id: 'a', levelIndex: 0, polygon: square(0, 0, 2) },
          { id: 'b', levelIndex: 0, polygon: square(20000, 20000, 2) },
        ],
      }),
    )
    const index = (rooms.map.u.index.value as { image: { width: number; height: number } }).image
    expect(index.width).toBeLessThanOrEqual(2048)
    expect(index.height).toBeLessThanOrEqual(2048)
    expect(rooms.roomAt(new Vector3(1, 1, 1))).toBe(0)
    expect(rooms.roomAt(new Vector3(20001, 1, 20001))).toBe(1)
  })

  test('where rooms overlap, the smallest wins (a floor-wide room never swallows the rooms in it)', () => {
    const rooms = new RoomLighting()
    rooms.build(
      bare({
        levels: [{ y: 0, building: 0 }],
        zones: [
          { id: 'kitchen', levelIndex: 0, polygon: square(0, 0, 5) },
          { id: 'bedroom', levelIndex: 0, polygon: square(5, 0, 5) },
          // Listed last, as an automatic room added after the drawn ones would be.
          { id: 'whole floor', levelIndex: 0, polygon: square(0, 0, 10) },
        ],
      }),
    )
    const at = (x: number, z: number) => rooms.rooms[rooms.roomAt(new Vector3(x, 1, z))]?.zone.id
    expect(at(2, 2)).toBe('kitchen')
    expect(at(7, 2)).toBe('bedroom')
    expect(at(5, 8)).toBe('whole floor')
  })

  test('a room never reaches past its walls, wherever its outline runs inside them', () => {
    // A house turned 40° off the grid, 0.3 m walls. Its room outline can run along the walls'
    // outside faces (faces locked to the line), their centres, or their inside faces. A wall's
    // outside face looks 18 cm out for its room: it must find none anywhere along the wall,
    // while the wall's own thickness (window reveals) still belongs to the room.
    const angle = (40 * Math.PI) / 180
    const turn = (x: number, z: number): [number, number] => [
      x * Math.cos(angle) + z * Math.sin(angle),
      -x * Math.sin(angle) + z * Math.cos(angle),
    ]
    const thickness = 0.3
    for (const outline of [0, thickness / 2, thickness]) {
      // Outside faces on the 8 × 6 m rectangle; the room outline sits `outline` inside them.
      const building = new Group()
      building.rotation.y = angle
      const walls = [
        box(8, 2.7, thickness, 4, 1.35, thickness / 2),
        box(8, 2.7, thickness, 4, 1.35, 6 - thickness / 2),
        box(thickness, 2.7, 6, thickness / 2, 1.35, 3),
        box(thickness, 2.7, 6, 8 - thickness / 2, 1.35, 3),
      ]
      for (const wall of walls) building.add(wall)
      building.updateMatrixWorld(true)
      const rooms = new RoomLighting()
      rooms.build({
        ...bare({
          levels: [{ y: 0, building: 0 }],
          zones: [
            {
              id: 'room',
              levelIndex: 0,
              polygon: rect(outline, outline, 8 - outline, 6 - outline).map(([x, z]) => turn(x, z)),
            },
          ],
        }),
        walls: walls.map((object) => ({ object, levelIndex: 0 })),
      })
      const at = (x: number, z: number) => {
        const [wx, wz] = turn(x, z)
        return rooms.roomAt(new Vector3(wx, 1, wz))
      }
      for (let d = 0.02; d < 8; d += 0.02) {
        expect(at(d, -0.18)).toBe(-1)
        expect(at(d, 6.18)).toBe(-1)
      }
      for (let d = 0.02; d < 6; d += 0.02) {
        expect(at(-0.18, d)).toBe(-1)
        expect(at(8.18, d)).toBe(-1)
      }
      // Inside the wall, 5 cm past the room's outline, and in the room itself.
      for (let d = 0.5; d < 7.5; d += 0.02) expect(at(d, Math.max(outline - 0.05, 0.05))).toBe(0)
      expect(at(4, 3)).toBe(0)
    }
  })

  test('a building turned off the world axes reads exactly like the same building drawn square', () => {
    // Two rooms behind 0.3 m walls with the outside faces on the outline, plus a second building
    // 20 m away at its own angle. Whatever the angles, every point finds the room it finds when
    // the buildings are square: no stepped edges along the walls.
    const scene = (angles: [number, number]) => {
      const zones: RoomSceneInput['zones'] = []
      const walls: RoomSceneInput['walls'] = []
      const place = angles.map((angle, b) => {
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        // Turned about the site's origin, so the building keeps its place on the cell grid.
        const at = (x: number, z: number): [number, number] => [
          (b * 20 + x) * cos + z * sin,
          -(b * 20 + x) * sin + z * cos,
        ]
        const building = new Group()
        building.position.set(b * 20 * cos, 0, -b * 20 * sin)
        building.rotation.y = angle
        const meshes = [
          box(8, 2.7, 0.3, 4, 1.35, 0.15),
          box(8, 2.7, 0.3, 4, 1.35, 5.85),
          box(0.3, 2.7, 6, 0.15, 1.35, 3),
          box(0.3, 2.7, 6, 7.85, 1.35, 3),
          box(0.1, 2.7, 6, 4, 1.35, 3),
        ]
        for (const mesh of meshes) building.add(mesh)
        building.updateMatrixWorld(true)
        for (const object of meshes) walls.push({ object, levelIndex: b })
        zones.push(
          { id: `${b} west`, levelIndex: b, polygon: rect(0, 0, 4, 6).map(([x, z]) => at(x, z)) },
          { id: `${b} east`, levelIndex: b, polygon: rect(4, 0, 8, 6).map(([x, z]) => at(x, z)) },
        )
        return at
      })
      const rooms = new RoomLighting()
      rooms.build({
        ...bare({
          levels: [
            { y: 0, building: 0 },
            { y: 0, building: 1 },
          ],
          zones,
        }),
        walls,
      })
      // Every 3.7 cm across each building and half a metre around it (never on a cell's edge,
      // where rounding alone would decide).
      const found: number[] = []
      for (const at of place)
        for (let x = -0.4873; x < 8.5; x += 0.037)
          for (let z = -0.4873; z < 6.5; z += 0.037) {
            const [wx, wz] = at(x, z)
            found.push(rooms.roomAt(new Vector3(wx, 1, wz)))
          }
      return found
    }
    const square = scene([0, 0])
    expect(new Set(square)).toEqual(new Set([-1, 0, 1, 2, 3]))
    expect(scene([0.7, 0.7])).toEqual(square)
    expect(scene([(40 * Math.PI) / 180, -0.3])).toEqual(square)
  })

  test('a pavilion in a courtyard keeps its room inside the wing around it', () => {
    // The C-shaped wing's rooms and the pavilion are far enough apart to form separate clusters,
    // but the wing's cluster rect covers the courtyard.
    const rooms = new RoomLighting()
    rooms.build(
      bare({
        levels: [{ y: 0, building: 0 }],
        zones: [
          { id: 'west', levelIndex: 0, polygon: rect(0, 0, 6, 40) },
          { id: 'north', levelIndex: 0, polygon: rect(6, 0, 40, 6) },
          { id: 'south', levelIndex: 0, polygon: rect(6, 34, 40, 40) },
          { id: 'pavilion', levelIndex: 0, polygon: rect(20, 17, 26, 23) },
        ],
      }),
    )
    expect(rooms.rooms[rooms.roomAt(new Vector3(23, 1, 20))]?.zone.id).toBe('pavilion')
    expect(rooms.roomAt(new Vector3(33, 1, 20))).toBe(-1)
  })

  test('a level opens from above only when every level over it is hidden', () => {
    const rooms = new RoomLighting()
    rooms.build(
      bare({
        levels: [
          { y: 0, building: 0 },
          { y: 3, building: 0 },
          { y: 6, building: 0 },
        ],
        zones: [0, 1, 2].map((f) => ({ id: `f${f}`, levelIndex: f, polygon: square(0, 0, 8) })),
      }),
    )
    const none = [false, false, false]
    // A middle floor hidden while the top one shows: the ground floor stays covered.
    rooms.setLevelPresentation([0, 0, 0], [true, false, true], none)
    expect(rooms.levelFocused).toEqual([false, false, false])
    rooms.setLevelPresentation([0, 0, 0], [true, false, false], none)
    expect(rooms.levelFocused).toEqual([true, false, false])
    // The selected level of a cutaway is focused even with nothing hidden over it.
    rooms.setLevelPresentation([0, 0, 0], [true, true, true], [false, false, true])
    expect(rooms.levelFocused).toEqual([false, false, true])
  })
})

function rect(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
}

function square(x: number, z: number, size: number): [number, number][] {
  return [
    [x, z],
    [x + size, z],
    [x + size, z + size],
    [x, z + size],
  ]
}

/** Rooms without walls, covers or openings: only the room map matters. */
function bare(input: Pick<RoomSceneInput, 'levels' | 'zones'>): RoomSceneInput {
  const bounds = new Box3()
  for (const zone of input.zones)
    for (const [x, z] of zone.polygon) bounds.expandByPoint(new Vector3(x, 0, z))
  return { ...input, bounds, covers: [], walls: [], openings: [], lamps: [], virtualLampsOn: false }
}
