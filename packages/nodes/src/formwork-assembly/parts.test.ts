import { describe, expect, test } from 'bun:test'
import type { ColumnNode, GeometryContext, SlabNode, WallNode } from '@pascal-app/core'
import { bomLines, duplicateMarks, type FormworkPart, partByMark } from '@pascal-app/core/formwork'
import type { Object3D } from 'three'
import { buildFormwork } from './geometry'
import type { FormworkAssemblyNode } from './schema'

/**
 * The single enumeration, tested where it can break.
 *
 * The builders emit a part and the mesh that draws it from one loop, so the two
 * cannot drift — but only if every mesh actually goes through the collector. A
 * `group.add` slipped back into a builder draws a panel that no bill orders and no
 * click selects, and nothing about the scene looks wrong. So the invariant is
 * asserted from the outside: every mesh either carries a mark that resolves to a
 * part, or is one of the members that genuinely are not shutter parts.
 *
 * The other half is the reverse direction — a part that reads as two panels because
 * a window split its mesh in half, or as one corner unit when both walls of a
 * junction drew a leg. Those are counted rather than seen, which is why they are
 * tested here rather than left to the geometry tests' name assertions.
 */

/** Meshes that are access equipment or falsework hire, not parts of the shutter. */
const NOT_A_PART = /^scaffold-/

function makeNode(overrides: Partial<FormworkAssemblyNode> = {}): FormworkAssemblyNode {
  return {
    object: 'node',
    id: 'formwork-assembly_test',
    type: 'formwork-assembly',
    parentId: 'wall_test',
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    panelWidth: 0.6,
    segmentIndex: 0,
    liftIndex: 0,
    ...overrides,
  } as FormworkAssemblyNode
}

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id: 'wall_test',
    type: 'wall',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [3, 0],
    thickness: 0.2,
    height: 2.4,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'plywood',
    ...overrides,
  } as WallNode
}

function makeColumn(overrides: Record<string, unknown> = {}): ColumnNode {
  return {
    object: 'node',
    id: 'column_test',
    type: 'column',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    crossSection: 'rectangular',
    width: 0.4,
    depth: 0.4,
    radius: 0.2,
    height: 3,
    formworkType: 'plywood',
    ...overrides,
  } as unknown as ColumnNode
}

function makeSlab(overrides: Record<string, unknown> = {}): SlabNode {
  return {
    object: 'node',
    id: 'slab_test',
    type: 'slab',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    holes: [],
    holeMetadata: [],
    elevation: 3,
    thickness: 0.2,
    recessed: false,
    autoFromWalls: false,
    formworkType: 'plywood',
    soffitHeightAboveSupport: 3,
    ...overrides,
  } as unknown as SlabNode
}

/** A level context so the coverage engine can classify the host's faces. */
function build(
  host: WallNode | ColumnNode | SlabNode,
  node: FormworkAssemblyNode = makeNode(),
): { group: { children: Object3D[] }; parts: FormworkPart[] } {
  const level = {
    object: 'node',
    id: 'level_test',
    type: 'level',
    children: [host.id as string],
  }
  const byId = new Map<string, unknown>([
    [level.id, level],
    [host.id as string, host],
  ])
  const ctx = {
    parent: host,
    resolve: (id: string) => byId.get(id),
  } as unknown as GeometryContext
  const built = buildFormwork({ ...node, parentId: host.id } as FormworkAssemblyNode, ctx)
  if (!built) throw new Error('nothing built')
  return built
}

const markOf = (mesh: Object3D): string | undefined =>
  mesh.userData.formworkPartMark as string | undefined

describe('every mesh is accounted for', () => {
  const hosts: Array<[string, WallNode | ColumnNode | SlabNode]> = [
    ['wall', makeWall({ scaffoldRequired: true, height: 4 })],
    ['column', makeColumn({ scaffoldRequired: true })],
    ['round column', makeColumn({ crossSection: 'round' })],
    ['slab', makeSlab()],
  ]

  for (const [label, host] of hosts) {
    test(`${label}: every shutter mesh carries a mark`, () => {
      const { group } = build(host)

      const unmarked = group.children
        .filter((mesh) => !NOT_A_PART.test(mesh.name))
        .filter((mesh) => markOf(mesh) === undefined)
        .map((mesh) => mesh.name)

      // A mesh with no mark is a part nobody ordered and nobody can click.
      expect(unmarked).toEqual([])
    })

    test(`${label}: every mark on a mesh resolves to a part`, () => {
      const { group, parts } = build(host)

      const dangling = group.children
        .map(markOf)
        .filter((mark): mark is string => mark !== undefined)
        .filter((mark) => partByMark(parts, mark) === undefined)

      expect(dangling).toEqual([])
    })

    test(`${label}: no two parts claim the same mark`, () => {
      expect(duplicateMarks(build(host).parts)).toEqual([])
    })

    test(`${label}: something is actually built`, () => {
      // Guards every assertion above: all three pass trivially on an empty group.
      const { group, parts } = build(host)
      expect(group.children.length).toBeGreaterThan(0)
      expect(parts.length).toBeGreaterThan(0)
    })
  }

  test('scaffold is counted as access equipment, not as a shutter part', () => {
    const { group, parts } = build(makeWall({ scaffoldRequired: true, height: 4 }))
    const scaffold = group.children.filter((mesh) => NOT_A_PART.test(mesh.name))

    expect(scaffold.length).toBeGreaterThan(0)
    expect(scaffold.every((mesh) => markOf(mesh) === undefined)).toBe(true)
    // And it does not sneak onto the bill as a panel or a waler.
    expect(parts.some((part) => part.description.includes('caffold'))).toBe(false)
  })
})

describe('one part is not always one mesh', () => {
  test('a panel split by a window is one panel off the rack', () => {
    // Two bands, one under the sill and one over the head, carrying one mark: a BOM
    // that counted meshes would order a second panel for a hole in the wall.
    const wall = makeWall({
      height: 3,
      end: [4, 0],
      children: ['window_test'],
    })
    const window = {
      object: 'node',
      id: 'window_test',
      type: 'window',
      parentId: 'wall_test',
      visible: true,
      metadata: {},
      children: [],
      position: [2, 1.4, 0],
      width: 1.2,
      height: 1.2,
      sillHeight: 0.9,
    }
    const level = {
      object: 'node',
      id: 'level_test',
      type: 'level',
      children: ['wall_test', 'window_test'],
    }
    const byId = new Map<string, unknown>([
      [level.id, level],
      ['wall_test', wall],
      ['window_test', window],
    ])
    const ctx = {
      parent: wall,
      resolve: (id: string) => byId.get(id),
    } as unknown as GeometryContext
    const built = buildFormwork(makeNode(), ctx)
    if (!built) throw new Error('nothing built')

    const byMark = new Map<string, number>()
    for (const mesh of built.group.children) {
      const mark = markOf(mesh)
      if (mark) byMark.set(mark, (byMark.get(mark) ?? 0) + 1)
    }
    const shared = [...byMark.entries()].filter(([, count]) => count > 1)

    expect(shared.length).toBeGreaterThan(0)
    // Every mesh of a shared mark is one part on the bill.
    for (const [mark] of shared) {
      expect(built.parts.filter((part) => part.mark === mark)).toHaveLength(1)
    }
  })

  test('a round column is one wrap, not twenty-four facets', () => {
    const { group, parts } = build(makeColumn({ crossSection: 'round' }))
    const facets = group.children.filter((mesh) => mesh.name.startsWith('panel-shaft-'))

    expect(facets.length).toBeGreaterThan(4)
    // Billing per facet would order two dozen forms for one tube.
    expect(parts.filter((part) => part.kind === 'panel')).toHaveLength(1)
    expect(new Set(facets.map(markOf)).size).toBe(1)
  })

  test('a polygonal shaft is a carpenter’s box, so each side is its own board', () => {
    const { group, parts } = build(makeColumn({ crossSection: 'octagonal' }))
    const facets = group.children.filter((mesh) => mesh.name.startsWith('panel-shaft-'))

    // Eight flat sides genuinely come off the saw one at a time.
    expect(new Set(facets.map(markOf)).size).toBe(facets.length)
    expect(parts.filter((part) => part.kind === 'ply-piece').length).toBeGreaterThanOrEqual(
      facets.length,
    )
  })
})

describe('the bill of one shutter', () => {
  test('a wall bills panels, ties, walers and its bulkheads', () => {
    const kinds = new Set(build(makeWall()).parts.map((part) => part.kind))

    expect(kinds).toContain('waler')
    expect(kinds).toContain('tie')
    expect(kinds).toContain('stop-end')
  })

  test('rakers are billed even though nothing draws them', () => {
    // A wall form is braced against wind rather than against the concrete, so the
    // rakers stand out into the working area and would clash with the scaffold on the
    // same face. They are still parts, and their anchor is what fails.
    const { parts } = build(makeWall())
    const braces = parts.filter((part) => part.kind === 'brace')

    expect(braces.length).toBeGreaterThan(0)
    for (const brace of braces) {
      if (brace.kind !== 'brace') continue
      expect(brace.anchorUpliftKn).toBeGreaterThan(0)
    }
  })

  test('a slab bills its deck, both beam layers and its props', () => {
    const kinds = new Set(build(makeSlab()).parts.map((part) => part.kind))

    expect(kinds).toContain('ply-piece')
    expect(kinds).toContain('joist')
    expect(kinds).toContain('prop')
  })

  test('a column bills its clamps against the schedule that placed them', () => {
    const { parts } = build(makeColumn())
    const clamps = parts.filter((part) => part.kind === 'waler')

    expect(clamps.length).toBeGreaterThan(0)
    // Four arms per row: a clamp is a part off the rack, not a set.
    expect(clamps.length % 4).toBe(0)
  })

  test('the bill collapses identical parts without losing the marks', () => {
    const { parts } = build(makeWall())
    const lines = bomLines(parts)

    expect(lines.length).toBeLessThan(parts.length)
    const billed = lines.reduce((total, line) => total + line.marks.length, 0)
    expect(billed).toBe(parts.length)
  })

  test('a structural part carries the utilisation the design solved', () => {
    const { parts } = build(makeSlab({ thickness: 0.45 }))
    const props = parts.filter((part) => part.kind === 'prop')

    expect(props.length).toBeGreaterThan(0)
    // The figure comes from `falseworkDesign`, not from this layer — a part that
    // invented its own would disagree with the design report on the same screen.
    expect(props.every((part) => (part.structure?.utilisation ?? 0) > 0)).toBe(true)
  })
})

describe('overrides reach the parts', () => {
  test('an omitted part keeps its mesh but leaves the bill', () => {
    const { parts } = build(makeWall())
    const mark = parts[0]?.mark as string
    const { group, parts: overridden } = build(
      makeWall(),
      makeNode({ partOverrides: { [mark]: { omitted: true } } }),
    )

    // The geometry is what the crew is looking at; a panel that vanishes from the
    // model reads as a bug rather than as somebody's edit.
    expect(group.children.some((mesh) => markOf(mesh) === mark)).toBe(true)
    expect(partByMark(overridden, mark)?.omitted).toBe(true)
    expect(bomLines(overridden).some((line) => line.marks.includes(mark))).toBe(false)
  })

  test('a mark survives a change elsewhere in the same wall', () => {
    // The reason marks are positions: an override written today has to land on the
    // same panel after the wall is edited at its far end.
    const short = build(makeWall({ end: [3, 0] })).parts.map((part) => part.mark)
    const long = build(makeWall({ end: [6, 0] })).parts.map((part) => part.mark)

    expect(long).toContain(short[0] as string)
  })
})
