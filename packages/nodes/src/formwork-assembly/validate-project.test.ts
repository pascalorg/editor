import { describe, expect, test } from 'bun:test'
import type { AnyNode, ColumnNode, SlabNode, WallNode } from '@pascal-app/core'
import type { FormworkAssemblyNode } from './schema'
import { solveProjectFormwork } from './solve-project'
import { validateProjectFormwork } from './validate-project'

/**
 * The scene validated against the layout it actually has.
 *
 * `invariants.test.ts` covers the checks. This covers the wiring, and the wiring is
 * where the interesting failures are: four of the seventeen invariants are about a
 * packed run, a pressure solve, a catalog system and a drilled hole grid, none of
 * which exist in the node graph, so they only run if the evidence reaches them from
 * the build. The two ways that goes wrong are silent in both directions — an
 * invariant reported as `notChecked` when the data was right there, and an invariant
 * run against another element's hardware.
 */

/** The four checks that only run on evidence out of a build. */
const LAYOUT_CHECKS = [
  'UNFORMABLE_STRIP',
  'DESIGN_OUTSIDE_CODE_ENVELOPE',
  'WALL_OUTSIDE_TIE_RANGE',
  'OPENING_LEAVES_TIE_GAP',
]

function makeWall(id: string, overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id,
    type: 'wall',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [6, 0],
    thickness: 0.25,
    height: 6,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'steel-panel',
    ...overrides,
  } as WallNode
}

function makeColumn(id: string, overrides: Partial<ColumnNode> = {}): ColumnNode {
  return {
    object: 'node',
    id,
    type: 'column',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    children: [],
    position: [2, 0, 3],
    rotation: 0,
    height: 3,
    width: 0.4,
    depth: 0.4,
    radius: 0.2,
    crossSection: 'square',
    formworkType: 'steel-panel',
    ...overrides,
  } as ColumnNode
}

function makeSlab(id: string, overrides: Partial<SlabNode> = {}): SlabNode {
  return {
    object: 'node',
    id,
    type: 'slab',
    parentId: 'level_1',
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
    thickness: 0.25,
    elevation: 3,
    formworkType: 'steel-panel',
    ...overrides,
  } as unknown as SlabNode
}

/** A void in a wall, on the wall-child convention every opening tool writes. */
function makeWindow(
  id: string,
  wallId: string,
  along: number,
  width: number,
  centreY = 1.5,
  height = 2.4,
): AnyNode {
  return {
    object: 'node',
    id,
    type: 'window',
    parentId: wallId,
    wallId,
    visible: true,
    metadata: {},
    children: [],
    position: [along, centreY, 0],
    width,
    height,
  } as unknown as AnyNode
}

function makeAssembly(
  id: string,
  hostId: string,
  liftIndex = 0,
  overrides: Partial<FormworkAssemblyNode> = {},
): FormworkAssemblyNode {
  return {
    object: 'node',
    id,
    type: 'formwork-assembly',
    parentId: hostId,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    panelWidth: 0.6,
    fillerPosition: 'middle',
    segmentIndex: 0,
    liftIndex,
    partOverrides: {},
    ...overrides,
  } as unknown as FormworkAssemblyNode
}

function sceneOf(
  ...members: Array<WallNode | ColumnNode | SlabNode | FormworkAssemblyNode | AnyNode>
): Record<string, AnyNode> {
  // Assemblies and openings hang off their host, so only the castable kinds are the
  // level's children.
  const hosts = members.filter(
    (node) => node.type === 'wall' || node.type === 'column' || node.type === 'slab',
  )
  const nodes: Record<string, AnyNode> = {
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      children: hosts.map((host) => host.id as string),
      elevation: 0,
      height: 6,
      level: 0,
    } as unknown as AnyNode,
  }
  for (const member of members) nodes[member.id as string] = member as unknown as AnyNode
  return nodes
}

const unchecked = (nodes: Record<string, AnyNode>, scope = {}) =>
  validateProjectFormwork(nodes, scope).report.notChecked.map((entry) => entry.invariant)

describe('validateProjectFormwork', () => {
  test('an empty scene reports nothing to check rather than throwing', () => {
    const validation = validateProjectFormwork({})

    expect(validation.report.findings).toEqual([])
    expect(validation.report.elementIds).toEqual([])
    expect(validation.shutteredIds).toEqual([])
  })

  test('the layout, pressure, tie and clash checks run once an element is shuttered', () => {
    // The reason the module exists. On nodes alone all four come back unchecked, and
    // a report that omits them silently reads as a wall that passed them.
    const wall = makeWall('wall_1')

    const missing = unchecked(sceneOf(wall))
    const present = unchecked(sceneOf(wall, makeAssembly('formwork-assembly_1', 'wall_1')))

    for (const check of LAYOUT_CHECKS) {
      expect(missing).toContain(check)
      expect(present).not.toContain(check)
    }
  })

  test('an unshuttered element is still in scope, and is named as unexamined', () => {
    // Leaving it out of `elementIds` would make a floor of unformed walls look like a
    // floor with nothing wrong on it.
    const nodes = sceneOf(
      makeWall('wall_1'),
      makeWall('wall_2', { start: [0, 4], end: [6, 4] }),
      makeAssembly('formwork-assembly_1', 'wall_1'),
    )

    const validation = validateProjectFormwork(nodes)

    expect(validation.report.elementIds).toEqual(['wall_1', 'wall_2'])
    expect(validation.shutteredIds).toEqual(['wall_1'])
  })

  test('checks each element against its own catalog, not the first one it saw', () => {
    // `systemId` is a field on the assembly, so a job can form one wall in TRIO and
    // the next in Framax. Both walls here are 250 mm: outside every TRIO tie's range
    // and inside Framax's, so a single shared system would fault the wrong one.
    const nodes = sceneOf(
      makeWall('wall_1'),
      makeWall('wall_2', { start: [0, 4], end: [6, 4] }),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, {
        systemId: 'peri-trio',
      } as Partial<FormworkAssemblyNode>),
      makeAssembly('formwork-assembly_2', 'wall_2', 0, {
        systemId: 'doka-framax-xlife',
      } as Partial<FormworkAssemblyNode>),
    )

    const ties = validateProjectFormwork(nodes).report.findings.filter(
      (finding) => finding.invariant === 'WALL_OUTSIDE_TIE_RANGE',
    )

    expect(ties.map((finding) => finding.elementIds)).toEqual([['wall_1']])
    expect(ties[0]?.message).toContain('PERI TRIO')
  })

  test('a wall no tie in its system holds is an error, not a note', () => {
    const nodes = sceneOf(
      makeWall('wall_1', { thickness: 1.4 }),
      makeAssembly('formwork-assembly_1', 'wall_1'),
    )

    const validation = validateProjectFormwork(nodes)

    const tie = validation.report.findings.find(
      (finding) => finding.invariant === 'WALL_OUTSIDE_TIE_RANGE',
    )
    expect(tie?.message).toContain('1400 mm')
    expect(validation.report.errorCount + validation.report.warningCount).toBe(
      validation.report.findings.length,
    )
  })

  test('carries a pack from every lift, not just the base one', () => {
    // A 9 m wall in three lifts is three packs, and the open strip may be in any of
    // them. Taking the first would check the bottom third and pass the rest.
    const nodes = sceneOf(
      makeWall('wall_1', { height: 9, maxLiftHeight: 3 }),
      makeAssembly('formwork-assembly_1', 'wall_1', 0),
      makeAssembly('formwork-assembly_2', 'wall_1', 1),
      makeAssembly('formwork-assembly_3', 'wall_1', 2),
    )

    const element = solveProjectFormwork(nodes).elements[0]

    expect(element?.shutters).toHaveLength(3)
    for (const shutter of element?.shutters ?? []) {
      expect(shutter.evidence.packs.length).toBeGreaterThan(0)
      expect(shutter.evidence.envelope).toBeDefined()
      expect(shutter.evidence.system).toBeDefined()
    }
  })

  test('one face of a wall is the layout evidence, not both skins', () => {
    // Both skins are packed identically, so carrying both would report every open
    // strip twice — one fault reading as two.
    const nodes = sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1'))

    const shutter = solveProjectFormwork(nodes).elements[0]?.shutters[0]

    expect(shutter?.evidence.packs).toHaveLength(1)
  })

  test('the tie field is what the wall was drilled to, over the stretch it forms', () => {
    // The check is only as good as the stations, and the stations have to be the ones
    // the shutter drew ties at — a second intersection of the two skins' holes would
    // be a second grid, and the wall builder's is the one on screen.
    const nodes = sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1'))

    const fields = solveProjectFormwork(nodes).elements[0]?.shutters[0]?.evidence.tieFields ?? []

    expect(fields).toHaveLength(1)
    expect(fields[0]?.fromM).toBeCloseTo(0, 6)
    expect(fields[0]?.toM).toBeCloseTo(6, 6)
    expect(fields[0]?.holes.length).toBeGreaterThan(0)
  })

  test('the field keeps the stations an opening blocks, which is the point of it', () => {
    // The builder drops a tie landing in a void and the band that leaves untied is the
    // finding, so a field filtered to the ties actually drawn could never report it.
    const nodes = sceneOf(
      makeWall('wall_1', { height: 3 }),
      makeWindow('window_1', 'wall_1', 3.2, 4.8),
      makeAssembly('formwork-assembly_1', 'wall_1'),
    )

    const field = solveProjectFormwork(nodes).elements[0]?.shutters[0]?.evidence.tieFields?.[0]

    expect(field?.holes.some((hole) => hole.alongM > 0.8 && hole.alongM < 5.6)).toBe(true)
  })

  test('a pier an opening leaves with no drilled hole is reported', () => {
    // 2.70 m panels drilled at 1.35 and 4.65 m along: a window from 0.8 to 5.6 m puts
    // every station in the void, so the 800 mm pier at the start is untied. Nothing
    // else in the product says so — the shutter simply draws no tie there.
    const nodes = sceneOf(
      makeWall('wall_1', { height: 3 }),
      makeWindow('window_1', 'wall_1', 3.2, 4.8),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, {
        panelWidth: 2.7,
      } as Partial<FormworkAssemblyNode>),
    )

    const found = validateProjectFormwork(nodes).report.findings.filter(
      (finding) => finding.invariant === 'OPENING_LEAVES_TIE_GAP',
    )

    expect(found.map((finding) => finding.elementIds)).toContainEqual(['wall_1', 'window_1'])
    expect(found[0]?.message).toContain('800 mm')
  })

  test('the same wall in narrow panels is tied, because narrow panels drill oftener', () => {
    // The check has to move with the layout rather than with the wall: 600 mm panels
    // bring a hole every 300 mm, so the pier the 2.70 m panels left untied is tied.
    // A check keyed on the opening alone would fault both.
    const nodes = sceneOf(
      makeWall('wall_1', { height: 3 }),
      makeWindow('window_1', 'wall_1', 3.2, 4.8),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, {
        panelWidth: 0.6,
      } as Partial<FormworkAssemblyNode>),
    )

    const found = validateProjectFormwork(nodes).report.findings.filter(
      (finding) => finding.invariant === 'OPENING_LEAVES_TIE_GAP',
    )

    expect(found).toEqual([])
  })

  test('a link wall too short for two corner units is reported through the solve', () => {
    // 500 mm between two returns, all one pour, so both ends take a corner unit and
    // the units want 600 mm of the inner face. Nothing else in the product says so:
    // `panelRuns` subtracts each blocked stretch in turn, so an overlap leaves less
    // run rather than an open one, and the takeoff bills two units for a wall with
    // room for one while every figure in it stays self-consistent.
    const nodes = sceneOf(
      makeWall('link', { start: [0, 0], end: [0.5, 0], castOrder: 1, pourId: 'P1' }),
      makeWall('left', { start: [0, 0], end: [0, 3], castOrder: 1, pourId: 'P1' }),
      makeWall('right', { start: [0.5, 0], end: [0.5, 3], castOrder: 1, pourId: 'P1' }),
      makeAssembly('formwork-assembly_1', 'link'),
    )

    const found = validateProjectFormwork(nodes).report.findings.filter(
      (finding) => finding.invariant === 'CORNER_UNITS_OVERLAP' && finding.elementIds[0] === 'link',
    )

    expect(found.length).toBe(2)
    expect(found.every((finding) => finding.severity === 'error')).toBe(true)
    // The link first, because it is the wall the clash is on, and then both returns:
    // the hardware spans three walls, and a finding naming only the link sends the
    // reader to a wall whose own geometry is unremarkable.
    expect(found[0]?.elementIds[0]).toBe('link')
    expect([...(found[0]?.elementIds ?? [])].sort()).toEqual(['left', 'link', 'right'])
  })

  test('the corner checks run on nodes alone, so they are never listed as unchecked', () => {
    // Unlike the four above. Both shipped catalogs turn a right angle on the same
    // 300 mm leg, so an element nobody has shuttered still has a leg length to check
    // against — and listing these as unchecked would tell the reader to go and form
    // something before the answer is available, when it already is.
    const missing = unchecked(sceneOf(makeWall('wall_1')))

    expect(missing).not.toContain('CORNER_UNITS_OVERLAP')
    expect(missing).not.toContain('OPENING_INSIDE_CORNER_UNIT')
  })

  test('a column carries an envelope and no pack, which is what it has', () => {
    // A column is boxed rather than packed from a run. The layout check stays
    // unchecked for it, and the pressure one runs.
    const nodes = sceneOf(makeColumn('column_1'), makeAssembly('formwork-assembly_1', 'column_1'))

    const shutter = solveProjectFormwork(nodes).elements[0]?.shutters[0]

    expect(shutter?.evidence.packs).toEqual([])
    expect(shutter?.evidence.envelope).toBeDefined()
    expect(unchecked(nodes)).not.toContain('DESIGN_OUTSIDE_CODE_ENVELOPE')
    expect(unchecked(nodes)).toContain('UNFORMABLE_STRIP')
  })

  test('a slab carries neither, and says so rather than passing', () => {
    // A deck is loaded by its own weight rather than by head, so it has no pressure
    // envelope, and it is not packed from a run. Both checks are honestly unchecked.
    const nodes = sceneOf(makeSlab('slab_1'), makeAssembly('formwork-assembly_1', 'slab_1'))

    const shutter = solveProjectFormwork(nodes).elements[0]?.shutters[0]

    expect(shutter?.evidence.packs).toEqual([])
    expect(shutter?.evidence.envelope).toBeUndefined()
    expect(unchecked(nodes)).toContain('DESIGN_OUTSIDE_CODE_ENVELOPE')
    expect(unchecked(nodes)).toContain('UNFORMABLE_STRIP')
  })

  test('scopes findings to a level while reading the whole scene for topology', () => {
    const nodes = sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1'))
    nodes.wall_2 = makeWall('wall_2', {
      parentId: 'level_2',
      start: [0, 4],
      end: [6, 4],
    }) as unknown as AnyNode

    const validation = validateProjectFormwork(nodes, { parentId: 'level_1' })

    expect(validation.report.elementIds).toEqual(['wall_1'])
    expect(validation.report.findings.flatMap((finding) => finding.elementIds)).not.toContain(
      'wall_2',
    )
  })

  test('a selection scopes the findings, and an empty one is not the whole scene', () => {
    const nodes = sceneOf(
      makeWall('wall_1'),
      makeWall('wall_2', { start: [0, 4], end: [6, 4] }),
      makeAssembly('formwork-assembly_1', 'wall_1'),
      makeAssembly('formwork-assembly_2', 'wall_2'),
    )

    const one = validateProjectFormwork(nodes, { hostIds: ['wall_1'] })
    const none = validateProjectFormwork(nodes, { hostIds: [] })

    expect(one.report.elementIds).toEqual(['wall_1'])
    expect(one.report.findings.flatMap((finding) => finding.elementIds)).not.toContain('wall_2')
    expect(none.report.elementIds).toEqual([])
    expect(none.report.findings).toEqual([])
  })

  test('the assertions with no schema home are always listed', () => {
    // A fully shuttered scope is not a fully checked one. Rebar clashes and crane
    // capacity have no data in the scene, and an absent assertion reads as a passed one.
    const nodes = sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1'))

    expect(unchecked(nodes)).toContain('TIES_THROUGH_REBAR')
    expect(unchecked(nodes)).toContain('GANG_WEIGHT_OVER_CRANE_CAPACITY')
  })
})
