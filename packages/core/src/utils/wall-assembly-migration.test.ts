import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, WallAssembly, WallNode } from '../schema'
import { Assembly } from '../schema/assembly'
import useScene from '../store/use-scene'
import * as ws5 from '../systems/wall/__fixtures__/wall-assembly-ws5'
import {
  assemblyThickness,
  calculateLevelLayerMiters,
  getWallLayerPolylines,
  resolveWallAssembly,
  wallAssemblyFinishRef,
  wallAssemblyFromLegacy,
  wallAssemblyToLegacy,
  wallAssemblyUnverifiedNote,
  wallLayerBoundaryOffsets,
} from '../systems/wall/wall-assembly'
import { calculateLevelMiters } from '../systems/wall/wall-mitering'
import fixture from './__fixtures__/ws5-architect-walls.json'
import { migrateLegacyWallAssemblies } from './wall-assembly-migration'

/**
 * Walls exactly as #937 (editor b53a907b7) stored them: the Architect's
 * `buildHouse(POPPY)` in both wall systems, plus inspector writes (a custom
 * brick stack, a partition, a furred CMU wall) and a wall with no assembly.
 */
type LegacyWall = Omit<WallNode, 'assembly'> & { assembly?: WallAssembly }
const stored = fixture.nodes as unknown as Record<string, LegacyWall | AnyNode>
const legacyWalls = Object.values(stored).filter((n): n is LegacyWall => n.type === 'wall')
const migrated = migrateLegacyWallAssemblies(stored)
const f2Walls = legacyWalls.map((w) => migrated.nodes[w.id] as WallNode)
const SIDES = [
  undefined,
  { frontSide: 'exterior', backSide: 'interior' },
  { frontSide: 'interior', backSide: 'exterior' },
  { frontSide: 'unknown', backSide: 'unknown' },
] as const
const withSides = <T extends { frontSide?: string; backSide?: string }>(
  wall: T,
  sides: (typeof SIDES)[number],
) => (sides ? { ...wall, ...sides } : wall)

describe('WS5 → F2 wall assembly migration', () => {
  test('converts every WS5 stack to valid F2 layers and keeps every other field', () => {
    expect(migrated.changed).toBe(true)
    expect(legacyWalls.filter((w) => w.assembly)).toHaveLength(32)
    for (const legacy of legacyWalls) {
      const next = migrated.nodes[legacy.id] as WallNode
      const { assembly: before, ...rest } = legacy
      const { assembly: after, ...nextRest } = next
      expect(nextRest).toEqual(rest)
      if (!before) {
        expect(after).toBeUndefined()
        continue
      }
      expect(Assembly.safeParse(after).success).toBe(true)
      // The stack sets the body, and the body did not move.
      expect(assemblyThickness(after!)).toBeCloseTo(ws5.assemblyThickness(before), 12)
    }
  })

  test('is idempotent and leaves F2 stacks alone', () => {
    const again = migrateLegacyWallAssemblies(migrated.nodes)
    expect(again.changed).toBe(false)
    expect(again.nodes).toBe(migrated.nodes)
  })

  test('the Architect reads the same stack: layers, sides, finish and preset note', () => {
    for (const [index, legacy] of legacyWalls.entries()) {
      const next = f2Walls[index]!
      for (const sides of SIDES) {
        const was = withSides(legacy, sides)
        const now = withSides(next, sides)
        expect(resolveWallAssembly(now)).toEqual(ws5.resolveWallAssembly(was))
        expect(wallLayerBoundaryOffsets(now)).toEqual(ws5.wallLayerBoundaryOffsets(was))
        expect(wallLayerBoundaryOffsets(now, 0.3)).toEqual(ws5.wallLayerBoundaryOffsets(was, 0.3))
      }
      expect(wallAssemblyFinishRef(next)).toBe(ws5.wallAssemblyFinishRef(legacy))
      expect(wallAssemblyUnverifiedNote(next)).toBe(ws5.wallAssemblyUnverifiedNote(legacy))
    }
  })

  test('the 2D layer lines are identical, corners and junctions included', () => {
    const before = ws5.calculateLevelLayerMiters(
      legacyWalls,
      calculateLevelMiters(legacyWalls as unknown as WallNode[]),
      (w) => ws5.wallLayerBoundaryOffsets(w),
    )
    const after = calculateLevelLayerMiters(f2Walls, calculateLevelMiters(f2Walls), (w) =>
      wallLayerBoundaryOffsets(w),
    )
    for (const [index, legacy] of legacyWalls.entries()) {
      const next = f2Walls[index]!
      expect(getWallLayerPolylines(next, after, wallLayerBoundaryOffsets(next))).toEqual(
        ws5.getWallLayerPolylines(legacy, before, ws5.wallLayerBoundaryOffsets(legacy)),
      )
    }
  })

  test('the inspector view round-trips the WS5 stack', () => {
    for (const legacy of legacyWalls) {
      if (!legacy.assembly) continue
      const view = wallAssemblyToLegacy(wallAssemblyFromLegacy(legacy.assembly))
      expect(view).not.toBeNull()
      expect(wallAssemblyFromLegacy(view!)).toEqual(wallAssemblyFromLegacy(legacy.assembly))
      expect(ws5.resolveWallAssembly({ ...legacy, assembly: view! })).toEqual(
        ws5.resolveWallAssembly(legacy),
      )
    }
  })

  test('the inspector view refuses a stack whose layers carry what WS5 would drop', () => {
    const base = wallAssemblyFromLegacy({
      framing: { kind: 'wood', depth: 0.1397 },
      exterior: { finish: 'stucco', thickness: 0.0222 },
      sheathing: { material: 'osb', thickness: 0.0111 },
      interior: { finish: 'drywall', thickness: 0.0127 },
    })
    expect(wallAssemblyToLegacy(base)).not.toBeNull()
    const with1 = (index: number, patch: Record<string, unknown>) => ({
      ...base,
      layers: base.layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)),
    })
    expect(wallAssemblyToLegacy(with1(0, { src: 'al:wall-01/outside-finish' }))).toBeNull()
    expect(wallAssemblyToLegacy(with1(0, { id: 'stucco-coat' }))).toBeNull()
    expect(wallAssemblyToLegacy(with1(2, { slot: 'exterior' }))).toBeNull()
    expect(wallAssemblyToLegacy(with1(0, { returns: true }))).toBeNull()
    expect(wallAssemblyToLegacy(with1(3, { display: 'construction' }))).toBeNull()
  })

  test('a stack WS5 cannot express has no inspector view', () => {
    const generic = Assembly.parse({
      layers: [
        { id: 'lining', role: 'lining', thickness: 0.0127 },
        { id: 'studs', role: 'structure', thickness: 0.0889, core: true },
        { id: 'membrane', role: 'membrane', thickness: 0.001 },
      ],
    })
    expect(wallAssemblyToLegacy(generic)).toBeNull()
  })

  test('the inspector refuses canonical-looking stacks that would change on write', () => {
    const partition = wallAssemblyFromLegacy({
      framing: { kind: 'wood', depth: 0.0889 },
      interior: { finish: 'drywall', thickness: 0.0127 },
    })
    const brick = wallAssemblyFromLegacy({
      exterior: { finish: 'brick', thickness: 0.13 },
      framing: { kind: 'wood', depth: 0.1397 },
    })
    const stacks = [
      { ...partition, layers: partition.layers.filter((layer) => layer.id !== 'interior-back') },
      {
        ...partition,
        layers: partition.layers.map((layer) => ({
          ...layer,
          id:
            layer.id === 'interior'
              ? 'interior-back'
              : layer.id === 'interior-back'
                ? 'interior'
                : layer.id,
        })),
      },
      {
        ...partition,
        layers: partition.layers.map((layer) =>
          layer.core ? { ...layer, material: 'concrete' } : layer,
        ),
      },
      {
        ...brick,
        layers: brick.layers
          .filter((layer) => layer.role !== 'air')
          .map((layer) => (layer.role === 'finish' ? { ...layer, thickness: 0.13 } : layer)),
      },
      {
        ...brick,
        layers: brick.layers.map((layer) =>
          layer.role === 'air' ? { ...layer, material: 'ventilated' } : layer,
        ),
      },
    ]
    for (const stack of stacks) {
      expect(Assembly.safeParse(stack).success).toBe(true)
      expect(wallAssemblyToLegacy(stack)).toBeNull()
    }
  })

  test('malformed legacy candidates remain available for normal validation without throwing', () => {
    for (const assembly of [{ framing: null }, { framing: [] }, { framing: { kind: 'wood' } }]) {
      const nodes = { wall_invalid: { type: 'wall', assembly } }
      expect(() => migrateLegacyWallAssemblies(nodes)).not.toThrow()
      expect(migrateLegacyWallAssemblies(nodes)).toEqual({ changed: false, nodes })
    }
  })
})

describe('the scene loader migrates stored WS5 walls', () => {
  let savedRaf: typeof requestAnimationFrame
  let savedCancelRaf: typeof cancelAnimationFrame
  beforeEach(() => {
    savedRaf = globalThis.requestAnimationFrame
    savedCancelRaf = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
      materials: {},
      readOnly: false,
    } as never)
    useScene.temporal.getState().clear()
  })
  afterEach(() => {
    globalThis.requestAnimationFrame = savedRaf
    globalThis.cancelAnimationFrame = savedCancelRaf
  })

  test('load converts them; the thickness and the drawing stay', () => {
    useScene
      .getState()
      .setScene(
        JSON.parse(JSON.stringify(fixture.nodes)) as Record<AnyNodeId, AnyNode>,
        ['level_ground'] as AnyNodeId[],
      )
    const nodes = useScene.getState().nodes
    for (const legacy of legacyWalls) {
      const loaded = nodes[legacy.id as AnyNodeId] as WallNode
      expect(loaded.thickness).toBe(legacy.thickness)
      expect(loaded.assembly).toEqual(
        migrated.nodes[legacy.id] ? (migrated.nodes[legacy.id] as WallNode).assembly : undefined,
      )
      expect(resolveWallAssembly(loaded)).toEqual(ws5.resolveWallAssembly(legacy))
    }
  })
})
