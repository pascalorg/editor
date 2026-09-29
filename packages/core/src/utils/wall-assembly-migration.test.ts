import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, WallAssembly, WallNode } from '../schema'
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
import fixture from './__fixtures__/ws5-synthetic-walls.json'
import { migrateLegacyWallAssemblies } from './wall-assembly-migration'

/**
 * Synthetic corners and junctions retain WS5's stored shape across wood,
 * brick, partition and furred CMU stacks, plus a wall with no assembly.
 */
type LegacyWall = Omit<WallNode, 'assembly'> & { assembly?: WallAssembly }
const stored = fixture.nodes as unknown as Record<string, LegacyWall | AnyNode>
const legacyWalls = Object.values(stored).filter((n): n is LegacyWall => n.type === 'wall')
const migrated = migrateLegacyWallAssemblies(stored)
const f2Walls = legacyWalls.map((w) => migrated.nodes[w.id] as WallNode)
const unboundedLegacyStacks: [string, WallAssembly][] = [
  [
    'long cavity note',
    { framing: { kind: 'wood', depth: 0.14 }, cavityInsulation: 'a'.repeat(121) },
  ],
  ['long preset id', { framing: { kind: 'wood', depth: 0.14 }, preset: 'a'.repeat(81) }],
  ['empty cavity note', { framing: { kind: 'wood', depth: 0.14 }, cavityInsulation: '' }],
  ['empty preset id', { framing: { kind: 'wood', depth: 0.14 }, preset: '' }],
  ['deep framing', { framing: { kind: 'wood', depth: 5.001 } }],
  [
    'thick exterior',
    { framing: { kind: 'wood', depth: 0.14 }, exterior: { finish: 'stone', thickness: 5.001 } },
  ],
  [
    'deep brick air space',
    { framing: { kind: 'wood', depth: 0.14 }, exterior: { finish: 'brick', thickness: 5.2 } },
  ],
  [
    'thick sheathing',
    { framing: { kind: 'wood', depth: 0.14 }, sheathing: { material: 'osb', thickness: 5.001 } },
  ],
  [
    'thick partition linings',
    { framing: { kind: 'wood', depth: 0.14 }, interior: { finish: 'drywall', thickness: 5.001 } },
  ],
]
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

/**
 * F2 draws an undetermined outside on side B, where the 3D cladding goes; WS5
 * drew it on the front. The WS5 reference pins only that choice to side B, so
 * every other part of the stack and the drawing is compared as WS5 made it.
 */
const outsideOnB = <T extends { frontSide?: string; backSide?: string }>(wall: T): T =>
  ws5.resolveWallExteriorSide(wall as ws5.WallAssemblySideSource) === null
    ? { ...wall, frontSide: 'interior', backSide: 'exterior' }
    : wall
const ws5Resolved = (wall: Parameters<typeof ws5.resolveWallAssembly>[0]) => {
  const resolved = ws5.resolveWallAssembly(wall)
  return { ...resolved, exteriorSideResolved: resolved.exteriorSide ?? -1 }
}

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

  test.each(
    unboundedLegacyStacks,
  )('preserves valid WS5 values without upper caps: %s', (_, assembly) => {
    expect(WallAssembly.safeParse(assembly).success).toBe(true)
    const legacy = {
      ...WallNode.parse({ id: 'wall_unbounded', start: [0, 0], end: [4, 0] }),
      assembly,
      thickness: ws5.assemblyThickness(assembly),
    }
    const nodes = { [legacy.id]: legacy }
    const result = migrateLegacyWallAssemblies(nodes)
    const wall = WallNode.parse(result.nodes[legacy.id])
    const stack = wall.assembly!

    expect(result.changed).toBe(true)
    expect(nodes[legacy.id]).toBe(legacy)
    expect(nodes[legacy.id].assembly).toBe(assembly)
    expect(wall.thickness).toBe(legacy.thickness)
    expect(assemblyThickness(stack)).toBeCloseTo(legacy.thickness, 12)
    expect(stack.presetId).toBe(assembly.preset)
    expect(stack.cavityInsulation).toBe(assembly.cavityInsulation)
    expect(wallAssemblyToLegacy(stack)).toEqual(assembly)
    expect(resolveWallAssembly(wall)).toEqual(ws5Resolved(legacy))
    expect(migrateLegacyWallAssemblies(result.nodes)).toEqual({
      changed: false,
      nodes: result.nodes,
    })
  })

  test('readers see the same stack: layers, sides, finish and preset note', () => {
    for (const [index, legacy] of legacyWalls.entries()) {
      const next = f2Walls[index]!
      for (const sides of SIDES) {
        const was = withSides(legacy, sides)
        const now = withSides(next, sides)
        expect(resolveWallAssembly(now)).toEqual(ws5Resolved(was))
        expect(wallLayerBoundaryOffsets(now)).toEqual(ws5.wallLayerBoundaryOffsets(outsideOnB(was)))
        expect(wallLayerBoundaryOffsets(now, 0.3)).toEqual(
          ws5.wallLayerBoundaryOffsets(outsideOnB(was), 0.3),
        )
      }
      expect(wallAssemblyFinishRef(next)).toBe(ws5.wallAssemblyFinishRef(legacy))
      expect(wallAssemblyUnverifiedNote(next)).toBe(ws5.wallAssemblyUnverifiedNote(legacy))
    }
  })

  test('the 2D layer lines are identical, corners and junctions included', () => {
    const legacyOnB = legacyWalls.map(outsideOnB)
    const before = ws5.calculateLevelLayerMiters(
      legacyOnB,
      calculateLevelMiters(legacyOnB as unknown as WallNode[]),
      (w) => ws5.wallLayerBoundaryOffsets(w),
    )
    const after = calculateLevelLayerMiters(f2Walls, calculateLevelMiters(f2Walls), (w) =>
      wallLayerBoundaryOffsets(w),
    )
    for (const [index, legacy] of legacyOnB.entries()) {
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
        ['level_synthetic_walls'] as AnyNodeId[],
      )
    const nodes = useScene.getState().nodes
    for (const legacy of legacyWalls) {
      const loaded = nodes[legacy.id as AnyNodeId] as WallNode
      expect(loaded.thickness).toBe(legacy.thickness)
      expect(loaded.assembly).toEqual(
        migrated.nodes[legacy.id] ? (migrated.nodes[legacy.id] as WallNode).assembly : undefined,
      )
      // Load re-derives wall sides from the detected rooms; the stack follows them.
      expect(resolveWallAssembly(loaded)).toEqual(
        ws5Resolved({
          ...legacy,
          frontSide: loaded.frontSide,
          backSide: loaded.backSide,
        }),
      )
    }
  })

  test('load and serialize retain legacy values above the former F2 caps', () => {
    const walls = unboundedLegacyStacks.map(([_, assembly], index) => ({
      ...WallNode.parse({ id: `wall_unbounded${index}`, start: [0, index], end: [4, index] }),
      assembly,
      thickness: ws5.assemblyThickness(assembly),
    }))
    useScene
      .getState()
      .setScene(
        Object.fromEntries(walls.map((wall) => [wall.id, wall])) as unknown as Record<
          AnyNodeId,
          AnyNode
        >,
        [],
      )
    const persisted = JSON.parse(JSON.stringify(useScene.getState().nodes))
    for (const legacy of walls) {
      const wall = WallNode.parse(persisted[legacy.id])
      expect(wall.thickness).toBe(legacy.thickness)
      expect(wallAssemblyToLegacy(wall.assembly!)).toEqual(legacy.assembly)
    }
  })
})
