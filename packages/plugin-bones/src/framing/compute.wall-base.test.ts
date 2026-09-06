/**
 * Walls the host's way (W11b):
 *
 *   - a wall with NO explicit height reaches the level's wall plane — the
 *     floor-to-floor line, or the underside of a covering slab of the
 *     storey above (core resolveWallTop / getWallPlaneTop) — not a 2.5 m
 *     default; an explicit height is kept;
 *   - a wall whose `supportSlabId` names a slab below the plate line (the
 *     garage pad at grade beside a raised platform) stands on that slab:
 *     its studs grow down to the pad, its sole plate is PT on the concrete,
 *     the stemwall under it tops out at the pad (no mudsill, bolts at the
 *     pad), and everything framed on it — layers, devices — moves with it.
 */
import { describe, expect, test } from 'bun:test'
import type { Member } from '../core/types'
import { computeLevel } from './compute'
import { FramingNode } from './schema'

const IN = 0.0254
type WallOpts = { exterior?: boolean; height?: number; supportSlabId?: string }
const wall = (id: string, start: [number, number], end: [number, number], opts: WallOpts = {}) => ({
  id,
  type: 'wall',
  parentId: 'lvl0',
  start,
  end,
  thickness: 0.14,
  ...(opts.height !== undefined ? { height: opts.height } : {}),
  ...(opts.supportSlabId ? { supportSlabId: opts.supportSlabId } : {}),
  frontSide: opts.exterior === false ? 'interior' : 'exterior',
  backSide: 'interior',
  children: [],
})
const slab = (
  id: string,
  level: string,
  polygon: [number, number][],
  elevation: number,
  thickness: number,
  floor?: string,
) => ({
  id,
  type: 'slab',
  name: id,
  parentId: level,
  polygon,
  holes: [],
  elevation,
  thickness,
  ...(floor ? { metadata: { floor } } : {}),
})

const HOUSE: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 7],
  [0, 7],
]
const GARAGE: [number, number][] = [
  [10, 0],
  [15, 0],
  [15, 6],
  [10, 6],
]

/** A raised (18 in) house with a garage wing on its pad at grade; `garageOnPad` puts the garage's walls on it. */
function raisedScene(garageOnPad: boolean, wallHeight?: number) {
  const ff = 18 * IN
  const g = (id: string, s: [number, number], e: [number, number]) =>
    wall(id, s, e, { height: wallHeight, ...(garageOnPad ? { supportSlabId: 'garage' } : {}) })
  const nodes: Record<string, Record<string, unknown>> = {
    bldg: {
      id: 'bldg',
      type: 'building',
      children: ['lvl0'],
      position: [0, ff, 0],
      metadata: { foundation: { type: 'raised', ffAboveGradeIn: 18 } },
    },
    lvl0: {
      id: 'lvl0',
      type: 'level',
      parentId: 'bldg',
      level: 0,
      height: 2.7432,
      children: ['wa', 'wb', 'wc', 'wd', 'ga', 'gb', 'gc', 'floor', 'garage'],
    },
    wa: wall('wa', [0, 0], [10, 0], { height: wallHeight }),
    wb: wall('wb', [10, 0], [10, 7], { height: wallHeight }),
    wc: wall('wc', [10, 7], [0, 7], { height: wallHeight }),
    wd: wall('wd', [0, 7], [0, 0], { height: wallHeight }),
    ga: g('ga', [10, 0], [15, 0]),
    gb: g('gb', [15, 0], [15, 6]),
    gc: g('gc', [15, 6], [10, 6]),
    floor: slab('floor', 'lvl0', HOUSE, 0.05, 0.019, 'platform'),
    garage: slab('garage', 'lvl0', GARAGE, 0.05 - ff, 0.1016, 'garage-slab-at-grade'),
  }
  return nodes
}

const bones = (level = 'lvl0') =>
  FramingNode.parse({
    id: 'bonesframing_t',
    parentId: level,
    jurisdiction: 'INTL',
    detail: '300',
  }) as FramingNode
const roles = (members: Member[], role: string): Member[] => members.filter((m) => m.role === role)
const of = (members: Member[], id: string) => members.filter((m) => m.sourceId === id)
const top = (m: Member) => m.position[1]! + m.dims[1]! / 2
const bottom = (m: Member) => m.position[1]! - m.dims[1]! / 2

describe('wall heights from the level', () => {
  test('a wall with no height reaches the level plane; an explicit height is kept', () => {
    const r = computeLevel(raisedScene(false), bones())
    const studs = roles(of(r.members, 'wa'), 'stud')
    expect(studs.length).toBeGreaterThan(3)
    // cap plate top = level height
    const caps = roles(of(r.members, 'wa'), 'top-plate')
    expect(caps.length).toBeGreaterThan(0)
    expect(Math.max(...caps.map(top))).toBeCloseTo(2.7432, 4)
    const explicit = computeLevel(raisedScene(false, 2.4), bones())
    expect(Math.max(...roles(of(explicit.members, 'wa'), 'top-plate').map(top))).toBeCloseTo(2.4, 4)
  })

  test('under a storey whose slab is 4 in thick the walls stop at its underside', () => {
    const nodes = raisedScene(false)
    nodes.bldg = { ...nodes.bldg, children: ['lvl0', 'lvl1'] }
    nodes.lvl1 = {
      id: 'lvl1',
      type: 'level',
      parentId: 'bldg',
      level: 1,
      height: 2.7432,
      children: ['upper', 'ua'],
    }
    nodes.upper = slab('upper', 'lvl1', HOUSE, 0.05, 0.1016)
    nodes.ua = wall('ua', [0, 0], [10, 0])
    ;(nodes.ua as Record<string, unknown>).parentId = 'lvl1'
    const r = computeLevel(nodes, bones())
    const caps = roles(of(r.members, 'wa'), 'top-plate')
    expect(Math.max(...caps.map(top))).toBeCloseTo(2.7432 + 0.05 - 0.1016, 4)
    // the garage wing has no slab over it: its walls keep the floor-to-floor line
    expect(Math.max(...roles(of(r.members, 'gb'), 'top-plate').map(top))).toBeCloseTo(2.7432, 4)
  })
})

describe('garage walls on their pad at grade beside a raised platform', () => {
  const r = computeLevel(raisedScene(true), bones())
  const grade = -18 * IN

  test('the studs grow down to the pad, the sole plate is PT on the concrete, the top stays at the plane', () => {
    for (const id of ['ga', 'gb', 'gc']) {
      const ms = of(r.members, id)
      const plates = roles(ms, 'bottom-plate')
      expect(plates.length).toBeGreaterThan(0)
      for (const p of plates) {
        expect(bottom(p)).toBeCloseTo(grade, 6)
        expect(p.material).toBe('pt-lumber')
      }
      expect(Math.max(...roles(ms, 'top-plate').map(top))).toBeCloseTo(2.7432, 4)
      const studs = roles(ms, 'stud')
      expect(studs.length).toBeGreaterThan(3)
      expect(Math.max(...studs.map((s) => s.dims[1]!))).toBeGreaterThan(2.7432 + 0.3)
    }
    // the house walls are untouched: untreated plates on the platform, top at the plane
    const house = of(r.members, 'wa')
    for (const p of roles(house, 'bottom-plate')) {
      expect(bottom(p)).toBeCloseTo(0, 6)
      expect(p.material).toBe('lumber')
    }
    expect(r.warnings.some((w) => /on the garage pad at grade/.test(w))).toBe(true)
  })

  test('the stemwall under them tops out at the pad, no mudsill, bolts seat at the pad; the house keeps its mudsill', () => {
    for (const id of ['ga', 'gb', 'gc']) {
      const ms = of(r.members, id)
      for (const s of roles(ms, 'stemwall')) expect(top(s)).toBeCloseTo(grade, 6)
      expect(roles(ms, 'mudsill')).toHaveLength(0)
      const bolts = roles(ms, 'anchor-bolt')
      expect(bolts.length).toBeGreaterThanOrEqual(2)
      for (const b of bolts) expect(bottom(b)).toBeCloseTo(grade - 7 * IN, 6)
    }
    const houseStem = roles(of(r.members, 'wa'), 'stemwall')
    expect(houseStem.length).toBeGreaterThan(0)
    for (const s of houseStem) expect(top(s)).toBeLessThan(-0.01)
    expect(roles(of(r.members, 'wa'), 'mudsill').length).toBeGreaterThan(0)
  })

  test('the layers and devices on a garage wall move down with it', () => {
    const ms = of(r.members, 'gb')
    const sheathing = roles(ms, 'sheathing')
    expect(sheathing.length).toBeGreaterThan(0)
    expect(Math.min(...sheathing.map(bottom))).toBeLessThan(-0.3)
    const plain = computeLevel(raisedScene(false), bones())
    const receptacles = (ms2: Member[]) =>
      ms2.filter((m) => /receptacle|outlet/i.test(m.label ?? ''))
    const lifted = receptacles(of(plain.members, 'gb'))
    const dropped = receptacles(ms)
    if (lifted.length > 0 && dropped.length > 0) {
      expect(Math.min(...dropped.map((m) => m.position[1]!))).toBeCloseTo(
        Math.min(...lifted.map((m) => m.position[1]!)) + grade,
        4,
      )
    }
  })

  test('the pad still pours at grade and nothing else about the house changes', () => {
    const fields = roles(r.members, 'slab')
    expect(fields.length).toBeGreaterThan(0)
    for (const f of fields) expect(top(f)).toBeCloseTo(grade, 6)
    const plain = computeLevel(raisedScene(false), bones())
    const houseIds = new Set(['wa', 'wb', 'wc', 'wd', 'floor'])
    const keep = (ms: Member[]) => ms.filter((m) => houseIds.has(m.sourceId))
    expect(keep(r.members).length).toBe(keep(plain.members).length)
  })
})
