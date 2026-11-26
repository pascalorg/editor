import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { isAgentRefusal, setWallTrimTool } from '../agent-tools'
import { setWallGeometry } from '../commands/structure'
import { type WallNode, WallNode as WallSchema } from '../schema'
import { twoRooms } from './__fixtures__/dressing-scenes'
import { applySceneChanges, readRooms, setWallTrim } from './index'
import type { SceneNodes } from './types'

// Analytic fixture: salon lies left of the north-running partition (face a),
// bath right (face b); both lie on face a of the 8 m south wall.
// These expectations come from room geometry, not the room-face implementation.
const scene = () => twoRooms().nodes
const context = { activeLevelId: 'level_0' }
const wall = (nodes: SceneNodes, id: string) => nodes[id] as WallNode
const run = (nodes: SceneNodes, input: Parameters<typeof setWallTrim>[1]) => {
  const outcome = setWallTrim(nodes, input, context)
  return { ...outcome, nodes: applySceneChanges(nodes, outcome.changes) as SceneNodes }
}
const refusal = (action: () => unknown) => {
  try {
    action()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  throw new Error('expected a refusal')
}

describe('generalized native wall trim', () => {
  test('room readback does not count a neighbor-only stretch as its own skirting', () => {
    const nodes = scene()
    nodes.wall_s = WallSchema.parse({
      ...nodes.wall_s,
      skirting: { enabled: true, sides: 'a', spans: [{ face: 'a', u0: 0, u1: 4 }] },
    })
    const rooms = readRooms(nodes)
    expect(rooms.find(({ id }) => id === 'zone_salon')?.skirting).toEqual({
      faces: 4,
      withSkirting: 1,
    })
    expect(rooms.find(({ id }) => id === 'zone_bath')?.skirting).toEqual({
      faces: 4,
      withSkirting: 0,
    })
  })

  test('room trims stop at its stretch of a shared wall, including after save and reload', () => {
    for (const kind of ['skirting', 'crown', 'chairRail'] as const) {
      const after = run(scene(), { kind, zoneIds: ['zone_salon'] }).nodes
      const saved = WallSchema.parse(JSON.parse(JSON.stringify(after.wall_s)))
      expect(saved[kind]?.spans).toEqual([{ face: 'a', u0: 0, u1: 4 }])
      const bath = run(scene(), { kind, zoneIds: ['zone_bath'] }).nodes
      expect(wall(bath, 'wall_s')[kind]?.spans).toEqual([{ face: 'a', u0: 4, u1: 8 }])
    }
  })

  test('accepts zero chair-rail offset in both the public contract and operation', () => {
    const input = { kind: 'chairRail', zoneIds: ['zone_salon'], offsetY: 0 } as const
    expect(
      z.object(setWallTrimTool.input).safeParse({ ...input, zoneIds: [...input.zoneIds] }).success,
    ).toBe(true)
    const after = run(scene(), { ...input, zoneIds: [...input.zoneIds] }).nodes
    expect(wall(after, 'wall_p').chairRail).toMatchObject({ enabled: true, sides: 'a', offsetY: 0 })
  })

  test('room writes preserve neighboring coverage and room hide removes only its own stretch', () => {
    const salon = run(scene(), { kind: 'skirting', zoneIds: ['zone_salon'] }).nodes
    const both = run(salon, { kind: 'skirting', zoneIds: ['zone_bath'] }).nodes
    const hidden = run(both, { kind: 'skirting', zoneIds: ['zone_salon'], enabled: false }).nodes
    expect(wall(hidden, 'wall_s').skirting).toMatchObject({
      enabled: true,
      spans: [{ face: 'a', u0: 4, u1: 8 }],
    })
    expect(wall(hidden, 'wall_p').skirting).toMatchObject({ enabled: true, sides: 'b' })
    expect(wall(hidden, 'wall_e').skirting).toEqual(wall(both, 'wall_e').skirting)
  })

  test('room targeting preserves legacy whole-face coverage rather than clipping hand-authored trim', () => {
    const nodes = scene()
    nodes.wall_s = WallSchema.parse({
      ...nodes.wall_s,
      skirting: { enabled: true, sides: 'a', height: 0.12, proud: 0.02 },
    })
    const after = run(nodes, { kind: 'skirting', zoneIds: ['zone_salon'] }).nodes
    const trim = wall(after, 'wall_s').skirting!
    expect(trim.enabled).toBe(true)
    expect(trim.sides).toBe('a')
    const coverage = trim.spans ?? [{ face: 'a', u0: 0, u1: 8 }]
    expect(
      coverage.some((span) => span.face === 'a' && (span.u0 ?? 0) <= 0 && (span.u1 ?? 8) >= 8),
    ).toBe(true)
  })

  test('an explicitly selected wall extends the same room-targeted face to the whole wall', () => {
    const after = run(scene(), {
      kind: 'chairRail',
      zoneIds: ['zone_salon'],
      wallIds: ['wall_s'],
    }).nodes
    const trim = wall(after, 'wall_s').chairRail!
    const coverage = trim.spans ?? [{ face: 'a', u0: 0, u1: 8 }]
    expect(
      coverage.some((span) => span.face === 'a' && (span.u0 ?? 0) <= 0 && (span.u1 ?? 8) >= 8),
    ).toBe(true)
  })

  test('room and explicit wall targets form a union, including opposite room faces', () => {
    const { result, nodes } = run(scene(), {
      kind: 'crown',
      zoneIds: ['zone_salon'],
      wallIds: ['wall_e'],
    })
    expect((result.walls as { id: string }[]).map(({ id }) => id).sort()).toEqual([
      'wall_an',
      'wall_e',
      'wall_p',
      'wall_s',
      'wall_w',
    ])
    expect(wall(nodes, 'wall_p').crown).toMatchObject({ enabled: true, sides: 'a' })
    expect(wall(nodes, 'wall_e').crown).toMatchObject({ enabled: true, sides: 'a' })
    const both = run(scene(), { kind: 'crown', zoneIds: ['zone_salon', 'zone_bath'] }).nodes
    expect(wall(both, 'wall_p').crown).toMatchObject({ enabled: true, sides: 'both' })
  })

  test('finishes only the requested trim slots, preserving wall paint and other kinds', () => {
    const nodes = scene()
    nodes.wall_p = { ...wall(nodes, 'wall_p'), slots: { a: '#123456', bCrown: '#654321' } }
    const after = run(nodes, {
      kind: 'chairRail',
      zoneIds: ['zone_bath'],
      finish: 'library:preset-white',
    }).nodes
    expect(wall(after, 'wall_p').chairRail).toMatchObject({ sides: 'b' })
    expect(wall(after, 'wall_p').slots).toEqual({
      a: '#123456',
      bCrown: '#654321',
      bChairRail: 'library:preset-white',
    })
    expect(wall(after, 'wall_p').crown).toBeUndefined()
    expect(wall(after, 'wall_w')).toEqual(wall(nodes, 'wall_w'))
  })

  test('hiding each trim preserves its dimensions, profile and finish', () => {
    for (const kind of ['skirting', 'crown', 'chairRail'] as const) {
      const shown = run(scene(), {
        kind,
        wallIds: ['wall_w'],
        height: 0.16,
        depth: 0.03,
        profile: 'bevel',
        finish: '#abcdef',
        ...(kind === 'chairRail' ? { offsetY: 0 } : {}),
      }).nodes
      const hidden = run(shown, { kind, wallIds: ['wall_w'], enabled: false }).nodes
      expect(wall(hidden, 'wall_w')[kind]).toEqual({
        ...wall(shown, 'wall_w')[kind],
        enabled: false,
      })
      expect(wall(hidden, 'wall_w').slots).toEqual(wall(shown, 'wall_w').slots)
    }
  })

  test('wall movement retains all native trims', () => {
    let nodes: SceneNodes = scene()
    for (const kind of ['skirting', 'crown', 'chairRail'] as const)
      nodes = run(nodes, { kind, wallIds: ['wall_w'], height: 0.15 }).nodes
    const plan = setWallGeometry(nodes, {
      wallId: 'wall_w',
      start: [-1, 3],
      end: [-1, 0],
      mintId: (kind) => `${kind}_moved`,
    })
    const change = plan.changes.find((entry) => entry.op === 'update' && entry.id === 'wall_w')
    if (change?.op !== 'update') throw new Error('expected wall movement')
    const moved = { ...wall(nodes, 'wall_w'), ...change.data } as WallNode
    expect(moved.start).toEqual([-1, 3])
    for (const kind of ['skirting', 'crown', 'chairRail'] as const)
      expect(moved[kind]).toEqual(wall(nodes, 'wall_w')[kind])
  })

  test('unsupported walls refuse a mixed request without mutating any wall', () => {
    for (const wallType of ['curtain', 'railing'] as const) {
      const nodes = scene()
      nodes.wall_e = { ...wall(nodes, 'wall_e'), wallType }
      const before = structuredClone(nodes)
      expect(
        refusal(() =>
          run(nodes, {
            kind: 'crown',
            wallIds: ['wall_w', 'wall_e'],
            faces: 'both',
          }),
        ),
      ).toBe(`${wallType}_wall`)
      expect(nodes).toEqual(before)
    }
  })

  test('room targeting cannot bypass the railing refusal', () => {
    const nodes = scene()
    nodes.wall_w = { ...wall(nodes, 'wall_w'), wallType: 'railing' }
    const before = structuredClone(nodes)
    expect(refusal(() => run(nodes, { kind: 'chairRail', zoneIds: ['zone_salon'] }))).toBe(
      'railing_wall',
    )
    expect(nodes).toEqual(before)
  })

  test('saved legacy full-wall trims load unchanged without requiring new span fields', () => {
    const saved = {
      id: 'wall_saved',
      parentId: 'level_0',
      start: [0, 0],
      end: [8, 0],
      skirting: { enabled: true, sides: 'both', height: 0.12, proud: 0.02, profile: 'flat' },
      crown: { enabled: false, sides: 'a', height: 0.14, proud: 0.05, profile: 'crown-ogee' },
      chairRail: {
        enabled: true,
        sides: 'b',
        height: 0.06,
        proud: 0.03,
        profile: 'rail-ogee',
        offsetY: 0,
      },
      slots: { aSkirting: '#ffffff', bChairRail: '#112233' },
    }
    const loaded = WallSchema.parse(JSON.parse(JSON.stringify(saved)))
    expect(loaded).toMatchObject(saved)
    expect(WallSchema.parse(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded)
    expect(
      WallSchema.parse({ id: 'wall_plain', start: [0, 0], end: [1, 0] }).skirting,
    ).toBeUndefined()
  })
})
