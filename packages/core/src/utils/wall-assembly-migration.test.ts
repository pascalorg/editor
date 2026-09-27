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
