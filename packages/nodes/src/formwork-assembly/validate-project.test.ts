import { describe, expect, test } from 'bun:test'
import type { AnyNode, ColumnNode, SlabNode, WallNode } from '@pascal-app/core'
import type { FormworkAssemblyNode } from './schema'
import { solveProjectFormwork } from './solve-project'
import { validateProjectFormwork } from './validate-project'

/**
 * The scene validated against the layout it actually has.
 *
 * `invariants.test.ts` covers the checks. This covers the wiring, and the wiring is
 * where the interesting failures are: nine of the twenty-two invariants are about a
 * packed run, a pressure solve, a catalog system, a drilled hole grid, a gang of the
 * layout, the rating of the panels it chose, or the programme's own peak, none of which exist in the node graph, so they
 * only run if the evidence reaches them from the build. The two ways that goes wrong
 * are silent in both directions — an invariant reported as `notChecked` when the data
 * was right there, and an invariant run against another element's hardware.
 */

/** The five checks that only run on evidence out of a build. */
const LAYOUT_CHECKS = [
  'UNFORMABLE_STRIP',
  'DESIGN_OUTSIDE_CODE_ENVELOPE',
  'WALL_OUTSIDE_TIE_RANGE',
  'OPENING_LEAVES_TIE_GAP',
  'TIE_THROUGH_WATERSTOP',
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

/** A vertical pour break inside one wall, carrying a waterstop at `along`. */
function makeJoint(id: string, elementId: string, along: number): AnyNode {
  return {
    object: 'node',
    id,
    type: 'construction-joint',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    children: [],
    kind: 'construction',
    elementIds: [elementId],
    along,
    treatments: [{ kind: 'waterstop', waterstopType: 'pvc-central' }],
    solverPlaced: false,
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

describe('panel ratings out of the build', () => {
  test('a panelled wall is checked against its own panels’ rating', () => {
    // A steel-panel wall is formed from the catalog, so the rating reaches the check and
    // the invariant must not come back as unexamined.
    const nodes = sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1'))
    expect(unchecked(nodes)).not.toContain('PANEL_PRESSURE_OVER_RATING')
  })

  test('a scope with nothing formed says so rather than reading as a pass', () => {
    expect(unchecked(sceneOf(makeWall('wall_1')))).toContain('PANEL_PRESSURE_OVER_RATING')
  })
})

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

  test('a waterstop the drilled tie grid crosses is reported through the solve', () => {
    // The clash is only reachable because a construction joint is a *soft* partition:
    // `hardCutsForElement` cuts a pour on expansion and isolation joints alone, so the
    // panel run crosses this one and carries its drilled holes across with it. 2.70 m
    // panels drill at 1.35 / 3.00 / 4.65 m along, and a 200 mm bar centred on 3.00
    // spans 2.90–3.10 — a rod straight through the seal. Nothing else in the product
    // says so: the tie is inside capacity, the run closes, and the takeoff bills a
    // waterstop and a tie row that cannot both be built.
    const nodes = sceneOf(
      makeWall('wall_1', { height: 3 }),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, {
        panelWidth: 2.7,
      } as Partial<FormworkAssemblyNode>),
      makeJoint('joint_1', 'wall_1', 3),
    )

    const found = validateProjectFormwork(nodes).report.findings.filter(
      (finding) => finding.invariant === 'TIE_THROUGH_WATERSTOP',
    )

    expect(found.map((finding) => finding.elementIds)).toEqual([['wall_1', 'joint_1']])
    expect(found[0]?.severity).toBe('error')
    expect(found[0]?.message).toContain('200 mm PVC waterstop')
  })

  test('the same bar between two tie columns is silent, because the holes miss it', () => {
    // The check has to move with where the frames were drilled rather than with the
    // joint: 2.20 m along is 850 mm clear of the nearest hole. A check keyed on the
    // joint alone would fault a wall a carpenter can build as drawn.
    const nodes = sceneOf(
      makeWall('wall_1', { height: 3 }),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, {
        panelWidth: 2.7,
      } as Partial<FormworkAssemblyNode>),
      makeJoint('joint_1', 'wall_1', 2.2),
    )

    const found = validateProjectFormwork(nodes).report.findings.filter(
      (finding) => finding.invariant === 'TIE_THROUGH_WATERSTOP',
    )

    expect(found).toEqual([])
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

  test('a slab’s own falsework evidence reaches the prop-versus-capacity check', () => {
    // Two storeys: the decked slab is propped off the slab below, which carries a
    // stated capacity. The check must read the props out of the solve's own
    // evidence — a validator that re-derived the grid would not be checking what
    // the parts table drew.
    const nodes = sceneOf(
      makeSlab('slab_above', { parentId: 'level_2', loadCapacityKnM2: 200 }),
      makeAssembly('formwork-assembly_1', 'slab_above'),
    )
    nodes.level_2 = {
      object: 'node',
      id: 'level_2',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['slab_above'],
      elevation: 6,
      height: 6,
      level: 1,
    } as unknown as AnyNode
    // The slab below, propped off the ground: it has a real capacity and the
    // falsework above stands on it.
    nodes.slab_below = makeSlab('slab_below', {
      parentId: 'level_1',
      loadCapacityKnM2: 0.5,
      formworkType: 'none',
    }) as unknown as AnyNode

    const shutter = solveProjectFormwork(nodes).elements[0]?.shutters[0]
    expect(shutter?.evidence.falsework).toBeDefined()
    expect((shutter?.evidence.falsework?.props ?? []).length).toBeGreaterThan(0)

    const validation = validateProjectFormwork(nodes)
    // The deck's own reaction is huge against a 0.5 kN/m² slab, so the prop check
    // fires and names the slab below.
    const found = validation.report.findings.filter((f) => f.invariant === 'PROPS_ONTO_SLAB_BELOW')
    expect(found.length).toBeGreaterThan(0)
    expect(found[0]?.message).toContain('slab_below')
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
    // A fully shuttered scope is not a fully checked one. Rebar has no geometry in the
    // scene at all, and an absent assertion reads as a passed one. The crane is here for
    // a different reason — a load chart *has* a schema home and this scene has not filled
    // it in, which is the conditional case and not the permanent one.
    const nodes = sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1'))

    expect(unchecked(nodes)).toContain('TIES_THROUGH_REBAR')
    expect(unchecked(nodes)).toContain('GANG_WEIGHT_OVER_CRANE_CAPACITY')
  })
})

describe('the crane check, whose evidence is a grouping of the layout', () => {
  /**
   * The settings on the level, so *both* readers find them.
   *
   * The geometry climbs the host's ancestors and the takeoff scans the scene, and a crane
   * only one of them can see is the failure this suite is for: the layout would be grouped
   * as one pick per face and then checked against a chart, so a wall that lifts in seven
   * gangs would come back as one 1.9 t pick nothing on site can make.
   */
  function withCrane(
    crane: Record<string, unknown>,
    ...members: Parameters<typeof sceneOf>
  ): Record<string, AnyNode> {
    const nodes = sceneOf(...members)
    const level = nodes.level_1 as unknown as { children: string[] }
    level.children = [...level.children, 'formwork-settings_1']
    nodes['formwork-settings_1'] = {
      object: 'node',
      id: 'formwork-settings_1',
      type: 'formwork-settings',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      children: [],
      pressureStandard: 'BS_8110',
      crane,
    } as unknown as AnyNode
    return nodes
  }

  const gangsOf = (nodes: Record<string, AnyNode>) =>
    (solveProjectFormwork(nodes).elements[0]?.shutters ?? []).flatMap(
      (shutter) => shutter.evidence.gangs ?? [],
    )

  const gangFindings = (nodes: Record<string, AnyNode>) =>
    validateProjectFormwork(nodes).report.findings.filter((finding) =>
      finding.invariant.startsWith('GANG_'),
    )

  test('the face the crane grouped is the face the crane is checked against', () => {
    // The join, and the one that matters most in this whole module: the same chart both
    // groups the gangs and checks them. A 6 m × 6 m wall is one 1892 kg pick with no crane
    // stated, and against a 300 kg machine it comes back as seven picks that all lift. A
    // validator handed the chart but not the grouping would fail the wall on a gang the
    // model does not draw.
    const nodes = withCrane(
      { capacityCurve: [{ radiusM: 30, capacityKg: 300 }], hookHeightM: 40 },
      makeWall('wall_1'),
      makeAssembly('formwork-assembly_1', 'wall_1'),
    )

    const gangs = gangsOf(nodes).flatMap((face) => face.gangs)
    expect(gangs.length).toBeGreaterThan(1)
    expect(gangs.every((gang) => (gang.pickWeightKg ?? 0) <= 300)).toBe(true)
    expect(gangFindings(nodes)).toEqual([])
    expect(unchecked(nodes)).not.toContain('GANG_WEIGHT_OVER_CRANE_CAPACITY')
  })

  test('a pick no joint can split faults the wall, and names it', () => {
    // 200 kg against a 900 mm panel stack of 281 kg. Every joint in the face is already
    // used, so the gangs come back over the limit rather than smaller — which is the
    // finding, and the answer to it is a narrower layout somebody has to pay for.
    const nodes = withCrane(
      { capacityCurve: [{ radiusM: 30, capacityKg: 200 }], hookHeightM: 40 },
      makeWall('wall_1'),
      makeAssembly('formwork-assembly_1', 'wall_1'),
    )

    const found = gangFindings(nodes)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((finding) => finding.severity === 'error')).toBe(true)
    expect(found[0]?.elementIds).toEqual(['wall_1'])
    expect(found[0]?.message).toContain('tops out at 200 kg')
  })

  test('a pick the mast takes and the tip does not is a position, not a re-layout', () => {
    // The same 206 kg gang against a chart giving 200 kg at the tip and 400 kg at 30 m.
    // Nothing in the scene says where the crane stands, so this is a warning naming the
    // radius to set inside rather than an error condemning the layout.
    const nodes = withCrane(
      {
        capacityCurve: [
          { radiusM: 20, capacityKg: 5600 },
          { radiusM: 30, capacityKg: 400 },
          { radiusM: 40, capacityKg: 200 },
        ],
        hookHeightM: 40,
      },
      makeWall('wall_1'),
      makeAssembly('formwork-assembly_1', 'wall_1'),
    )

    const found = gangFindings(nodes)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((finding) => finding.severity === 'warning')).toBe(true)
    expect(found[0]?.message).toContain('set inside 30 m')
  })

  test('the headroom is checked off the same gangs, and separately', () => {
    // A 6 m gang's eyes are 3.5 m apart, which wants 3 m over the top of it at 60°. This
    // crane has 2 — so the pick is well inside the chart and does not lift.
    const nodes = withCrane(
      { capacityCurve: [{ radiusM: 30, capacityKg: 8000 }], hookHeightM: 2 },
      makeWall('wall_1'),
      makeAssembly('formwork-assembly_1', 'wall_1'),
    )

    const found = gangFindings(nodes)
    expect(found.map((finding) => finding.invariant)).toEqual(['GANG_HEADROOM_OVER_HOOK_HEIGHT'])
    expect(found[0]?.message).toContain('the crane has 2000 mm')
  })

  test('a chart with no hook height leaves the headroom unchecked and the weight checked', () => {
    const nodes = withCrane(
      { capacityCurve: [{ radiusM: 30, capacityKg: 8000 }] },
      makeWall('wall_1'),
      makeAssembly('formwork-assembly_1', 'wall_1'),
    )

    expect(unchecked(nodes)).not.toContain('GANG_WEIGHT_OVER_CRANE_CAPACITY')
    expect(unchecked(nodes)).toContain('GANG_HEADROOM_OVER_HOOK_HEIGHT')
  })

  test('a crane with nothing to lift says the gangs are missing, not the chart', () => {
    // A slab is decked rather than panelled from a run, so it has no gang. The chart is
    // recorded and there is simply nothing on this scope to weigh against it — which is a
    // different sentence from "record a load chart", and the reader acts on it differently.
    const nodes = withCrane(
      { capacityCurve: [{ radiusM: 30, capacityKg: 8000 }], hookHeightM: 40 },
      makeSlab('slab_1'),
      makeAssembly('formwork-assembly_1', 'slab_1'),
    )

    expect(gangsOf(nodes)).toEqual([])
    expect(
      validateProjectFormwork(nodes).report.notChecked.find(
        (entry) => entry.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY',
      )?.needs,
    ).toContain('pass `gangs`')
  })

  test('every lift of a wall is weighed, not the first one', () => {
    // Two lifts of one wall are two assemblies lifted in on two days, and the heavy pick
    // may be in either. Deduping them — or taking the base lift as the element's — would
    // check one and report a pass for the other.
    const nodes = withCrane(
      { capacityCurve: [{ radiusM: 30, capacityKg: 200 }], hookHeightM: 40 },
      makeWall('wall_1', { height: 6 }),
      makeAssembly('formwork-assembly_1', 'wall_1', 0),
      makeAssembly('formwork-assembly_2', 'wall_1', 1),
    )

    const faces = gangsOf(nodes)
    expect(faces.length).toBeGreaterThan(1)
    expect(gangFindings(nodes).length).toBeGreaterThan(faces[0]?.gangs.length ?? 0)
  })
})

describe('the shortage check, which needs the takeoff rather than the layout', () => {
  /** The panel type a plain steel-panel wall bills, so a small rack under-covers a peak. */
  const PANEL_ID = 'doka-framax-panel-588104500'

  /** The project settings node, parented to a site the scope never looks at. */
  function withSettings(
    nodes: Record<string, AnyNode>,
    settings: Record<string, unknown>,
  ): Record<string, AnyNode> {
    return {
      ...nodes,
      'formwork-settings_1': {
        object: 'node',
        id: 'formwork-settings_1',
        type: 'formwork-settings',
        parentId: 'site_1',
        visible: true,
        metadata: {},
        children: [],
        pressureStandard: 'BS_8110',
        schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
        ...settings,
      } as unknown as AnyNode,
    }
  }

  /** Two walls poured on one day, so their panels stand at the same time. */
  function concurrent(settings: Record<string, unknown>): Record<string, AnyNode> {
    return withSettings(
      sceneOf(
        makeWall('wall_1'),
        makeWall('wall_2', { start: [0, 10], end: [6, 10] }),
        makeAssembly('formwork-assembly_1', 'wall_1', 0, { pourAt: '2026-03-02' }),
        makeAssembly('formwork-assembly_2', 'wall_2', 0, { pourAt: '2026-03-02' }),
      ),
      settings,
    )
  }

  test('the peak against the rack reaches the validator, and names both walls', () => {
    // The join this module is for, on the one check whose evidence is a *solution* rather
    // than a layout. Computed here a second time it could disagree with the takeoff about
    // how many panels are short, which is worse than staying quiet.
    const nodes = concurrent({ stock: { owned: { [PANEL_ID]: 4 } } })
    const validation = validateProjectFormwork(nodes)

    const found = validation.report.findings.find(
      (finding) => finding.invariant === 'SET_COUNT_SHORTAGE',
    )
    expect(found?.elementIds).toEqual(['wall_1', 'wall_2'])
    expect(found?.severity).toBe('warning')
    expect(unchecked(nodes)).not.toContain('SET_COUNT_SHORTAGE')
  })

  /**
   * A rack holding exactly what this programme's peaks ask for.
   *
   * Read off the solve rather than hand-listed, because a shortage is per catalog id and a
   * steel-panel wall peaks on ties, walers and props as well as panels — a rack of panels
   * alone leaves every other id short, which is a real finding and not the one under test.
   */
  function rackFor(nodes: Record<string, AnyNode>): Record<string, number> {
    const peaks = solveProjectFormwork(nodes).sets?.peaks ?? []
    return Object.fromEntries(peaks.map((peak) => [peak.catalogId, peak.peakQuantity]))
  }

  test('a rack that covers the peak is checked and clean, not unchecked', () => {
    const nodes = concurrent({ stock: { owned: rackFor(concurrent({})) } })

    expect(
      validateProjectFormwork(nodes).report.findings.some(
        (finding) => finding.invariant === 'SET_COUNT_SHORTAGE',
      ),
    ).toBe(false)
    expect(unchecked(nodes)).not.toContain('SET_COUNT_SHORTAGE')
  })

  test('sequential pours share their sets, so a one-pour rack is short of nothing', () => {
    // The claim the module rests on, asserted through the validator: the bill is identical
    // in both scenes and only the dates move. A rack sized to the sequential peak covers
    // the whole job when the pours run a fortnight apart, and half of it when they do not.
    const sequential = (stock: Record<string, number>) =>
      withSettings(
        sceneOf(
          makeWall('wall_1'),
          makeWall('wall_2', { start: [0, 10], end: [6, 10] }),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, { pourAt: '2026-03-02' }),
          makeAssembly('formwork-assembly_2', 'wall_2', 0, { pourAt: '2026-04-13' }),
        ),
        { stock: { owned: stock } },
      )
    const rack = rackFor(sequential({}))

    const shortage = (scene: Record<string, AnyNode>) =>
      validateProjectFormwork(scene).report.findings.some(
        (finding) => finding.invariant === 'SET_COUNT_SHORTAGE',
      )
    expect(shortage(sequential(rack))).toBe(false)
    expect(shortage(concurrent({ stock: { owned: rack } }))).toBe(true)
  })

  test('no rack recorded is unchecked, not stocked', () => {
    // A project that has never opened the settings has not said it owns nothing, and the
    // check has to say it could not run rather than report the peak as covered.
    expect(unchecked(concurrent({}))).toContain('SET_COUNT_SHORTAGE')
  })

  test('an undated programme is unchecked for the same reason, and says which inputs', () => {
    const nodes = withSettings(
      sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')),
      { stock: { owned: { [PANEL_ID]: 4 } } },
    )
    const entry = validateProjectFormwork(nodes).report.notChecked.find(
      (item) => item.invariant === 'SET_COUNT_SHORTAGE',
    )

    expect(entry?.needs).toContain('ownedStock')
    expect(entry?.needs).toContain('date the pours')
  })

  test('a scope excluding the overlapping pours drops the shortage rather than re-pointing it', () => {
    // The peak is a fact about the whole programme; a scope is a subset. Pinned on an
    // element outside the overlap it would send the reader to the wrong wall.
    const nodes = concurrent({ stock: { owned: { [PANEL_ID]: 4 } } })
    const scoped = validateProjectFormwork(nodes, { hostIds: ['wall_1'] })

    // In scope the shortage still names only what the caller asked about.
    expect(
      scoped.report.findings.find((finding) => finding.invariant === 'SET_COUNT_SHORTAGE')
        ?.elementIds,
    ).toEqual(['wall_1'])
  })
})
