import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import useScene from './use-scene'

type RawNode = Record<string, unknown>

function baseNode(id: string, type: string, parentId: string | null, extra: RawNode = {}): RawNode {
  return { object: 'node', id, type, parentId, visible: true, metadata: {}, ...extra }
}

function site(children: string[]): RawNode {
  return baseNode('site_test', 'site', null, { children })
}

function building(id: string, children: string[]): RawNode {
  return baseNode(id, 'building', 'site_test', { children })
}

function level(
  id: string,
  buildingId: string,
  ordinal: number,
  children: string[],
  extra: RawNode = {},
): RawNode {
  return baseNode(id, 'level', buildingId, { level: ordinal, children, ...extra })
}

function wall(
  id: string,
  levelId: string,
  start: [number, number],
  end: [number, number],
  height?: number,
): RawNode {
  return baseNode(id, 'wall', levelId, {
    start,
    end,
    children: [],
    ...(height !== undefined ? { height } : {}),
  })
}

function slab(
  id: string,
  levelId: string,
  polygon: Array<[number, number]>,
  elevation = 0.05,
): RawNode {
  return baseNode(id, 'slab', levelId, { polygon, holes: [], elevation })
}

function ceiling(
  id: string,
  levelId: string,
  polygon: Array<[number, number]>,
  height: number,
  extra: RawNode = {},
): RawNode {
  return baseNode(id, 'ceiling', levelId, { polygon, holes: [], height, ...extra })
}

function stair(id: string, levelId: string, extra: RawNode = {}): RawNode {
  return baseNode(id, 'stair', levelId, { position: [1, 0, 1], children: [], ...extra })
}

const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

function loadScene(nodes: Record<string, RawNode>): Record<string, AnyNode> {
  useScene.getState().setScene(nodes as unknown as Record<string, AnyNode>, ['site_test'] as never)
  return useScene.getState().nodes as Record<string, AnyNode>
}

type LevelResult = Extract<AnyNode, { type: 'level' }>
type WallResult = Extract<AnyNode, { type: 'wall' }>
type StairResult = Extract<AnyNode, { type: 'stair' }>
type SlabResult = Extract<AnyNode, { type: 'slab' }>
type CeilingResult = Extract<AnyNode, { type: 'ceiling' }>

describe('scene vertical model migration', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  test('default legacy storey derives height 2.5 and keeps walls plane-bound', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['slab_a', 'wall_a', 'wall_b']),
      slab_a: slab('slab_a', 'level_a', SQUARE),
      wall_a: wall('wall_a', 'level_a', [0, 0], [4, 0]),
      wall_b: wall('wall_b', 'level_a', [4, 0], [4, 4]),
    })

    expect((nodes.level_a as LevelResult).height).toBe(2.5)
    expect('height' in (nodes.wall_a as WallResult)).toBe(false)
    expect('height' in (nodes.wall_b as WallResult)).toBe(false)
  })

  test('hole pattern: walls within 0.20 of the plane become plane-bound', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['slab_a', 'wall_tall', 'wall_a', 'wall_b']),
      slab_a: slab('slab_a', 'level_a', SQUARE),
      wall_tall: wall('wall_tall', 'level_a', [0, 0], [4, 0], 2.65),
      wall_a: wall('wall_a', 'level_a', [4, 0], [4, 4]),
      wall_b: wall('wall_b', 'level_a', [0, 4], [4, 4]),
    })

    // Plane 0.05 + 2.65 = 2.7; absent walls top out at 2.55, 0.15 short.
    expect((nodes.level_a as LevelResult).height).toBe(0.05 + 2.65)
    expect('height' in (nodes.wall_tall as WallResult)).toBe(false)
    expect('height' in (nodes.wall_a as WallResult)).toBe(false)
    expect('height' in (nodes.wall_b as WallResult)).toBe(false)
  })

  test('intentional short walls at or beyond 0.20 keep their explicit height', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['ceiling_a', 'wall_a', 'wall_b']),
      ceiling_a: ceiling('ceiling_a', 'level_a', SQUARE, 2.5),
      wall_a: wall('wall_a', 'level_a', [0, 0], [4, 0], 2.3),
      wall_b: wall('wall_b', 'level_a', [4, 0], [4, 4], 2.1),
    })

    expect((nodes.level_a as LevelResult).height).toBe(2.5)
    expect((nodes.wall_a as WallResult).height).toBe(2.3)
    expect((nodes.wall_b as WallResult).height).toBe(2.1)
  })

  test('absent-height wall well short of the plane materializes the 2.5 default', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['ceiling_a', 'wall_a']),
      ceiling_a: ceiling('ceiling_a', 'level_a', SQUARE, 3.0),
      wall_a: wall('wall_a', 'level_a', [0, 0], [4, 0]),
    })

    expect((nodes.level_a as LevelResult).height).toBe(3.0)
    expect((nodes.wall_a as WallResult).height).toBe(2.5)
  })

  test('ordinal renumber compacts per building, anchored at zero', () => {
    const nodes = loadScene({
      site_test: site(['building_a', 'building_b']),
      building_a: building('building_a', ['level_a1', 'level_a2', 'level_a3']),
      building_b: building('building_b', ['level_b1', 'level_b2', 'level_b3', 'level_b4']),
      // Duplicate fractional ordinals (MCP wrote elevation params here).
      level_a1: level('level_a1', 'building_a', 2.5, []),
      level_a2: level('level_a2', 'building_a', 2.5, []),
      level_a3: level('level_a3', 'building_a', 5, []),
      // Basements compact upward toward -1, non-negatives down to 0.
      level_b1: level('level_b1', 'building_b', -3, []),
      level_b2: level('level_b2', 'building_b', -1, []),
      level_b3: level('level_b3', 'building_b', 0, []),
      level_b4: level('level_b4', 'building_b', 4, []),
    })

    expect((nodes.level_a1 as LevelResult).level).toBe(0)
    expect((nodes.level_a2 as LevelResult).level).toBe(1)
    expect((nodes.level_a3 as LevelResult).level).toBe(2)

    expect((nodes.level_b1 as LevelResult).level).toBe(-2)
    expect((nodes.level_b2 as LevelResult).level).toBe(-1)
    expect((nodes.level_b3 as LevelResult).level).toBe(0)
    expect((nodes.level_b4 as LevelResult).level).toBe(1)
  })

  test('near-bound ceiling heights become follows-mode', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a', 'level_b']),
      // Legacy default: ceiling 2.5 drives the derived level height 2.5,
      // so the clamp bound is 2.49 and |2.5 − 2.49| < 0.20 → follows.
      level_a: level('level_a', 'building_a', 0, ['ceiling_a']),
      ceiling_a: ceiling('ceiling_a', 'level_a', SQUARE, 2.5),
      // Already write-clamped default: 2.49 under a derived 2.49 level
      // (bound 2.48) → follows too.
      level_b: level('level_b', 'building_a', 1, ['ceiling_b']),
      ceiling_b: ceiling('ceiling_b', 'level_b', SQUARE, 2.49),
    })

    expect('height' in (nodes.ceiling_a as CeilingResult)).toBe(false)
    expect('height' in (nodes.ceiling_b as CeilingResult)).toBe(false)
  })

  test('an intentional low ceiling keeps its explicit height', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      // The 3.0 wall drives the plane; the 2.0 ceiling sits 0.99 under
      // the 2.99 bound — a deliberate dropped ceiling, kept explicit.
      level_a: level('level_a', 'building_a', 0, ['wall_tall', 'ceiling_low']),
      wall_tall: wall('wall_tall', 'level_a', [0, 0], [4, 0], 3.0),
      ceiling_low: ceiling('ceiling_low', 'level_a', SQUARE, 2.0),
    })

    expect((nodes.level_a as LevelResult).height).toBe(3.0)
    expect((nodes.ceiling_low as CeilingResult).height).toBe(2.0)
  })

  test('autoFromWalls ceilings always convert to follows-mode', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      // 2.2 is far from the 2.99 bound, but auto heights were always
      // derived by the sync — never user intent — so it drops anyway.
      level_a: level('level_a', 'building_a', 0, ['wall_tall', 'ceiling_auto']),
      wall_tall: wall('wall_tall', 'level_a', [0, 0], [4, 0], 3.0),
      ceiling_auto: ceiling('ceiling_auto', 'level_a', SQUARE, 2.2, { autoFromWalls: true }),
    })

    expect('height' in (nodes.ceiling_auto as CeilingResult)).toBe(false)
  })

  test('migrated scene keeps a near-bound ceiling height (gate respected)', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      // Post-migration scene (level carries height): a stored 2.49 IS a
      // deliberately typed value and must survive reloads.
      level_a: level('level_a', 'building_a', 0, ['ceiling_a', 'ceiling_auto'], { height: 2.5 }),
      ceiling_a: ceiling('ceiling_a', 'level_a', SQUARE, 2.49),
      ceiling_auto: ceiling('ceiling_auto', 'level_a', SQUARE, 2.49, { autoFromWalls: true }),
    })

    expect((nodes.ceiling_a as CeilingResult).height).toBe(2.49)
    expect((nodes.ceiling_auto as CeilingResult).height).toBe(2.49)
  })

  test('legacy scene drops totalRise 2.5 but keeps other rises', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['stair_a', 'stair_b']),
      stair_a: stair('stair_a', 'level_a', { totalRise: 2.5 }),
      stair_b: stair('stair_b', 'level_a', { totalRise: 3.1 }),
    })

    expect('totalRise' in (nodes.stair_a as StairResult)).toBe(false)
    expect((nodes.stair_b as StairResult).totalRise).toBe(3.1)
  })

  test('migrated scene keeps a deliberately typed totalRise 2.5', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['stair_a'], { height: 2.5 }),
      stair_a: stair('stair_a', 'level_a', { totalRise: 2.5 }),
    })

    expect((nodes.stair_a as StairResult).totalRise).toBe(2.5)
  })

  test('already-migrated level and its walls are untouched', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['slab_a', 'wall_a', 'wall_b'], { height: 4.0 }),
      slab_a: slab('slab_a', 'level_a', SQUARE),
      wall_a: wall('wall_a', 'level_a', [0, 0], [4, 0]),
      wall_b: wall('wall_b', 'level_a', [4, 0], [4, 4], 2.5),
    })

    expect((nodes.level_a as LevelResult).height).toBe(4.0)
    expect('height' in (nodes.wall_a as WallResult)).toBe(false)
    expect((nodes.wall_b as WallResult).height).toBe(2.5)
  })

  test('slab split writes thickness = elevation exactly for legacy solids', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['slab_a', 'slab_b']),
      slab_a: slab('slab_a', 'level_a', SQUARE, 0.3),
      slab_b: slab('slab_b', 'level_a', SQUARE, 0),
    })

    const raised = nodes.slab_a as SlabResult
    expect(raised.elevation).toBe(0.3)
    expect(raised.thickness).toBe(0.3)
    expect(raised.recessed).not.toBe(true)

    // Degenerate zero-elevation slab keeps its zero occupied interval —
    // migration never clamps to MIN_SLAB_THICKNESS.
    const flush = nodes.slab_b as SlabResult
    expect(flush.elevation).toBe(0)
    expect(flush.thickness).toBe(0)
  })

  test('slab split defaults an absent elevation to the effective 0.05 thickness', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['slab_a']),
      slab_a: baseNode('slab_a', 'slab', 'level_a', { polygon: SQUARE, holes: [] }),
    })

    expect((nodes.slab_a as SlabResult).thickness).toBe(0.05)
  })

  test('legacy pool becomes recessed with its elevation unchanged', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['slab_a']),
      slab_a: slab('slab_a', 'level_a', SQUARE, -0.15),
    })

    const pool = nodes.slab_a as SlabResult
    expect(pool.elevation).toBe(-0.15)
    expect(pool.recessed).toBe(true)
    expect(pool.thickness).toBe(0.05)
  })

  test('slab with thickness already present is untouched', () => {
    const nodes = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a']),
      level_a: level('level_a', 'building_a', 0, ['slab_a']),
      // A below-plane SOLID (already-split scene): the gate must not
      // reinterpret its negative elevation as a pool.
      slab_a: baseNode('slab_a', 'slab', 'level_a', {
        polygon: SQUARE,
        holes: [],
        elevation: -0.15,
        thickness: 0.3,
      }),
    })

    const deck = nodes.slab_a as SlabResult
    expect(deck.elevation).toBe(-0.15)
    expect(deck.thickness).toBe(0.3)
    expect('recessed' in deck).toBe(false)
  })

  test('migration is idempotent', () => {
    const first = loadScene({
      site_test: site(['building_a']),
      building_a: building('building_a', ['level_a', 'level_b']),
      level_a: level('level_a', 'building_a', 2.5, [
        'slab_a',
        'wall_tall',
        'wall_a',
        'stair_a',
        'stair_b',
      ]),
      level_b: level('level_b', 'building_a', 5, ['ceiling_b', 'wall_b']),
      slab_a: slab('slab_a', 'level_a', SQUARE),
      wall_tall: wall('wall_tall', 'level_a', [0, 0], [4, 0], 2.65),
      wall_a: wall('wall_a', 'level_a', [4, 0], [4, 4]),
      stair_a: stair('stair_a', 'level_a', { totalRise: 2.5 }),
      stair_b: stair('stair_b', 'level_a', { totalRise: 3.1 }),
      ceiling_b: ceiling('ceiling_b', 'level_b', SQUARE, 3.0),
      wall_b: wall('wall_b', 'level_b', [0, 0], [4, 0]),
    })

    const second = loadScene(structuredClone(first) as unknown as Record<string, RawNode>)

    expect(second).toEqual(first)
  })
})
