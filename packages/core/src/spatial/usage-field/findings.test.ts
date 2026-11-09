import { afterEach, describe, expect, test } from 'bun:test'
import { verifyScene } from '../../agent-operations'
import { verifySceneModelResult } from '../../agent-tools/verify-scene'
import { distanceToBoundary } from '../../lib/polygon-boolean'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import { type UsageIssue, usageIssues } from './findings'
import { sdfChecksOn, setSdfChecks } from './flag'
import { obstacleGap, obstacleOf } from './obstacles'
import { usageShapes } from './shapes'
import type { Nodes } from './walls'

const SHA = 'a'.repeat(64)

const wall = (
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
) => WallNode.parse({ id, parentId: 'level_1', start, end, thickness: 0.1, children })

const zone = (id: string, name: string, polygon: [number, number][]) =>
  ZoneNode.parse({ id, parentId: 'level_1', name, polygon })

const slab = SlabNode.parse({
  id: 'slab_1',
  parentId: 'level_1',
  polygon: [
    [-0.3, -0.3],
    [6.3, -0.3],
    [6.3, 4.3],
    [-0.3, 4.3],
  ],
  elevation: 0.05,
})

function house(extra: AnyNode[]): Nodes {
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_1', children: ['level_1'] }),
    LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] }),
    slab,
    wall('wall_e', [6, 0], [6, 4]),
    wall('wall_n', [6, 4], [0, 4]),
    wall('wall_w', [0, 4], [0, 0]),
    ...extra,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Nodes
}

const frontDoor = DoorNode.parse({
  id: 'door_front',
  parentId: 'wall_s',
  wallId: 'wall_s',
  position: [1.5, 1.05, 0],
  width: 1,
  height: 2.1,
  name: 'Front door',
  // These figures were drawn with a frame inside the wall's thickness; one as deep as the wall puts
  // the door, not the wall, at the corridor's edge.
  frameDepth: 0.07,
})
const southWall = wall('wall_s', [0, 0], [6, 0], ['door_front'])

// Two rooms side by side, a door in the partition; `split` makes the east side two rooms with no wall between them
function twoRooms(partition = 0.9, items: AnyNode[] = [], split = false) {
  const inner = DoorNode.parse({
    id: 'door_inner',
    parentId: 'wall_p',
    wallId: 'wall_p',
    position: [2, 1.05, 0],
    width: partition,
    height: 2.1,
    name: 'Inner door',
  })
  return house([
    southWall,
    frontDoor,
    wall('wall_p', [3, 0], [3, 4], ['door_inner']),
    inner,
    zone('zone_west', 'West room', [
      [0.05, 0.05],
      [2.95, 0.05],
      [2.95, 3.95],
      [0.05, 3.95],
    ]),
    ...(split
      ? [
          zone('zone_east', 'East room', [
            [3.05, 0.05],
            [5.95, 0.05],
            [5.95, 2.0],
            [3.05, 2.0],
          ]),
          zone('zone_annex', 'East annex', [
            [3.05, 2.0],
            [5.95, 2.0],
            [5.95, 3.95],
            [3.05, 3.95],
          ]),
        ]
      : [
          zone('zone_east', 'East room', [
            [3.05, 0.05],
            [5.95, 0.05],
            [5.95, 3.95],
            [3.05, 3.95],
          ]),
        ]),
    ...items,
  ])
}

// A script-made bookcase with a stored shape, so what it narrows is exact
const bookcase = (id: string, x: number, z: number, w: number, d: number, h = 1.8) =>
  ItemNode.parse({
    id,
    parentId: 'level_1',
    position: [x, 0, z],
    name: 'Bookcase',
    asset: {
      id: 'bookcase',
      name: 'Bookcase',
      category: 'storage',
      thumbnail: '/t.webp',
      src: `artifact://${SHA}`,
      dimensions: [w, h, d],
    },
    source: {
      kind: 'script',
      script: SHA,
      artifact: SHA,
      manifest: {
        bounds: { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] },
        triangles: 12,
        shape: {
          tolerance: 0.009,
          bands: [
            {
              y0: 0,
              y1: h,
              polygons: [
                {
                  outer: [
                    [-w / 2, -d / 2],
                    [w / 2, -d / 2],
                    [w / 2, d / 2],
                    [-w / 2, d / 2],
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  })

const issues = (nodes: Nodes) => usageIssues(nodes, { cell: 0.02, entranceDoorId: 'door_front' })

// A corridor 1.2 m deep with a 0.5 m deep bookcase against its north wall (face at 1.25): 0.70 m left to the south wall
function corridorWithBookcase(): Nodes {
  const back = DoorNode.parse({
    id: 'door_back',
    parentId: 'wall_c',
    wallId: 'wall_c',
    position: [5, 1.05, 0],
    width: 1,
    height: 2.1,
    frameDepth: 0.07,
  })
  return house([
    southWall,
    frontDoor,
    wall('wall_c', [0, 1.3], [6, 1.3], ['door_back']),
    back,
    zone('zone_corridor', 'Corridor', [
      [0.05, 0.05],
      [5.95, 0.05],
      [5.95, 1.25],
      [0.05, 1.25],
    ]),
    zone('zone_room', 'Study', [
      [0.05, 1.35],
      [5.95, 1.35],
      [5.95, 3.95],
      [0.05, 3.95],
    ]),
    bookcase('item_1', 3, 1.0, 1.2, 0.5),
  ])
}

describe('passages', () => {
  test('a door with 0.80 m between its jambs is a doorway, and enough', () => {
    expect(issues(twoRooms(0.9)).filter((i) => i.type === 'usage_passage_narrow')).toHaveLength(0)
  })

  test('a 0.70 m door narrows the way to the room behind it', () => {
    const found = issues(twoRooms(0.7)).filter((i) => i.type === 'usage_passage_narrow')
    expect(found).toHaveLength(1)
    const [issue] = found
    expect(issue!.severity).toBe('warning')
    expect(issue!.valueM).toBeCloseTo(0.6, 2)
    expect(issue!.thresholdM).toBe(0.8)
    expect(issue!.place.room).toBe('East room')
    expect(issue!.fromDoorId).toBe('door_front')
    expect(issue!.message).toContain('Narrow passage to “East room”: 0.60 m')
    // the door as drawn and the clear width between its jambs are both said; the limit applies to the clear width
    expect(issue!.message).toContain(
      '0.60 m clear between the jambs of “Inner door”, a 0.70 m door',
    )
    expect(issue!.doorWidthM).toBe(0.7)
    expect(issue!.message).toContain('measured from “Front door”')
    expect(issue!.message).toContain('(below 0.80 m, a doorway)')
    expect(issue!.message).not.toMatch(/non conforme/i)
  })

  test('a doorway limited only by its standard 0.82 m leaf informs: the frame leaves 0.72 m clear', () => {
    const found = issues(twoRooms(0.82)).filter((i) => i.type === 'usage_passage_narrow')
    expect(found).toHaveLength(1)
    const [issue] = found
    expect(issue!.severity).toBe('info')
    expect(issue!.valueM).toBeCloseTo(0.72, 2)
    expect(issue!.thresholdM).toBe(0.8)
    expect(issue!.doorWidthM).toBe(0.82)
    expect(issue!.message).toContain(
      '0.72 m clear between the jambs of “Inner door”, a 0.82 m door',
    )
    expect(issue!.message).toContain('(a 0.82 m door leaf: the frame leaves 0.72 m clear).')
    expect(issue!.message).not.toContain('a doorway)')
    expect(issue!.brief).toContain('(a 0.82 m door leaf: the frame leaves 0.72 m clear).')
    expect(issue!.brief).not.toContain('a doorway)')
  })

  test('a leaf drawn 0.80 m informs at the boundary; 0.79 m is still a warning', () => {
    const [boundary] = issues(twoRooms(0.8)).filter((i) => i.type === 'usage_passage_narrow')
    expect(boundary!.severity).toBe('info')
    expect(boundary!.doorWidthM).toBe(0.8)
    const [narrow] = issues(twoRooms(0.79)).filter((i) => i.type === 'usage_passage_narrow')
    expect(narrow!.severity).toBe('warning')
    expect(narrow!.doorWidthM).toBe(0.79)
    expect(narrow!.message).toContain('(below 0.80 m, a doorway)')
  })

  test('a bookcase that leaves 0.70 m in a corridor narrows a passage that is not a doorway', () => {
    const found = issues(corridorWithBookcase()).filter(
      (i) => i.type === 'usage_passage_narrow' && i.place.room === 'Study',
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.thresholdM).toBe(0.9)
    expect(found[0]!.valueM).toBeCloseTo(0.7, 2)
    expect(found[0]!.severity).toBe('warning')
    expect(found[0]!.obstacles.map((o) => o.name)).toContain('Bookcase')
    expect(found[0]!.message).toMatch(/between “[^”]+” and “[^”]+”/)
  })

  test('a pinch between one jamb and a bookcase of the same clear width stays a warning', () => {
    // a wide doorway whose north side a bookcase fills, leaving 0.72 m between it and the south jamb
    const found = issues(twoRooms(1.2, [bookcase('item_1', 2.7, 2.77, 0.5, 1.2)])).filter(
      (i) => i.type === 'usage_passage_narrow',
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.valueM).toBeCloseTo(0.72, 2)
    expect(found[0]!.thresholdM).toBe(0.8)
    expect(found[0]!.obstacles.map((o) => o.kind).sort()).toEqual(['item', 'jamb'])
    expect(found[0]!.severity).toBe('warning')
    expect(found[0]!.message).not.toContain('door leaf')
  })

  test('an approximate bookcase narrowing the corridor is a warning, not just a measurement', () => {
    const nodes = corridorWithBookcase()
    const bookcase = nodes.item_1
    if (bookcase?.type !== 'item') throw new Error('Missing corridor bookcase')
    delete bookcase.source
    const found = issues(nodes).filter((issue) => issue.type === 'usage_passage_narrow')
    expect(found.length).toBeGreaterThan(0)
    expect(found).toContainEqual(
      expect.objectContaining({ severity: 'warning', approximate: true }),
    )
  })
})

const passages = (nodes: Nodes) => issues(nodes).filter((i) => i.type === 'usage_passage_narrow')

describe('a narrow place is one finding for the rooms it leads to', () => {
  const both = () => twoRooms(0.7, [], true)

  test('two rooms behind one 0.70 m door are one finding, with the figure it has for one room', () => {
    const found = passages(both())
    expect(found).toHaveLength(1)
    expect(found[0]!.serves!.map((room) => room.room).sort()).toEqual(['East annex', 'East room'])
    expect(found[0]!.valueM).toBe(passages(twoRooms(0.7))[0]!.valueM)
    expect(found[0]!.nodeIds).toEqual(
      expect.arrayContaining(['zone_east', 'zone_annex', 'door_inner']),
    )
    expect(found[0]!.message).toMatch(
      /^Narrow passage to “East (room|annex)” and “East (room|annex)”: /,
    )
    expect(found[0]!.message).toContain(
      '0.60 m clear between the jambs of “Inner door”, a 0.70 m door',
    )
  })

  test('the best other exterior door is said once when it is the same for every room the place leads to', () => {
    const east = DoorNode.parse({
      id: 'door_east',
      parentId: 'wall_e',
      wallId: 'wall_e',
      position: [2, 1.05, 0],
      width: 1,
      height: 2.1,
      name: 'East door',
    })
    const [found] = passages(
      twoRooms(0.7, [wall('wall_e', [6, 0], [6, 4], ['door_east']), east], true),
    )
    expect(found!.serves!.map((room) => room.alternative?.doorId)).toEqual([
      'door_east',
      'door_east',
    ])
    expect(found!.message).toContain(
      'a 0.70 m door; 0.90 m from “East door”, measured from “Front door”',
    )
  })

  test('two different narrow places stay two findings, each for its own room', () => {
    // a 0.70 m door into the middle room and a 0.65 m door on into the east one: the east room's narrowest point is the second door
    const door = (id: string, wallId: string, width: number) =>
      DoorNode.parse({
        id,
        parentId: wallId,
        wallId,
        position: [2, 1.05, 0],
        width,
        height: 2.1,
        frameDepth: 0.07,
        name: id,
      })
    const nodes = house([
      southWall,
      frontDoor,
      wall('wall_p1', [2, 0], [2, 4], ['door_p1']),
      door('door_p1', 'wall_p1', 0.7),
      wall('wall_p2', [4, 0], [4, 4], ['door_p2']),
      door('door_p2', 'wall_p2', 0.65),
      zone('zone_west', 'West', [
        [0.05, 0.05],
        [1.95, 0.05],
        [1.95, 3.95],
        [0.05, 3.95],
      ]),
      zone('zone_middle', 'Middle', [
        [2.05, 0.05],
        [3.95, 0.05],
        [3.95, 3.95],
        [2.05, 3.95],
      ]),
      zone('zone_far', 'Far', [
        [4.05, 0.05],
        [5.95, 0.05],
        [5.95, 3.95],
        [4.05, 3.95],
      ]),
    ])
    const found = passages(nodes)
    expect(found.map((i) => [i.serves!.map((room) => room.room), i.valueM]).sort()).toEqual([
      [['Far'], 0.55],
      [['Middle'], 0.6],
    ])
  })

  test('the room filter gives the place for each room it leads to, and nothing for another room', () => {
    setSdfChecks(true)
    const report = verifyScene(both(), {}, { activeLevelId: null }).result
    try {
      for (const room of ['East room', 'East annex', 'zone_annex']) {
        const answer = verifySceneModelResult(report, { room }) as { issues: { type: string }[] }
        expect(answer.issues.map((i) => i.type)).toContain('usage_passage_narrow')
      }
      const west = verifySceneModelResult(report, { room: 'West room' }) as { issueCount: number }
      expect(west.issueCount).toBe(0)
    } finally {
      setSdfChecks(false)
    }
  })

  test('a slot on no way to a room has no passage finding', () => {
    // two stubs from the north wall leave a 0.30 m slot, 1.5 m deep, open to the hall at one end
    const nodes = house([
      southWall,
      frontDoor,
      wall('wall_a', [2, 4], [2, 2.5]),
      wall('wall_b', [2.4, 4], [2.4, 2.5]),
      zone('zone_hall', 'Hall', [
        [0.05, 0.05],
        [5.95, 0.05],
        [5.95, 3.95],
        [0.05, 3.95],
      ]),
    ])
    expect(passages(nodes)).toHaveLength(0)
    expect(issues(nodes).filter((i) => i.type === 'usage_pocket')).toHaveLength(0)
  })
})

describe('a passage names what bounds its figure', () => {
  /** The prisms of one node in the band a body stands in (floor at 0.05 m). */
  const bodyPrisms = (nodes: Nodes, nodeId: string) =>
    usageShapes(nodes)
      .levels.flatMap((level) => level.prisms)
      .filter((prism) => prism.nodeId === nodeId && prism.z0 < 2.05 && prism.z1 > 0.08)

  /** How far a finding's spot is from the nearest outline of a thing it names. */
  const reach = (nodes: Nodes, issue: UsageIssue, nodeId: string) =>
    Math.min(
      ...bodyPrisms(nodes, nodeId).map((prism) =>
        Math.abs(distanceToBoundary([{ outer: prism.outer, holes: prism.holes }], issue.place.at)),
      ),
    )

  /** The exact distance between two named things' outlines. */
  const gap = (nodes: Nodes, a: string, b: string) =>
    Math.min(
      ...bodyPrisms(nodes, a).flatMap((p, i) =>
        bodyPrisms(nodes, b).map((q, j) => obstacleGap(obstacleOf(p, i), obstacleOf(q, j)).d),
      ),
    )

  const scenes: [string, Nodes][] = [
    ['two rooms, a 0.70 m door', twoRooms(0.7)],
    ['a bookcase in a corridor', corridorWithBookcase()],
  ]

  for (const [name, nodes] of scenes)
    test(`${name}: two named things are as far apart as the figure, one named thing is within its half width`, () => {
      const found = passages(nodes)
      expect(found.length).toBeGreaterThan(0)
      for (const issue of found) {
        const things = [...new Set(issue.obstacles.map((o) => o.nodeId))]
        if (things.length === 2)
          expect(Math.abs(gap(nodes, things[0]!, things[1]!) - issue.valueM!)).toBeLessThanOrEqual(
            0.02,
          )
        else
          for (const thing of things)
            expect(reach(nodes, issue, thing)).toBeLessThanOrEqual(issue.valueM! / 2 + 0.03)
      }
    })

  test('a bookcase against a wall names the two things the figure is the gap between', () => {
    const [issue] = passages(corridorWithBookcase()).filter((i) => i.place.room === 'Study')
    expect(new Set(issue!.obstacles.map((o) => o.nodeId)).size).toBe(2)
  })
})

describe('turning circles', () => {
  test('a room smaller than 1.50 m across has none', () => {
    const nodes = house([
      southWall,
      frontDoor,
      wall('wall_p', [1.4, 0], [1.4, 4]),
      zone('zone_closet', 'Closet', [
        [0.05, 0.05],
        [1.35, 0.05],
        [1.35, 3.95],
        [0.05, 3.95],
      ]),
    ])
    const found = issues(nodes).filter((i) => i.type === 'usage_turning_narrow')
    expect(found).toHaveLength(1)
    expect(found[0]!.valueM).toBeGreaterThan(1.2)
    expect(found[0]!.valueM).toBeLessThan(1.4)
    expect(found[0]!.message).toBe('No 1.50 m turning circle in “Closet”: largest 1.30 m.')
    // A turning circle measures the room: it informs, on an exact outline as well as an approximate one.
    expect(found[0]!.approximate).toBe(false)
    expect(found[0]!.severity).toBe('info')
  })

  test('a wide room has one', () => {
    expect(issues(twoRooms()).filter((i) => i.type === 'usage_turning_narrow')).toHaveLength(0)
  })
})

describe('pockets', () => {
  test('floor a unit fits in, cut off by a 0.50 m gap, is a pocket', () => {
    // a stub wall from the south wall leaves a 0.50 m gap to the north wall: the east side is cut off for a 0.60 m unit
    const nodes = house([
      southWall,
      frontDoor,
      wall('wall_p', [3, 0], [3, 3.5]),
      zone('zone_hall', 'Hall', [
        [0.05, 0.05],
        [5.95, 0.05],
        [5.95, 3.95],
        [0.05, 3.95],
      ]),
    ])
    const found = issues(nodes).filter((i) => i.type === 'usage_pocket')
    expect(found).toHaveLength(1)
    expect(found[0]!.valueM2).toBeGreaterThan(5)
    expect(found[0]!.message).toContain('no 0.60 m way out')
  })
})

describe('the flag', () => {
  afterEach(() => setSdfChecks(false))

  test('is off until a host turns it on', () => {
    expect(sdfChecksOn()).toBe(false)
  })

  test('verify_scene shows the findings only with it on', () => {
    const nodes = twoRooms(0.7)
    const context = { activeLevelId: null }
    const types = () =>
      (verifyScene(nodes, {}, context).result as { issues: { type: string }[] }).issues.map(
        (i) => i.type,
      )
    expect(types().some((t) => t.startsWith('usage_'))).toBe(false)
    setSdfChecks(true)
    expect(types()).toContain('usage_passage_narrow')
  })

  test('with it off verify_scene returns what it returned before the check existed', () => {
    const nodes = twoRooms(0.7)
    const context = { activeLevelId: null }
    const off = JSON.stringify(verifyScene(nodes, {}, context).result)
    setSdfChecks(true)
    setSdfChecks(false)
    expect(JSON.stringify(verifyScene(nodes, {}, context).result)).toBe(off)
    expect(off).not.toContain('usage_')
  })

  test('a model reads a narrow place as one entry, and the report and the asking give the findings whole', () => {
    setSdfChecks(true)
    const report = verifyScene(twoRooms(0.7), {}, { activeLevelId: null }).result as {
      issues: { type: string; place?: { room: string } }[]
    }
    // the report keeps each finding as measured
    const east = report.issues.filter((i) => i.place?.room === 'East room')
    expect(east.map((i) => i.type)).toEqual(['usage_passage_narrow'])

    const model = verifySceneModelResult(report, {}) as {
      issues: { type: string; message: string; nodeIds: string[]; count?: number }[]
      usageNote: string
    }
    // a narrow place is its own entry, the limit that applied with it and the entrance said once in the note; nothing else in the room, so no room entry
    const place = model.issues.find((i) => i.type === 'usage_passage_narrow')
    expect(place?.message).toBe(
      'Passage to “East room”: 0.60 m clear between the jambs of “Inner door”, a 0.70 m door (below 0.80 m, a doorway).',
    )
    expect(place?.nodeIds).toEqual(['door_inner'])
    expect(model.issues.some((i) => i.type === 'usage_room')).toBe(false)
    expect(model.usageNote).toContain('Ground-floor passages are measured from “Front door”.')

    const asked = verifySceneModelResult(report, { room: 'East room' }) as {
      issues: { type: string }[]
    }
    expect(asked.issues).toEqual(east)
    const byKind = verifySceneModelResult(report, { type: 'usage_passage_narrow' }) as {
      issues: unknown[]
    }
    expect(byKind.issues).toEqual(report.issues.filter((i) => i.type === 'usage_passage_narrow'))
  })
})
