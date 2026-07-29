import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import { encodeTerrainField } from './terrain-codec'
import { applyHeightPatch, createTerrainField, flattenPatch } from './terrain-field'
import { isSiteDatum, SITE_DATUM_Y, terrainSupportLift } from './terrain-support'

const LEVEL_ID = 'level_ground'
const BUILDING_ID = 'building_test'

/** A 2.5 m plateau over x,z ∈ [2,5], flat at 0 elsewhere. */
function sculptedField() {
  const base = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
  const patch = flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, 2.5)
  return applyHeightPatch(base, patch as never)
}

function makeSite(withTerrain = true): AnyNode {
  return {
    id: 'site_test',
    type: 'site',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [BUILDING_ID],
    ...(withTerrain ? { terrain: encodeTerrainField(sculptedField()) } : {}),
  } as unknown as AnyNode
}

function makeBuilding(overrides: Record<string, unknown> = {}): AnyNode {
  return {
    id: BUILDING_ID,
    type: 'building',
    object: 'node',
    parentId: 'site_test',
    visible: true,
    metadata: {},
    children: [LEVEL_ID],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    ...overrides,
  } as unknown as AnyNode
}

function makeLevel(ordinal: number, id = LEVEL_ID): AnyNode {
  return {
    id,
    type: 'level',
    object: 'node',
    parentId: BUILDING_ID,
    visible: true,
    metadata: {},
    children: [],
    level: ordinal,
    height: 3,
  } as unknown as AnyNode
}

function scene(...nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

describe('isSiteDatum', () => {
  test('the datum is ground; a slab top and a storey base are not', () => {
    expect(isSiteDatum(SITE_DATUM_Y)).toBe(true)
    // Float drift through a world matrix still reads as ground.
    expect(isSiteDatum(1e-9)).toBe(true)
    // A 5 cm ground slab is a built surface, not terrain.
    expect(isSiteDatum(0.05)).toBe(false)
    expect(isSiteDatum(3)).toBe(false)
  })
})

describe('terrainSupportLift', () => {
  test('null without terrain — every flat scene keeps its existing path', () => {
    const nodes = scene(makeSite(false), makeBuilding(), makeLevel(0))
    expect(terrainSupportLift(nodes, LEVEL_ID, 3, 3)).toBeNull()
  })

  test('samples the ground under a node on the storey at grade', () => {
    const nodes = scene(makeSite(), makeBuilding(), makeLevel(0))
    expect(terrainSupportLift(nodes, LEVEL_ID, 3, 3)).toBeCloseTo(2.5, 6)
    expect(terrainSupportLift(nodes, LEVEL_ID, -3, -3)).toBeCloseTo(0, 6)
  })

  test('null on an upper storey — it has a real floor, not ground', () => {
    const upper = 'level_upper'
    const nodes = scene(makeSite(), makeBuilding(), makeLevel(0), makeLevel(1, upper))
    expect(terrainSupportLift(nodes, upper, 3, 3)).toBeNull()
  })

  test('follows the level stack, not the ordinal, when a level sits below 0', () => {
    // `getLevelElevations` anchors the *lowest ordinal* at 0, so adding an ordinal
    // -1 level moves grade down to it and pushes the ground floor a storey up.
    // Terrain follows that, which is the point: whichever storey the renderer put
    // at the datum is the one draped, so the two can never disagree.
    const below = 'level_below'
    const nodes = scene(makeSite(), makeBuilding(), makeLevel(-1, below), makeLevel(0))
    expect(terrainSupportLift(nodes, below, 3, 3)).toBeCloseTo(2.5, 6)
    expect(terrainSupportLift(nodes, LEVEL_ID, 3, 3)).toBeNull()
  })

  test('null for an unknown level', () => {
    const nodes = scene(makeSite(), makeBuilding(), makeLevel(0))
    expect(terrainSupportLift(nodes, 'level_missing', 3, 3)).toBeNull()
  })

  test("the building's own datum offsets the sample instead of double-counting", () => {
    // A building sited at y = 2.5 has its ground floor 2.5 m up, so its base is
    // not the datum and terrain does not support it.
    const nodes = scene(makeSite(), makeBuilding({ position: [0, 2.5, 0] }), makeLevel(0))
    expect(terrainSupportLift(nodes, LEVEL_ID, 3, 3)).toBeNull()
  })

  test('level-local XZ goes through the building transform', () => {
    // Translated: local (0,0) sits over world (3,3) — on the plateau.
    const translated = scene(makeSite(), makeBuilding({ position: [3, 0, 3] }), makeLevel(0))
    expect(terrainSupportLift(translated, LEVEL_ID, 0, 0)).toBeCloseTo(2.5, 6)

    // Rotated a quarter turn: local (3,-3) maps to world (3,3).
    const rotated = scene(makeSite(), makeBuilding({ rotation: [0, Math.PI / 2, 0] }), makeLevel(0))
    expect(terrainSupportLift(rotated, LEVEL_ID, 3, -3)).toBeCloseTo(0, 6)
    expect(terrainSupportLift(rotated, LEVEL_ID, -3, 3)).toBeCloseTo(2.5, 6)
  })

  test('a level with no building still resolves against the legacy stack', () => {
    const orphan = { ...(makeLevel(0) as Record<string, unknown>), parentId: null } as AnyNode
    const nodes = scene(makeSite(), orphan)
    expect(terrainSupportLift(nodes, LEVEL_ID, 3, 3)).toBeCloseTo(2.5, 6)
  })
})
