import { describe, expect, test } from 'bun:test'
import type { AnyNode, ColumnNode, SlabNode, WallNode } from '@pascal-app/core'
import type { FormworkAcquisition } from '@pascal-app/core/formwork'
import { acquireCaveats } from '@pascal-app/core/formwork'
import type { FormworkAssemblyNode } from './schema'
import {
  projectFormworkCaveats,
  type SolvedElement,
  solveProjectFormwork,
  takeoffVerificationNote,
} from './solve-project'

/**
 * The job's formwork rather than one element's.
 *
 * `solve.test.ts` covers one host. This covers the scope a yard actually orders at,
 * and the failures are the ones that only appear when more than one element is in
 * frame: the same panel type on two walls billing as two lines instead of one, an
 * element formed for fewer pours than it is cast in dragging a project total short
 * with nothing in the numbers to show it, a row order that moves between two
 * downloads of an unchanged scene.
 */

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
    formworkType: 'plywood',
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
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    holes: [],
    holeMetadata: [],
    elevation: 3,
    thickness: 0.2,
    recessed: false,
    autoFromWalls: false,
    formworkType: 'plywood',
    ...overrides,
  } as SlabNode
}

function makeAssembly(
  id: string,
  hostId: string,
  segmentIndex: number,
  liftIndex: number,
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
    segmentIndex,
    liftIndex,
    partOverrides: {},
    ...overrides,
  } as unknown as FormworkAssemblyNode
}

/** A level holding whatever is passed, which is what face classification reads. */
function sceneOf(
  ...members: Array<WallNode | ColumnNode | SlabNode | FormworkAssemblyNode>
): Record<string, AnyNode> {
  const hosts = members.filter((node) => node.type !== 'formwork-assembly')
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
    } as unknown as AnyNode,
  }
  for (const member of members) nodes[member.id as string] = member as unknown as AnyNode
  return nodes
}

/** The project settings node, parented to a site the scope never looks at. */
function withStock(
  nodes: Record<string, AnyNode>,
  stock: { owned?: Record<string, number> } | undefined,
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
      ...(stock ? { stock } : {}),
    } as unknown as AnyNode,
  }
}

/** Any settings group, verbatim — the cure, the pressure code, the rates. */
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
      ...settings,
    } as unknown as AnyNode,
  }
}

/** The panel type a plain steel-panel wall bills 20 of, so a rack can half-cover it. */
const PANEL_ID = 'doka-framax-panel-588104500'

function steelWallScene(): Record<string, AnyNode> {
  return sceneOf(
    makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
    makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
  )
}

describe('solveProjectFormwork', () => {
  test('an empty scene bills nothing rather than throwing', () => {
    const solution = solveProjectFormwork({})

    expect(solution.elements).toEqual([])
    expect(solution.bom).toEqual([])
    expect(solution.shutterCount).toBe(0)
    expect(solution.incomplete).toEqual([])
  })

  test('an unshuttered element is left out, not carried as an empty row', () => {
    // A wall nobody has formed yet is not a wall that needs nothing, and an empty
    // row in a bill reads as exactly that.
    const wall = makeWall('wall_1')

    const solution = solveProjectFormwork(sceneOf(wall))

    expect(solution.elements).toEqual([])
  })

  test('solves every shuttered element in the scene', () => {
    const wall = makeWall('wall_1')
    const column = makeColumn('column_1')
    const solution = solveProjectFormwork(
      sceneOf(
        wall,
        column,
        makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
        makeAssembly('formwork-assembly_2', 'column_1', 0, 0),
      ),
    )

    expect(solution.elements.map((element) => element.host.id)).toEqual(['column_1', 'wall_1'])
    expect(solution.shutterCount).toBe(2)
    for (const element of solution.elements) {
      expect(element.shutters[0]?.parts.length).toBeGreaterThan(0)
    }
  })

  test('is pure across repeated runs, wall-clock time and ambient locale', () => {
    const scene = withSettings(steelWallScene(), {
      pressureStandard: 'BS_8110',
      schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
      stock: { owned: { [PANEL_ID]: 4 } },
      rates: { currency: 'GBP', byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } } },
    })
    const realNow = Date.now
    const realLocale = Intl.DateTimeFormat
    try {
      Date.now = () => new Date('1999-01-01T00:00:00Z').getTime()
      Object.defineProperty(Intl, 'DateTimeFormat', { value: undefined, configurable: true })
      const first = solveProjectFormwork(scene)

      Date.now = () => new Date('2099-12-31T00:00:00Z').getTime()
      Object.defineProperty(Intl, 'DateTimeFormat', {
        value: realLocale,
        configurable: true,
      })

      expect(solveProjectFormwork(scene)).toEqual(first)
    } finally {
      Date.now = realNow
      Object.defineProperty(Intl, 'DateTimeFormat', { value: realLocale, configurable: true })
    }
  })

  test('two walls of the same system bill as one order, not two takeoffs', () => {
    // The reason this exists at all. The same panel type on two walls is one line on
    // a delivery note, and per-element bills cannot be added up afterwards.
    const one = makeWall('wall_1')
    const two = makeWall('wall_2', { start: [0, 4], end: [6, 4] })
    const scene = sceneOf(
      one,
      two,
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
      makeAssembly('formwork-assembly_2', 'wall_2', 0, 0),
    )

    const both = solveProjectFormwork(scene)
    const alone = solveProjectFormwork(scene, { hostIds: ['wall_1'] })

    const panelLine = both.bom.find((line) => line.kind === 'panel')
    const panelAlone = alone.bom.find((line) => line.kind === 'panel')
    expect(panelLine?.quantity).toBe((panelAlone?.quantity ?? 0) * 2)
    // One line, twice the quantity — not two lines of the same description.
    expect(both.bom.filter((line) => line.description === panelLine?.description)).toHaveLength(1)
  })

  test('the total weight is the sum across every element', () => {
    const one = makeWall('wall_1')
    const two = makeWall('wall_2', { start: [0, 4], end: [6, 4] })
    const scene = sceneOf(
      one,
      two,
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
      makeAssembly('formwork-assembly_2', 'wall_2', 0, 0),
    )

    const both = solveProjectFormwork(scene)
    const alone = solveProjectFormwork(scene, { hostIds: ['wall_1'] })

    expect(both.totalWeightKg).toBeGreaterThan(alone.totalWeightKg)
  })

  test('rows are ordered stably, so two downloads of one scene match', () => {
    // Node-map order is insertion order, which an undo reshuffles. A CSV whose rows
    // move between two exports of an unchanged scene is one nobody can diff.
    const one = makeWall('wall_1')
    const two = makeWall('wall_2', { start: [0, 4], end: [6, 4] })
    const a = makeAssembly('formwork-assembly_1', 'wall_1', 0, 0)
    const b = makeAssembly('formwork-assembly_2', 'wall_2', 0, 0)

    const forwards = solveProjectFormwork(sceneOf(one, two, a, b))
    const backwards = solveProjectFormwork(sceneOf(two, one, b, a))

    expect(backwards.elements.map((element) => element.host.id)).toEqual(
      forwards.elements.map((element) => element.host.id),
    )
    expect(backwards.bom.map((line) => line.description)).toEqual(
      forwards.bom.map((line) => line.description),
    )
  })

  test('scopes to a level, which is where a pour is actually planned', () => {
    const here = makeWall('wall_1')
    const upstairs = makeWall('wall_2', { parentId: 'level_2' })
    const nodes = sceneOf(
      here,
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
      makeAssembly('formwork-assembly_2', 'wall_2', 0, 0),
    )
    nodes.wall_2 = upstairs as unknown as AnyNode

    const solution = solveProjectFormwork(nodes, { parentId: 'level_1' })

    expect(solution.elements.map((element) => element.host.id)).toEqual(['wall_1'])
  })

  test('an element formed for fewer pours than it is cast in is named', () => {
    // The failure the whole project scope makes worse: a total over such an element
    // is short, and every individual figure in it is correct.
    const wall = makeWall('wall_1', { height: 9, maxLiftHeight: 3 })

    const solution = solveProjectFormwork(
      sceneOf(wall, makeAssembly('formwork-assembly_1', 'wall_1', 0, 0)),
    )

    expect(solution.elements[0]?.pourUnitCount).toBe(3)
    expect(solution.elements[0]?.shutters).toHaveLength(1)
    expect(solution.elements[0]?.coversWholePour).toBe(false)
    expect(solution.incomplete.map((element) => element.host.id)).toEqual(['wall_1'])
  })

  test('a fully shuttered element is not flagged', () => {
    const wall = makeWall('wall_1', { height: 9, maxLiftHeight: 3 })

    const solution = solveProjectFormwork(
      sceneOf(
        wall,
        makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
        makeAssembly('formwork-assembly_2', 'wall_1', 0, 1),
        makeAssembly('formwork-assembly_3', 'wall_1', 0, 2),
      ),
    )

    expect(solution.elements[0]?.coversWholePour).toBe(true)
    expect(solution.incomplete).toEqual([])
    expect(solution.shutterCount).toBe(3)
  })

  test('carries face topology on the solved element', () => {
    const wall = makeWall('wall_1', { againstEarthSide: 'b' } as Partial<WallNode>)
    const solution = solveProjectFormwork(
      sceneOf(wall, makeAssembly('formwork-assembly_1', 'wall_1', 0, 0)),
    )
    const byRole = new Map(solution.elements[0]?.topology.faces.map((face) => [face.role, face]))

    expect(byRole.get('side-a')?.formed).toBe(true)
    expect(byRole.get('side-b')).toMatchObject({
      formed: false,
      reason: 'AGAINST_EARTH',
      measuredArea: 0,
    })
  })

  test('a shared monolithic face is counted once in area, panels and cost', () => {
    // Two walls meet at an L and are poured together. Each draws its own corner leg ("the
    // hardware lands on both faces") but exactly one bills the unit — a bill that counted
    // both would order every corner in the building twice. The monolithic end is a meeting,
    // not a poured face: neither wall reports area for it, so there is no flat surface to
    // double-count.
    const wallA = makeWall('wall_a', {
      start: [0, 0],
      end: [6, 0],
      formworkType: 'steel-panel',
      pourId: 'P1',
      castOrder: 1,
    } as Partial<WallNode>)
    const wallB = makeWall('wall_b', {
      start: [6, 0],
      end: [6, 6],
      formworkType: 'steel-panel',
      pourId: 'P1',
      castOrder: 2,
    } as Partial<WallNode>)
    const solution = solveProjectFormwork(
      sceneOf(
        wallA,
        wallB,
        makeAssembly('formwork-assembly_1', 'wall_a', 0, 0),
        makeAssembly('formwork-assembly_2', 'wall_b', 0, 0),
      ),
    )

    // Panels and cost: each kind of corner unit appears exactly once in the bill.
    const corners = solution.bom.filter((line) => line.kind === 'corner')
    expect(corners.map((line) => line.quantity)).toEqual([1, 1])
    // A bill line's marks are the parts that landed on it: a single unit leaves one mark.
    expect(corners.map((line) => line.marks.length)).toEqual([1, 1])

    // Area: the monolithic end of each wall is a meeting, so neither reports area for it.
    const byRole = (id: string) =>
      new Map(
        solution.elements
          .find((element) => element.host.id === id)
          ?.topology.faces.map((face) => [face.role, face]),
      )
    expect(byRole('wall_a').get('end-end')).toMatchObject({
      formed: false,
      reason: 'MONOLITHIC_CONTINUATION',
      measuredArea: 0,
    })
    expect(byRole('wall_b').get('end-start')).toMatchObject({
      formed: false,
      reason: 'MONOLITHIC_CONTINUATION',
      measuredArea: 0,
    })
  })

  test('an unformed face appears in no layout and no area total', () => {
    const wall = makeWall('wall_1', { againstEarthSide: 'b' } as Partial<WallNode>)
    const solution = solveProjectFormwork(
      sceneOf(wall, makeAssembly('formwork-assembly_1', 'wall_1', 0, 0)),
    )
    const element = solution.elements[0] as SolvedElement
    const byRole = new Map(element.topology.faces.map((face) => [face.role, face]))

    expect(byRole.get('side-b')).toMatchObject({ formed: false, reason: 'AGAINST_EARTH' })
    expect(byRole.get('side-b')?.measuredArea).toBe(0)
    // No panel, waler or tie is drawn for the unformed face: every mark names face A.
    const marks = element.shutters.flatMap((shutter) => shutter.parts).map((part) => part.mark)
    expect(marks.filter((mark) => mark.startsWith('P-B-')).length).toBe(0)
    expect(marks.some((mark) => mark.startsWith('P-A-'))).toBe(true)
  })

  test('a degenerate element is rejected with its reason, and the rest of the job still solves', () => {
    // The refusal used to be a `null` inside the conversion, so the element left the bill and
    // nothing said so — a total short by a slab reads as a cheap job rather than an incomplete
    // one. The good wall beside it is half the assertion: a refusal that stops the project is
    // as useless as one that hides.
    const good = makeWall('wall_1')
    const flat = makeSlab('slab_1', { thickness: 0 })
    const solution = solveProjectFormwork(
      sceneOf(
        good,
        flat,
        makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
        makeAssembly('formwork-assembly_2', 'slab_1', 0, 0),
      ),
    )

    expect(solution.rejected).toMatchObject([
      {
        elementId: 'slab_1',
        kind: 'slab',
        reason: 'dimension-not-positive',
        dimension: 'thickness',
      },
    ])
    expect(solution.elements.map((element) => element.host.id)).toEqual(['wall_1'])
    // No quantity, no cost, no drawing: the rejected element contributes to none of the three.
    const alone = solveProjectFormwork(
      sceneOf(good, makeAssembly('formwork-assembly_1', 'wall_1', 0, 0)),
    )
    expect(solution.bom.map((line) => line.description)).toEqual(
      alone.bom.map((line) => line.description),
    )
    expect(solution.bom.map((line) => line.quantity)).toEqual(
      alone.bom.map((line) => line.quantity),
    )
    expect(solution.totalWeightKg).toBe(alone.totalWeightKg)
    expect(solution.cost?.totalCost).toBe(alone.cost?.totalCost)
    expect(solution.cutList).toEqual(alone.cutList)
    expect(
      projectFormworkCaveats(solution).some((c) =>
        c.includes('incomplete job rather than a cheap one'),
      ),
    ).toBe(true)
  })

  test('an element on a registered-but-unseeded system is rejected with the id named', () => {
    // The refusal group 4.1 exists for. Before the unseeded registrations, a stated id
    // either resolved to a full system or to nothing, and nothing fell back to a
    // conventional ply shutter silently — a layout of panels nobody has transcribed. A
    // registered id with no data must refuse instead, and the refusal has to name the
    // identifier, because the remedy is seeding that datasheet.
    const scene = sceneOf(
      makeWall('wall_1'),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, {
        systemId: 'mivan-generic',
      } as Partial<FormworkAssemblyNode>),
    )
    const solution = solveProjectFormwork(scene)

    expect(solution.rejected).toMatchObject([
      {
        elementId: 'wall_1',
        kind: 'wall',
        reason: 'system-unseeded',
        systemId: 'mivan-generic',
      },
    ])
    expect(solution.elements).toEqual([])
    expect(solution.shutterCount).toBe(0)
    expect(solution.bom).toEqual([])
    expect(projectFormworkCaveats(solution).some((line) => line.includes('mivan-generic'))).toBe(
      true,
    )
  })

  test('a project-level unseeded system rejects every element, and a seeded one rescues the rest', () => {
    // The project choice reaches every shutter that has not named its own, so one
    // unseeded `parts.systemId` is a whole level refused — and the element beside it
    // that names a seeded system still solves, exactly as a degenerate element does not
    // stop the project.
    const unseeded = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1'),
          makeWall('wall_2'),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
          makeAssembly('formwork-assembly_2', 'wall_2', 0, 0, {
            systemId: 'peri-trio',
          } as Partial<FormworkAssemblyNode>),
        ),
        { parts: { systemId: 'peri-quattro' } },
      ),
    )

    expect(unseeded.rejected).toMatchObject([
      {
        elementId: 'wall_1',
        reason: 'system-unseeded',
        systemId: 'peri-quattro',
      },
    ])
    // The element that named its own seeded system still forms — the refusal is per
    // element, not a state that poisons the scope.
    expect(unseeded.elements.map((element) => element.host.id)).toEqual(['wall_2'])
  })

  test('an unregistered id still falls back rather than refusing, because it is a different fault', () => {
    // 4.1 is about registered-but-unseeded: an id that is not registered at all is a
    // stale scene or a typo, and the write paths already refuse those — the fallback is
    // the historical behaviour left alone rather than a claim that the id is real.
    const scene = sceneOf(
      makeWall('wall_1'),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, {
        systemId: 'nope-9000',
      } as Partial<FormworkAssemblyNode>),
    )
    const solution = solveProjectFormwork(scene)

    expect(solution.rejected).toEqual([])
    expect(solution.shutterCount).toBeGreaterThan(0)
  })

  test('a per-part omission reaches the project bill', () => {
    // The decisions live on the assembly, so a project-scope aggregation that solved
    // its own way would quietly re-order everything a yard had taken off the list.
    const wall = makeWall('wall_1')
    const plain = solveProjectFormwork(
      sceneOf(wall, makeAssembly('formwork-assembly_1', 'wall_1', 0, 0)),
    )
    const mark = plain.elements[0]?.shutters[0]?.parts.find((part) => part.kind === 'panel')
      ?.mark as string

    const edited = solveProjectFormwork(
      sceneOf(
        wall,
        makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, {
          partOverrides: { [mark]: { omitted: true } },
        } as Partial<FormworkAssemblyNode>),
      ),
    )

    expect(edited.bom.flatMap((line) => line.marks)).not.toContain(mark)
    expect(edited.totalWeightKg).toBeLessThan(plain.totalWeightKg)
  })
})

describe('the owned/hired split', () => {
  test('a project that has said nothing about its rack gets no split at all', () => {
    // Not a split of zeros. A bill reading "everything on hire" is a claim about the
    // yard, and nobody made it — same distinction the report draws between an
    // assumption and a project decision.
    expect(solveProjectFormwork(steelWallScene()).supply).toBeUndefined()
    expect(solveProjectFormwork(withStock(steelWallScene(), undefined)).supply).toBeUndefined()
  })

  test('a rack recorded as empty is an answer, and prices the bill as hire', () => {
    const solution = solveProjectFormwork(withStock(steelWallScene(), { owned: {} }))

    expect(solution.supply).toBeDefined()
    expect(solution.supply?.ownedQuantity).toBe(0)
    expect(solution.supply?.hiredQuantity).toBeGreaterThan(0)
  })

  test('the rack is spent against the bill, and the shortfall is hired', () => {
    const full = solveProjectFormwork(steelWallScene())
    const billed = full.bom.find((line) => line.catalogId === PANEL_ID)?.quantity as number
    expect(billed).toBeGreaterThan(4)

    const solution = solveProjectFormwork(withStock(steelWallScene(), { owned: { [PANEL_ID]: 4 } }))
    const split = solution.supply?.lines.find((entry) => entry.line.catalogId === PANEL_ID)

    expect(split?.ownedQuantity).toBe(4)
    expect(split?.hiredQuantity).toBe(billed - 4)
  })

  test('the split sits beside the bill line it is about, in the bill’s own order', () => {
    // The panel reads them positionally; a supply array in the engine's allocation
    // order would put every figure against the wrong description.
    const solution = solveProjectFormwork(withStock(steelWallScene(), { owned: { [PANEL_ID]: 4 } }))

    expect(solution.supply?.lines.map((entry) => entry.line)).toEqual(solution.bom)
  })

  test('bespoke lines are consumed rather than hired, whatever the yard owns', () => {
    const solution = solveProjectFormwork(withStock(steelWallScene(), { owned: { [PANEL_ID]: 4 } }))
    const bespoke = solution.bom.filter((line) => line.provenance === 'bespoke')
    expect(bespoke.length).toBeGreaterThan(0)

    expect(solution.supply?.consumedQuantity).toBe(
      bespoke.reduce((total, line) => total + line.quantity, 0),
    )
  })

  test('a stated id the bill never draws on is named, not silently ignored', () => {
    const solution = solveProjectFormwork(
      withStock(steelWallScene(), { owned: { [PANEL_ID]: 4, 'eurex-20-top': 50 } }),
    )

    expect(solution.supply?.unusedOwnedIds).toEqual(['eurex-20-top'])
  })
})

describe('how long the bill is held', () => {
  test('is always answered, unlike the owned/hired split', () => {
    // The asymmetry is the point. Ownership is a fact about the yard and silence about
    // it says nothing; a strike period is a consequence of the code the project is
    // already designed under, so there is always an answer and what nobody stated is
    // named in `assumed` instead.
    const solution = solveProjectFormwork(steelWallScene())

    expect(solution.supply).toBeUndefined()
    expect(solution.hire.longestHours).toBeGreaterThan(0)
    expect(solution.hire.assumed.map((entry) => entry.kind)).toContain('temperature')
  })

  test('a wall’s parts are struck as vertical form, its ties not at all', () => {
    // The join this file is the only place to test: core knows a prop under a slab is a
    // shore and a prop against a wall is a raker, and it cannot tell them apart without
    // the host — which only this layer has.
    const solution = solveProjectFormwork(steelWallScene())
    const byKind = new Map(solution.hire.lines.map((entry) => [entry.line.kind, entry]))

    expect(byKind.get('panel')?.striking?.target).toBe('vertical-form')
    expect(byKind.get('brace')?.striking?.target).toBe('vertical-form')
    // Cut off inside the wall. A 0 would price spent material as plant returned the
    // same day, and it would enter the longest-period comparison as an answer.
    expect(byKind.get('tie')?.hours).toBeUndefined()
    expect(solution.hire.complete).toBe(false)
  })

  test('a slab’s deck and the props under it are two periods, not one', () => {
    // The 2.5× gap the whole drophead market exists on — 100/(t+10) for the soffit form
    // against 250/(t+10) for the shores. A per-element period averages it away and
    // prices the panels for the props' time.
    const solution = solveProjectFormwork(
      sceneOf(makeSlab('slab_1'), makeAssembly('formwork-assembly_1', 'slab_1', 0, 0)),
    )
    const targets = solution.hire.periods.map((period) => period.target)

    expect(targets).toContain('slab-props')
    expect(targets).toContain('slab-soffit-form')
    // Longest first, so a readout leads with when the last of the set comes free.
    expect(targets[0]).toBe('slab-props')
  })

  test('the period is the slowest release across the scope, never a sum', () => {
    // The props holding one slab do not shorten the props holding the next, so adding
    // periods produces a hire longer than the job. This is the figure a planner reads.
    const solution = solveProjectFormwork(
      sceneOf(
        makeSlab('slab_1'),
        makeAssembly('formwork-assembly_1', 'slab_1', 0, 0),
        makeWall('wall_1'),
        makeAssembly('formwork-assembly_2', 'wall_1', 0, 0),
      ),
    )

    expect(solution.hire.longestHours).toBe(
      Math.max(...solution.hire.periods.map((period) => period.hours)),
    )
    expect(solution.hire.longestHours).toBeLessThan(
      solution.hire.periods.reduce((sum, period) => sum + period.hours, 0),
    )
  })

  test('the curing temperature lengthens every period, and the placing one does not', () => {
    // The two halves of a pour take different temperatures and they move the design in
    // opposite directions: a colder mix pushes harder, a colder cure holds longer. One
    // field would be wrong for one of the two answers whichever value it held.
    const scene = steelWallScene()
    const assumed = solveProjectFormwork(scene).hire.longestHours
    const cold = solveProjectFormwork(withSettings(scene, { curing: { surfaceTemperatureC: 5 } }))
    const coldMix = solveProjectFormwork(
      withSettings(scene, { placement: { concreteTemperatureC: 5 } }),
    )

    expect(cold.hire.longestHours).toBeGreaterThan(assumed)
    expect(coldMix.hire.longestHours).toBe(assumed)
    expect(cold.hire.assumed.map((entry) => entry.kind)).not.toContain('temperature')
  })

  test('a drophead halves the soffit form’s period and leaves the props alone', () => {
    // ACI footnote ‡, which needs the pressure code on ACI too — the two families do not
    // share a striking table, and this is the one clause that reads `shoresRemain`.
    const scene = sceneOf(makeSlab('slab_1'), makeAssembly('formwork-assembly_1', 'slab_1', 0, 0))
    const plain = solveProjectFormwork(withSettings(scene, { pressureStandard: 'ACI_347' }))
    const drophead = solveProjectFormwork(
      withSettings(scene, { pressureStandard: 'ACI_347', curing: { shoresRemain: true } }),
    )

    const formOf = (solution: typeof plain) =>
      solution.hire.periods.find((period) => period.target === 'slab-soffit-form')?.hours as number
    const propsOf = (solution: typeof plain) =>
      solution.hire.periods.find((period) => period.target === 'slab-props')?.hours as number

    expect(formOf(drophead)).toBeLessThan(formOf(plain))
    expect(propsOf(drophead)).toBe(propsOf(plain))
  })

  test('an ACI project’s periods are qualifying hours, not calendar days', () => {
    // The failure that turns a correct figure into a missed date. ACI counts only time
    // above 10 °C and the days need not be consecutive, so 4 ACI days can be a fortnight
    // in a cold spring.
    const aci = solveProjectFormwork(
      withSettings(steelWallScene(), { pressureStandard: 'ACI_347' }),
    )
    const bs = solveProjectFormwork(withSettings(steelWallScene(), { pressureStandard: 'BS_8110' }))

    expect(aci.hire.basis).toBe('qualifying-time')
    expect(bs.hire.basis).toBe('calendar')
    expect(aci.hire.warnings.map((warning) => warning.kind)).toContain(
      'qualifying-time-not-calendar',
    )
  })

  test('a DIN project is told its periods came from another code family', () => {
    // DIN publishes no striking table at all — its family answers removal in EN 13670,
    // which is uncovered here. Falling to BS 8110 is right and it is a substitution.
    const din = solveProjectFormwork(
      withSettings(steelWallScene(), { pressureStandard: 'DIN_18218' }),
    )

    expect(din.hire.standard).toBe('BS_8110')
    expect(din.strikingStandardSubstituted).toBe(true)
    expect(solveProjectFormwork(steelWallScene()).strikingStandardSubstituted).toBe(true)
    expect(
      solveProjectFormwork(withSettings(steelWallScene(), { pressureStandard: 'BS_8110' }))
        .strikingStandardSubstituted,
    ).toBe(false)
  })

  test('the hire sits beside the bill line it is about, in the bill’s own order', () => {
    // Read positionally by the panel, the CSV and both AI tools.
    const solution = solveProjectFormwork(steelWallScene())

    expect(solution.hire.lines.map((entry) => entry.line)).toEqual(solution.bom)
  })

  test('an omitted part is out of both passes, so no period describes one', () => {
    // `bomLines` drops an omitted part from the quantity *and* from the marks, and the
    // target map is built off the same filter. Filtered in one place and not the other,
    // a line every mark of which was omitted would still report a period.
    const plain = solveProjectFormwork(steelWallScene())
    const braces = plain.elements[0]?.shutters[0]?.parts.filter(
      (part) => part.kind === 'brace',
    ) as Array<{ mark: string }>
    expect(braces.length).toBeGreaterThan(0)

    const solution = solveProjectFormwork(
      sceneOf(
        makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
        makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, {
          partOverrides: Object.fromEntries(
            braces.map((part) => [part.mark, { omitted: true }]),
          ) as FormworkAssemblyNode['partOverrides'],
        } as Partial<FormworkAssemblyNode>),
      ),
    )

    expect(solution.bom.some((line) => line.kind === 'brace')).toBe(false)
    expect(solution.hire.lines.some((entry) => entry.line.kind === 'brace')).toBe(false)
  })
})

describe('what the bill costs to hold', () => {
  test('a project that has recorded no rate gets no money at all', () => {
    // Sharper than the rack's version of this. A strike period has a code behind it and
    // silence about the cure has a conservative answer; a price has no code at all, so
    // there is nothing to assume and a zero would price the job at nothing.
    expect(solveProjectFormwork(steelWallScene()).cost).toBeUndefined()
    expect(solveProjectFormwork(withStock(steelWallScene(), { owned: {} })).cost).toBeUndefined()
  })

  test('a rate against a panel the bill hires prices the hire', () => {
    const solution = solveProjectFormwork(
      withSettings(steelWallScene(), {
        stock: { owned: {} },
        rates: { currency: 'GBP', byCatalogId: { [PANEL_ID]: { purchasePerUnit: 200 } } },
      }),
    )

    expect(solution.cost?.currency).toBe('GBP')
    // A list price alone prices no hire: there is no percentage to apply to it, and the
    // gap is a table somebody fills in rather than a line that costs nothing.
    expect(solution.cost?.hireCost).toBe(0)
    expect(solution.cost?.gaps).toContain('no-rental-rate')

    const priced = solveProjectFormwork(
      withSettings(steelWallScene(), {
        stock: { owned: {} },
        rates: {
          currency: 'GBP',
          byCatalogId: { [PANEL_ID]: { purchasePerUnit: 200, rentalPercentPerMonth: 3 } },
        },
      }),
    )

    expect(priced.cost?.hireCost).toBeGreaterThan(0)
  })

  test('the cost sits beside the bill line it is about, in the bill’s own order', () => {
    // Read positionally by the CSV and both AI tools, keyed by line object in the panel.
    const solution = solveProjectFormwork(
      withSettings(steelWallScene(), {
        rates: { byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } } },
      }),
    )

    expect(solution.cost?.lines.map((entry) => entry.line)).toEqual(solution.bom)
  })

  test('the yard’s own panels are charged as an internal hire, outside the total', () => {
    // Priced at zero they would make owning formwork free, which is what a reader concludes
    // from a total that quietly includes them. Charged at the project's own rate for the
    // period held, they cost what the plant department would recharge the site — and stay
    // out of `totalCost`, which is cash this job spends.
    const solution = solveProjectFormwork(
      withSettings(steelWallScene(), {
        stock: { owned: { [PANEL_ID]: 4 } },
        rates: { byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } } },
      }),
    )

    const panel = solution.cost?.lines.find((entry) => entry.line.catalogId === PANEL_ID)
    expect(panel?.ownedCost).toBeGreaterThan(0)
    expect(solution.cost?.ownedCost).toBeGreaterThan(0)
    // Nothing left uncharged, so the zero means the recharge is complete rather than that
    // the yard owns nothing.
    expect(solution.cost?.ownedQuantityExcluded).toBe(0)
    const billed = solution.bom.find((line) => line.catalogId === PANEL_ID)?.quantity as number
    // The hire side is charged on the hired remainder only, so the figure moves with the rack.
    expect(panel?.hireCost).toBeLessThan((billed * 10 * (panel?.chargedDays ?? 0)) / 30)
    // The claim the field's name makes: the total is the sum of the lines' own totals, and
    // the internal recharge is beside it rather than inside it.
    const summed = (solution.cost?.lines ?? []).reduce(
      (sum, entry) => sum + (entry.totalCost ?? 0),
      0,
    )
    expect(solution.cost?.totalCost).toBeCloseTo(summed, 6)
    expect(solution.cost?.totalCost).toBeLessThan(summed + (solution.cost?.ownedCost ?? 0))
  })

  test('a minimum hire period charges the term rather than the time held, and says so', () => {
    // The commonest reason a hire invoice does not match a programme. A wall form is
    // struck in hours under BS 8110 and charged for the whole minimum.
    const rates = { byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 30 } } }
    const short = solveProjectFormwork(
      withSettings(steelWallScene(), { pressureStandard: 'BS_8110', rates }),
    )
    const minimum = solveProjectFormwork(
      withSettings(steelWallScene(), {
        pressureStandard: 'BS_8110',
        rates: { ...rates, minHireDays: 28 },
      }),
    )

    expect(minimum.cost?.linesAtMinimum.length).toBeGreaterThan(0)
    expect(minimum.cost?.hireCost).toBeGreaterThan((short.cost?.hireCost ?? 0) * 10)
    const panel = minimum.cost?.lines.find((entry) => entry.line.catalogId === PANEL_ID)
    expect(panel?.chargedDays).toBe(28)
    expect(panel?.atMinimumPeriod).toBe(true)
  })

  test('a tie is hired and never struck, so it is reported unpriceable rather than free', () => {
    // Two right answers that together leave a real cost with no way to price it: the tie
    // carries a catalog id so the split hires it, and nothing strikes it because it is
    // cut off inside the wall. A bill missing every tie still totals cleanly.
    const solution = solveProjectFormwork(
      withSettings(steelWallScene(), {
        stock: { owned: {} },
        rates: { byCatalogId: { 'doka-framax-tie-588681000': { rentalPerUnitPerMonth: 1 } } },
      }),
    )
    const tie = solution.cost?.lines.find((entry) => entry.line.kind === 'tie')

    expect(tie?.gaps).toContain('hired-but-never-struck')
    expect(tie?.totalCost).toBeUndefined()
    expect(solution.cost?.complete).toBe(false)
  })

  test('a stated finance rate prices the money the job ties up, outside the cash total', () => {
    // The scenario whole: the rate is on the table, the programme is dated, and the
    // finance figure is computed over the programme's own span — beside the cash total,
    // never inside it, so a total that has to reconcile against an invoice still can.
    const dated = sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
    )
    const base = {
      stock: { owned: {} },
      pressureStandard: 'BS_8110',
      schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
      rates: { byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } } },
    }
    const plain = solveProjectFormwork(withSettings(dated, base))
    const financed = solveProjectFormwork(
      withSettings(dated, { ...base, rates: { ...base.rates, financeRatePerAnnum: 8 } }),
    )

    expect(financed.schedule?.firstErectAt).toBe('2026-03-01')
    expect(financed.cost?.financeCost).toBeGreaterThan(0)
    expect(financed.cost?.financeNote).toContain('8% a year')
    // The cash total is unchanged by the finance figure's presence, which is the whole
    // point of reporting it beside rather than inside.
    expect(financed.cost?.totalCost).toBeCloseTo(plain.cost?.totalCost ?? 0, 6)
    expect(projectFormworkCaveats(financed).some((c) => c.includes('outside the cash total'))).toBe(
      true,
    )
  })

  test('no finance rate means no finance figure, even on a dated programme', () => {
    // The rate is the only gate: a dated programme with no rate gets no finance figure,
    // because a figure that depends on a rate nobody stated would be a rate assumed.
    const dated = sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
    )
    const solution = solveProjectFormwork(
      withSettings(dated, {
        stock: { owned: {} },
        pressureStandard: 'BS_8110',
        schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
        rates: { byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } } },
      }),
    )

    expect(solution.schedule?.firstErectAt).toBe('2026-03-01')
    expect(solution.cost?.financeCost).toBeUndefined()
    expect(solution.cost?.financeNote).toBeUndefined()
  })
})

describe('what the bill costs to form', () => {
  const NORMS = { panel: { erectHours: 0.5, strikeHours: 0.25 } }

  test('a project that has stated no norms gets no hours at all', () => {
    // For the price's reason, only harder: an output norm is a fact about a gang, so
    // there is not even a conservative figure to fall back to. Zero hours would read as
    // a job nobody has to build.
    expect(solveProjectFormwork(steelWallScene()).labour).toBeUndefined()
    expect(
      solveProjectFormwork(withSettings(steelWallScene(), { rates: { gangRatePerHour: 32 } }))
        .labour,
    ).toBeUndefined()
  })

  test('multiplies the project’s own norm over the bill’s fittings', () => {
    const solution = solveProjectFormwork(
      withSettings(steelWallScene(), { labour: { byPartKind: NORMS } }),
    )
    // Every panel-kind line, not one catalog id: a norm is keyed by kind because fitting
    // a 0.6 m panel and a 0.9 m one is the same work to a carpenter.
    const panels = solution.bom
      .filter((line) => line.kind === 'panel')
      .reduce((total, line) => total + line.quantity, 0)

    expect(panels).toBeGreaterThan(0)
    expect(solution.labour?.erectHours).toBeCloseTo(panels * 0.5, 6)
    expect(solution.labour?.strikeHours).toBeCloseTo(panels * 0.25, 6)
    expect(solution.labour?.totalHours).toBeCloseTo(panels * 0.75, 6)
  })

  test('counts the same bill the money is counted over, not the sets', () => {
    // The join that decides whether the figure is the work or a fraction of it. A panel
    // fitted on three pours is three in the bill and one in the peak, and a gang is paid
    // each time it fits it.
    const solution = solveProjectFormwork(
      withSettings(steelWallScene(), { labour: { byPartKind: NORMS } }),
    )

    expect(solution.labour?.lines.map((entry) => entry.line)).toEqual(solution.bom)
  })

  test('prices the hours only where a gang rate exists, and keeps them out of the cost', () => {
    const hoursOnly = solveProjectFormwork(
      withSettings(steelWallScene(), { labour: { byPartKind: NORMS } }),
    )
    expect(hoursOnly.labour?.totalHours).toBeGreaterThan(0)
    expect(hoursOnly.labour?.cost).toBeUndefined()
    expect(hoursOnly.labour?.gaps).toContain('no-gang-rate')

    const priced = solveProjectFormwork(
      withSettings(steelWallScene(), {
        labour: { byPartKind: NORMS },
        rates: {
          currency: 'GBP',
          gangRatePerHour: 32,
          byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } },
        },
      }),
    )

    expect(priced.labour?.cost).toBeCloseTo((priced.labour?.totalHours ?? 0) * 32, 6)
    expect(priced.labour?.currency).toBe('GBP')
    // Two costs negotiated with two different people. Nothing anywhere sums them, and the
    // hire total is what it was before a norm existed.
    const unlaboured = solveProjectFormwork(
      withSettings(steelWallScene(), {
        rates: {
          currency: 'GBP',
          byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } },
        },
      }),
    )
    expect(priced.cost?.totalCost).toBeCloseTo(unlaboured.cost?.totalCost ?? -1, 6)
  })

  test('reports the fittings no norm covers rather than costing them at zero', () => {
    // A steel-panel wall bills ties, walers and accessories alongside its panels, so a
    // panel-only norm covers a fraction of the job and the total has to say so.
    const solution = solveProjectFormwork(
      withSettings(steelWallScene(), { labour: { byPartKind: NORMS } }),
    )

    expect(solution.labour?.complete).toBe(false)
    expect(solution.labour?.unnormedFittings).toBeGreaterThan(0)
    expect(solution.labour?.unnormedKinds).toContain('tie')
    expect(solution.labour?.byKind.map((kind) => kind.kind)).toEqual(['panel'])
  })

  test('leads the caveats with what an hours figure is not', () => {
    // It reads like a programme and it is not one: no gang size exists anywhere in this
    // model, so the division into days is the reader's own decision.
    const caveats = projectFormworkCaveats(
      solveProjectFormwork(withSettings(steelWallScene(), { labour: { byPartKind: NORMS } })),
    )

    expect(caveats.some((c) => c.includes('not a duration'))).toBe(true)
    expect(caveats.some((c) => c.includes('gang size'))).toBe(true)
    expect(caveats.some((c) => c.includes('carry no norm at all'))).toBe(true)
  })

  test('says a priced takeoff has no labour in it where nobody stated a norm', () => {
    // The largest thing missing from the money, and silence about it is what makes a hire
    // total get read as the cost of forming the job. Only where money exists: a takeoff
    // with no figures at all already tells the reader that, and two silences about one
    // job read as two separate problems.
    const priced = projectFormworkCaveats(
      solveProjectFormwork(
        withSettings(steelWallScene(), {
          rates: { currency: 'GBP', byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } } },
        }),
      ),
    )
    expect(priced.some((c) => c.includes('no labour in this takeoff at all'))).toBe(true)
    expect(priced.some((c) => c.includes('not a duration'))).toBe(false)

    const unpriced = projectFormworkCaveats(solveProjectFormwork(steelWallScene()))
    expect(unpriced.some((c) => c.includes('no labour in this takeoff at all'))).toBe(false)
  })
})

describe('when the pours happen', () => {
  /** A steel-panel wall in two lifts, so a scope can have one pour dated and one not. */
  function twoLiftScene(
    first: Partial<FormworkAssemblyNode>,
    second: Partial<FormworkAssemblyNode>,
  ): Record<string, AnyNode> {
    return sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, first),
      makeAssembly('formwork-assembly_2', 'wall_1', 0, 1, second),
    )
  }

  test('a project that has dated no pour gets no programme at all', () => {
    // The rates' rule rather than the hire's. A period is a consequence of a published
    // code; a date has no code behind it, and deriving one from the solve order would be
    // a programme nobody agreed to printed beside geometry that is actually derived.
    expect(solveProjectFormwork(steelWallScene()).schedule).toBeUndefined()
    expect(
      solveProjectFormwork(withSettings(steelWallScene(), { schedule: { erectionLeadDays: 3 } }))
        .schedule,
    ).toBeUndefined()
  })

  test('one dated pour opens the programme, and the strike date follows the code', () => {
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
        ),
        { pressureStandard: 'BS_8110', schedule: { erectionLeadDays: 2, returnLeadDays: 1 } },
      ),
    )

    const pour = solution.schedule?.pours[0]
    expect(pour?.pourAt).toBe('2026-03-02')
    expect(pour?.erectAt).toBe('2026-02-28')
    // BS 8110's vertical row is 12 h at the table's own column, so the day after.
    expect(pour?.strikeAt).toBe('2026-03-03')
    expect(pour?.releaseAt).toBe('2026-03-04')
    expect(solution.schedule?.complete).toBe(true)
  })

  test('a date is per pour, so two lifts of one wall are two rows', () => {
    // The reason `pourAt` is on the assembly rather than on the wall: a 9 m wall in two
    // lifts is two dates a week apart, and a date on the host could only be one of them.
    const solution = solveProjectFormwork(
      withSettings(twoLiftScene({ pourAt: '2026-03-02' }, { pourAt: '2026-03-09' }), {
        pressureStandard: 'BS_8110',
        schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
      }),
    )

    expect(solution.schedule?.pours).toHaveLength(2)
    expect(solution.schedule?.pours.map((pour) => pour.pourAt).sort()).toEqual([
      '2026-03-02',
      '2026-03-09',
    ])
    expect(solution.schedule?.firstErectAt).toBe('2026-03-01')
    expect(solution.schedule?.lastReleaseAt).toBe('2026-03-11')
    expect(solution.schedule?.scheduledCount).toBe(2)
  })

  test('an undated lift is named rather than dropped, so the window is not read as the job', () => {
    const solution = solveProjectFormwork(
      withSettings(twoLiftScene({ pourAt: '2026-03-02' }, {}), {
        pressureStandard: 'BS_8110',
        schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
      }),
    )

    expect(solution.schedule?.scheduledCount).toBe(1)
    expect(solution.schedule?.unscheduled.map((pour) => pour.id)).toEqual(['formwork-assembly_2'])
    expect(solution.schedule?.complete).toBe(false)
    expect(projectFormworkCaveats(solution).some((line) => line.includes('1 of 2'))).toBe(true)
  })

  test('the periods are the hire’s own, so a strike date cannot disagree with a duration', () => {
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
        ),
        { pressureStandard: 'BS_8110', curing: { surfaceTemperatureC: 5 } },
      ),
    )

    // A cold cure lengthens the hold, and it has to lengthen both figures identically —
    // the strike date is the hire duration on a calendar, not a second reading of the cure.
    const strike = solution.schedule?.pours[0]?.strikes[0]
    expect(strike?.striking).toBe(solution.hire.periods[0])
    expect(strike?.striking.hours).toBe(solution.hire.longestHours)
  })

  test('under ACI the dates are the earliest, and the takeoff says so', () => {
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
        ),
        { pressureStandard: 'ACI_347' },
      ),
    )

    // ACI counts qualifying hours above 10 °C rather than calendar days, so a cold spell
    // pushes every date later and nothing in this model knows the weather.
    expect(solution.schedule?.earliestOnly).toBe(true)
    expect(projectFormworkCaveats(solution).some((line) => line.includes('earliest'))).toBe(true)
  })
})

describe('how many sets the job needs', () => {
  /** Two lifts of one wall, dated as the caller asks. */
  function twoLifts(
    first: Partial<FormworkAssemblyNode>,
    second: Partial<FormworkAssemblyNode>,
  ): Record<string, AnyNode> {
    return sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, first),
      makeAssembly('formwork-assembly_2', 'wall_1', 0, 1, second),
    )
  }

  const leads = {
    pressureStandard: 'BS_8110',
    schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
  } as const

  test('an unprogrammed project gets no count, because there is nothing to sweep', () => {
    expect(solveProjectFormwork(steelWallScene()).sets).toBeUndefined()
  })

  test('two lifts a week apart share one set, so the peak is under the bill', () => {
    // The whole point of the count. The bill is both lifts' panels because that is what
    // passes through the job; the peak is one lift's, because the first lift's panels are
    // struck and back on the rack before the second needs them.
    const solution = solveProjectFormwork(
      withSettings(twoLifts({ pourAt: '2026-03-02' }, { pourAt: '2026-03-16' }), leads),
    )

    const peak = solution.sets?.peaks[0]
    expect(peak).toBeDefined()
    expect(peak?.peakQuantity).toBeLessThan(peak?.totalFitted as number)
    expect(peak?.reuseFactor).toBe(2)
    expect(solution.sets?.peakConcurrentPours).toBe(1)
    expect(solution.sets?.coverage).toBe(1)
  })

  test('two lifts on one day need both sets, and the peak equals the bill', () => {
    const solution = solveProjectFormwork(
      withSettings(twoLifts({ pourAt: '2026-03-02' }, { pourAt: '2026-03-02' }), leads),
    )

    const peak = solution.sets?.peaks[0]
    expect(peak?.peakQuantity).toBe(peak?.totalFitted)
    expect(peak?.reuseFactor).toBe(1)
    expect(solution.sets?.peakConcurrentPours).toBe(2)
    expect(peak?.peakPourIds).toEqual(['formwork-assembly_1', 'formwork-assembly_2'])
  })

  test('a peak is quantities of a catalog id, so it is traceable to the bill’s own lines', () => {
    const solution = solveProjectFormwork(
      withSettings(twoLifts({ pourAt: '2026-03-02' }, { pourAt: '2026-03-02' }), leads),
    )

    for (const peak of solution.sets?.peaks ?? []) {
      const line = solution.bom.find((entry) => entry.catalogId === peak.catalogId)
      expect(line).toBeDefined()
      // The bill is the whole scope and the peak is a moment in it, so a peak can never
      // exceed the bill — if it did, the sweep would be counting stock the job never had.
      expect(peak.peakQuantity).toBeLessThanOrEqual(line?.quantity as number)
    }
  })

  test('half a programme is refused rather than counted low, and the caveat says why', () => {
    // One lift of two dated is 50 %, under the 90 % threshold. The sweep would report one
    // lift's worth as the job's peak — a plausible number, and half the answer.
    const solution = solveProjectFormwork(
      withSettings(twoLifts({ pourAt: '2026-03-02' }, {}), leads),
    )

    expect(solution.schedule).toBeDefined()
    expect(solution.sets).toBeUndefined()
    expect(projectFormworkCaveats(solution).some((line) => line.includes('No set count'))).toBe(
      true,
    )
  })

  test('an unprogrammed project is not told twice that it has no count', () => {
    // The schedule's own absence already says nothing is dated. Repeating it as a set-count
    // refusal would make one missing input read as two problems.
    const caveats = projectFormworkCaveats(solveProjectFormwork(steelWallScene()))

    expect(caveats.some((line) => line.includes('No set count'))).toBe(false)
  })

  test('a cut board is not counted as reused, because a board is cut once', () => {
    // Timber formwork puts bespoke ply and cut boards in the bill. They are made for the
    // pour and go in a skip, so they are not stock a set is counted out of — reported as
    // reused they would say one board serves both lifts.
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', { formworkType: 'timber' } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
          makeAssembly('formwork-assembly_2', 'wall_1', 0, 1, { pourAt: '2026-03-16' }),
        ),
        leads,
      ),
    )

    const bespokeIds = new Set(
      solution.bom.filter((line) => line.provenance === 'bespoke').map((line) => line.catalogId),
    )
    for (const peak of solution.sets?.peaks ?? []) {
      expect(bespokeIds.has(peak.catalogId)).toBe(false)
    }
  })
})

describe('what the job has to go out and get', () => {
  /** Two lifts of one wall a fortnight apart, so the same set serves both. */
  function sequential(settings: Record<string, unknown>): Record<string, AnyNode> {
    return withSettings(
      sceneOf(
        makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
        makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
        makeAssembly('formwork-assembly_2', 'wall_1', 0, 1, { pourAt: '2026-03-16' }),
      ),
      {
        pressureStandard: 'BS_8110',
        schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
        ...settings,
      },
    )
  }

  test('the acquisition list is the peak against the rack, not the bill against it', () => {
    // The whole reason this exists. Both lifts pass 20 panels through the job and the rack
    // holds 4, so the split hires 16 — but only 10 stand at once, so 6 have to be acquired.
    // Quoting the split's 16 as an order is the error, and it is nearly 3x here.
    const solution = solveProjectFormwork(sequential({ stock: { owned: { [PANEL_ID]: 4 } } }))
    const panel = solution.acquisition?.lines.find((line) => line.catalogId === PANEL_ID)
    const hired = solution.supply?.lines.find((entry) => entry.line.catalogId === PANEL_ID)

    expect(panel?.ownedQuantity).toBe(4)
    expect(panel?.shortfall).toBe((panel?.peakQuantity as number) - 4)
    expect(panel?.shortfall).toBeLessThan(hired?.hiredQuantity as number)
    expect(panel?.reuseFactor).toBe(2)
  })

  test('a rack that covers the peak has nothing to acquire, however large the bill', () => {
    const solution = solveProjectFormwork(sequential({ stock: { owned: { [PANEL_ID]: 500 } } }))
    const panel = solution.acquisition?.lines.find((line) => line.catalogId === PANEL_ID)

    expect(panel?.shortfall).toBe(0)
    expect(panel?.surplus).toBeGreaterThan(0)
    expect(solution.acquisition?.shortfalls.some((line) => line.catalogId === PANEL_ID)).toBe(false)
  })

  test('a shortfall is reported unpriced, because it is useful before any rate exists', () => {
    const solution = solveProjectFormwork(sequential({ stock: { owned: { [PANEL_ID]: 4 } } }))
    const panel = solution.acquisition?.lines.find((line) => line.catalogId === PANEL_ID)

    expect(solution.acquisition?.shortfallQuantity).toBeGreaterThan(0)
    expect(panel?.hireCost).toBeUndefined()
    // No verdict at all rather than a default one: "hire" printed off no rates is a
    // recommendation nobody made.
    expect(panel?.verdict).toBeUndefined()
    expect(panel?.paybackJobs).toBeUndefined()
  })

  test('rates put a payback beside the verdict, and hire wins over one job’s span', () => {
    const solution = solveProjectFormwork(
      sequential({
        stock: { owned: { [PANEL_ID]: 4 } },
        rates: {
          currency: 'GBP',
          byCatalogId: { [PANEL_ID]: { purchasePerUnit: 210, rentalPercentPerMonth: 3 } },
        },
      }),
    )
    const panel = solution.acquisition?.lines.find((line) => line.catalogId === PANEL_ID)

    expect(solution.acquisition?.currency).toBe('GBP')
    expect(panel?.verdict).toBe('hire')
    // The figure that makes the verdict arguable: many jobs like this one before the
    // purchase pays back, which is a question about an order book rather than this job.
    expect(panel?.paybackJobs).toBeGreaterThan(1)
    expect(solution.acquisition?.purchaseCost).toBeGreaterThan(
      solution.acquisition?.hireCost as number,
    )
  })

  test('a rack with no programme gets no acquisition, and is told about the dates once', () => {
    // Two inputs missing must not read as two problems. The schedule's own absence already
    // says nothing is dated, so the rack half stays quiet.
    const solution = solveProjectFormwork(withStock(steelWallScene(), { owned: { [PANEL_ID]: 4 } }))
    const caveats = projectFormworkCaveats(solution)

    expect(solution.acquisition).toBeUndefined()
    expect(caveats.some((line) => line.includes('what to buy or hire'))).toBe(false)
  })

  test('a programme with no rack says so, rather than implying the yard owns nothing', () => {
    const solution = solveProjectFormwork(sequential({}))
    const caveats = projectFormworkCaveats(solution)

    expect(solution.sets).toBeDefined()
    expect(solution.acquisition).toBeUndefined()
    expect(caveats.some((line) => line.includes('what to buy or hire'))).toBe(true)
    expect(caveats.some((line) => line.includes('ownedStock'))).toBe(true)
  })

  test('the acquisition’s own caveats are carried verbatim, so all three surfaces warn alike', () => {
    const solution = solveProjectFormwork(sequential({ stock: { owned: { [PANEL_ID]: 4 } } }))
    const caveats = projectFormworkCaveats(solution)

    expect(caveats).toEqual(
      expect.arrayContaining(acquireCaveats(solution.acquisition as FormworkAcquisition)),
    )
    // And not the absence sentence beside them, which would be the same fact twice.
    expect(caveats.some((line) => line.includes('no rack is recorded'))).toBe(false)
  })
})

describe('what has to happen before what', () => {
  const leads = {
    pressureStandard: 'BS_8110',
    schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
  } as const

  /**
   * A rack holding this share of every peak the scope has.
   *
   * Derived rather than written out, because a rack naming only the panel is the trap this suite
   * has fallen into before: a steel-panel wall bills ties and walers too, so a panel-only rack
   * leaves those short — and the shortfall list is sorted by size, which puts the tie at the head
   * of the answers and makes an assertion about `answers[0]` an assertion about the wrong item.
   */
  function rackFor(nodes: Record<string, AnyNode>, share: number): Record<string, number> {
    const peaks = solveProjectFormwork(nodes).sets?.peaks ?? []
    return Object.fromEntries(
      peaks.map((peak) => [peak.catalogId, Math.floor(peak.peakQuantity * share)]),
    )
  }

  test('the lift chain reaches the solution off the scene, with no cast order anywhere', () => {
    // The claim that made this buildable: precedence needs no new field. Two lifts of one wall
    // state a dependency, and nothing in the scene had to be edited to say so.
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', { height: 9, maxLiftHeight: 3 } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
          makeAssembly('formwork-assembly_2', 'wall_1', 0, 1, { pourAt: '2026-03-16' }),
        ),
        leads,
      ),
    )

    expect(solution.sequence?.edges).toHaveLength(1)
    expect(solution.sequence?.edges[0]).toMatchObject({ reason: 'lift' })
    expect(solution.sequence?.gaps).not.toContain('nothing-sequenced')
  })

  test('the cast order stated on the wall becomes a dependency between pours', () => {
    // The join only this layer can make: `castOrder` is on the element and a pour is a shutter.
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', {
            formworkType: 'steel-panel',
            castOrder: 1,
          } as Partial<WallNode>),
          makeWall('wall_2', {
            start: [0, 4],
            end: [6, 4],
            formworkType: 'steel-panel',
            castOrder: 2,
          } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
          makeAssembly('formwork-assembly_2', 'wall_2', 0, 0, { pourAt: '2026-03-16' }),
        ),
        leads,
      ),
    )

    expect(solution.sequence?.edges).toHaveLength(1)
    expect(solution.sequence?.edges[0]).toMatchObject({
      from: 'formwork-assembly_1',
      to: 'formwork-assembly_2',
      reason: 'cast-order',
    })
    // And the successor has a float bounded by its predecessor's stated date rather than by the
    // programme's start.
    const later = solution.sequence?.pours.find((pour) => pour.id === 'formwork-assembly_2')
    expect(later?.earliestPourAt).toBe('2026-03-02')
    expect(later?.moveEarlierDays).toBe(14)
  })

  test('a monolithic pour is one node in the sequence, and its members travel with it', () => {
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', {
            formworkType: 'steel-panel',
            pourId: 'P1',
          } as Partial<WallNode>),
          makeWall('wall_2', {
            start: [0, 4],
            end: [6, 4],
            formworkType: 'steel-panel',
            pourId: 'P1',
          } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
          makeAssembly('formwork-assembly_2', 'wall_2', 0, 0, { pourAt: '2026-03-02' }),
        ),
        leads,
      ),
    )

    expect(solution.sequence?.pours).toHaveLength(1)
    expect(solution.sequence?.pours[0]).toMatchObject({ id: 'P1', monolithic: true })
    expect(solution.sequence?.pours[0]?.elementIds).toEqual(['wall_1', 'wall_2'])
  })

  test('an undated project gets no sequence, because a graph with no float is not one', () => {
    expect(solveProjectFormwork(steelWallScene()).sequence).toBeUndefined()
  })

  test('alternate bays stated on the wall order its segments and report the parity', () => {
    // The join only this layer can make, cast order's reason again: the statement is on the
    // element, a pour is a shutter, and the sequence reads the flag through the walk.
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', { alternateBays: true } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
          makeAssembly('formwork-assembly_2', 'wall_1', 1, 0, { pourAt: '2026-03-16' }),
        ),
        leads,
      ),
    )

    expect(solution.sequence?.edges).toEqual([
      expect.objectContaining({
        from: 'formwork-assembly_1',
        to: 'formwork-assembly_2',
        reason: 'alternate-bay',
      }),
    ])
    expect(solution.sequence?.alternateBays).toEqual([
      { elementId: 'wall_1', parity: 'odd-bays-first', fromDates: true },
    ])
  })

  test('a project-wide alternate-bay statement reaches every element that does not opt out', () => {
    // The pours settings group states it for the job; an element's own false is the one
    // wall on the job that is not built that way.
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', {}),
          makeWall('wall_2', {
            start: [0, 4],
            end: [6, 4],
            alternateBays: false,
          } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
          makeAssembly('formwork-assembly_2', 'wall_1', 1, 0, { pourAt: '2026-03-16' }),
          makeAssembly('formwork-assembly_3', 'wall_2', 0, 0, { pourAt: '2026-03-02' }),
          makeAssembly('formwork-assembly_4', 'wall_2', 1, 0, { pourAt: '2026-03-16' }),
        ),
        { ...leads, pours: { alternateBays: true } },
      ),
    )

    expect(solution.sequence?.alternateBays?.map((plan) => plan.elementId)).toEqual(['wall_1'])
    expect(solution.sequence?.edges).toEqual([
      expect.objectContaining({
        from: 'formwork-assembly_1',
        to: 'formwork-assembly_2',
        reason: 'alternate-bay',
      }),
    ])
  })

  test('the resequencing answer names the pour to move instead of the panels to buy', () => {
    // The end of the chain: short on the peak day, and one of the two pours has float. The answer
    // is a move rather than an order, and the reader gets both. The rack holds exactly one pour's
    // worth of everything, so moving either pour out of the overlap clears every shortage at once.
    const scene = sceneOf(
      makeWall('wall_1', {
        formworkType: 'steel-panel',
        castOrder: 1,
      } as Partial<WallNode>),
      makeWall('wall_2', {
        start: [0, 4],
        end: [6, 4],
        formworkType: 'steel-panel',
        castOrder: 2,
      } as Partial<WallNode>),
      makeWall('wall_3', {
        start: [0, 8],
        end: [6, 8],
        formworkType: 'steel-panel',
        castOrder: 3,
      } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
      makeAssembly('formwork-assembly_2', 'wall_2', 0, 0, { pourAt: '2026-03-02' }),
      makeAssembly('formwork-assembly_3', 'wall_3', 0, 0, { pourAt: '2026-04-06' }),
    )
    const solution = solveProjectFormwork(
      withSettings(scene, { ...leads, stock: { owned: rackFor(withSettings(scene, leads), 0.5) } }),
    )
    const answer = solution.resequence?.answers[0]

    expect(solution.acquisition?.shortfallQuantity).toBeGreaterThan(0)
    expect(answer?.refusal).toBeUndefined()
    const move = answer?.moves[0]
    expect(move?.pourId).toBe('formwork-assembly_2')
    expect(move?.peakAfter).toBeLessThan(move?.peakBefore as number)
    expect(move?.clearsShortage).toBe(true)
    // Every shortage in the scope, not only the largest: one pour leaving the overlap halves all
    // of them together, which is what makes the move worth proposing over an order.
    expect(solution.resequence?.unavoidable).toEqual([])
  })

  test('a shortage with nothing short gets no resequencing pass at all', () => {
    const scene = sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
    )
    const solution = solveProjectFormwork(
      withSettings(scene, { ...leads, stock: { owned: rackFor(withSettings(scene, leads), 5) } }),
    )

    expect(solution.acquisition?.shortfalls).toEqual([])
    expect(solution.resequence).toBeUndefined()
  })

  test('the sequence’s caveats travel with the takeoff, critical-path warning and all', () => {
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', { height: 9, maxLiftHeight: 3 } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
          makeAssembly('formwork-assembly_2', 'wall_1', 0, 1, { pourAt: '2026-03-16' }),
        ),
        leads,
      ),
    )
    const caveats = projectFormworkCaveats(solution)

    expect(caveats.some((line) => line.includes('not a critical path'))).toBe(true)
    expect(caveats.some((line) => line.includes('not slack a gang can spend'))).toBe(true)
  })

  test('an unprogrammed takeoff says nothing about float', () => {
    const caveats = projectFormworkCaveats(solveProjectFormwork(steelWallScene()))

    expect(caveats.some((line) => line.includes('not a critical path'))).toBe(false)
  })

  test('a committed pour is booked plant, swept over the bookings alone', () => {
    // Two walls overlapping on one day, one of them agreed with the hire desk. The window is
    // one wall's panels rather than two, which is the claim the whole block turns on: what is
    // booked is smaller than what the job needs, and this is the smaller figure.
    const scene = sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeWall('wall_2', {
        start: [0, 4],
        end: [6, 4],
        formworkType: 'steel-panel',
      } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, {
        pourAt: '2026-03-02',
        committedPourAt: '2026-03-02',
      }),
      makeAssembly('formwork-assembly_2', 'wall_2', 0, 0, { pourAt: '2026-03-02' }),
    )
    const solution = solveProjectFormwork(withSettings(scene, leads))

    expect(solution.commitments?.committedPours).toBe(1)
    expect(solution.commitments?.totalPours).toBe(2)
    expect(solution.commitments?.committedPourIds).toEqual(['formwork-assembly_1'])
    const window = solution.commitments?.windows[0]
    const peak = solution.sets?.peaks.find((entry) => entry.catalogId === window?.catalogId)
    expect(window?.committedQuantity).toBeLessThan(peak?.peakQuantity as number)
  })

  test('a booked pour the programme has moved off is reported as a drift, not corrected', () => {
    // The state the block exists for. Moving a booked pour is allowed — sites do it — so the
    // takeoff keeps both days and says how far apart they are, because the remedy is a call to
    // the hire desk rather than a figure to reconcile.
    const scene = sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, {
        pourAt: '2026-03-09',
        committedPourAt: '2026-03-02',
      }),
    )
    const solution = solveProjectFormwork(withSettings(scene, leads))

    expect(solution.commitments?.drifts).toEqual([
      {
        pourId: 'formwork-assembly_1',
        committedAt: '2026-03-02',
        pourAt: '2026-03-09',
        driftDays: 7,
      },
    ])
    const caveats = projectFormworkCaveats(solution)
    expect(caveats.some((line) => line.includes('moved off the day the plant was booked'))).toBe(
      true,
    )
    expect(caveats.some((line) => line.includes('a call to make'))).toBe(true)
  })

  test('a booked pour is not offered as a move, and is still in the peak the move clears', () => {
    // The two halves of the exclusion, in the one place they can disagree. The booked pour is
    // no longer a candidate, so the proposal names the other one — and it is still standing in
    // the overlap, so the peak the move is measured against is unchanged by the booking.
    const scene = (committed: boolean) =>
      sceneOf(
        makeWall('wall_1', { formworkType: 'steel-panel', castOrder: 1 } as Partial<WallNode>),
        makeWall('wall_2', {
          start: [0, 4],
          end: [6, 4],
          formworkType: 'steel-panel',
          castOrder: 2,
        } as Partial<WallNode>),
        makeWall('wall_3', {
          start: [0, 8],
          end: [6, 8],
          formworkType: 'steel-panel',
          castOrder: 3,
        } as Partial<WallNode>),
        makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
        makeAssembly('formwork-assembly_2', 'wall_2', 0, 0, {
          pourAt: '2026-03-02',
          ...(committed ? { committedPourAt: '2026-03-02' } : {}),
        }),
        makeAssembly('formwork-assembly_3', 'wall_3', 0, 0, { pourAt: '2026-04-06' }),
      )
    const solve = (committed: boolean) => {
      const built = scene(committed)
      return solveProjectFormwork(
        withSettings(built, {
          ...leads,
          stock: { owned: rackFor(withSettings(built, leads), 0.5) },
        }),
      )
    }

    const free = solve(false)
    const booked = solve(true)
    // Free, the proposal moves the second pour. Booked, that move is nobody's to make.
    expect(free.resequence?.answers[0]?.moves[0]?.pourId).toBe('formwork-assembly_2')
    const answer = booked.resequence?.answers[0]
    expect(answer?.committedPourIds).toEqual(['formwork-assembly_2'])
    expect(answer?.moves.some((move) => move.pourId === 'formwork-assembly_2')).toBe(false)
    // Still an obstacle: the peak a surviving move starts from is the same peak as before.
    expect(answer?.shortfall).toBe(free.resequence?.answers[0]?.shortfall as number)
  })

  test('a programme nobody has committed to carries no commitments at all', () => {
    const scene = sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { pourAt: '2026-03-02' }),
    )

    expect(solveProjectFormwork(withSettings(scene, leads)).commitments).toBeUndefined()
  })
})

describe('what the crane lifts on this job', () => {
  /**
   * The chart on the level, so *both* readers of it find the same one.
   *
   * `withSettings` parents the node to a site, which the takeoff scans and the geometry's
   * ancestor walk never reaches — and a crane only the takeoff can see is the one wiring
   * failure worth guarding here: the faces would be grouped as one pick each and then
   * measured against a chart the layout never saw.
   */
  const withCrane = (crane: Record<string, unknown>) => {
    const nodes = steelWallScene()
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
      crane,
    } as unknown as AnyNode
    return solveProjectFormwork(nodes)
  }

  test('rolls the gangs the geometry already produced into a schedule', () => {
    // Off the layout rather than a second division, so the schedule cannot disagree with
    // the drawing about where a gang breaks. A 6 m × 6 m steel-panel wall with no chart
    // recorded is one 2062 kg pick, which is the whole face.
    const solution = solveProjectFormwork(steelWallScene())

    expect(solution.lifts?.pickCount).toBe(1)
    expect(solution.lifts?.heaviestPickKg).toBe(2062)
    expect(solution.lifts?.picks[0]?.elementId).toBe('wall_1')
    expect(solution.lifts?.picks[0]?.panelCount).toBe(20)
  })

  test('the heaviest pick is a fraction of the bill weight, and the two are not the same figure', () => {
    // The confusion the block exists to prevent, in the one place both numbers are in
    // frame: 2062 kg is the hook and 4596 kg is what passes through the job.
    const solution = solveProjectFormwork(steelWallScene())
    const billKg = solution.bom.reduce((sum, line) => sum + (line.totalWeightKg ?? 0), 0)

    expect(billKg).toBeGreaterThan(solution.lifts?.heaviestPickKg as number)
  })

  test('the same chart that grouped the faces is the chart the picks are read against', () => {
    // The join: a 300 kg machine divides that wall into ten picks and then takes every one
    // of them. A schedule read against a chart the layout never saw would report ten picks
    // measured against a different crane.
    const solution = withCrane({
      capacityCurve: [{ radiusM: 30, capacityKg: 300 }],
      hookHeightM: 40,
    })

    expect(solution.lifts?.pickCount).toBe(10)
    expect(solution.lifts?.heaviestPickKg).toBeLessThanOrEqual(300)
    expect(solution.lifts?.picks.every((pick) => pick.verdict === 'lifts')).toBe(true)
    expect(solution.lifts?.crane?.worstCapacityKg).toBe(300)
    expect(solution.lifts?.crane?.hookHeightMm).toBe(40_000)
  })

  test('a scope with nothing ganged carries no schedule at all', () => {
    // A slab is decked off joists rather than panelled from a run, so it has no gang and
    // no pick. An empty schedule would read as a crane with nothing to do on a job that is
    // simply not craning its formwork in.
    const solution = solveProjectFormwork(
      sceneOf(makeSlab('slab_1'), makeAssembly('formwork-assembly_1', 'slab_1', 0, 0)),
    )

    expect(solution.elements).toHaveLength(1)
    expect(solution.lifts).toBeUndefined()
  })
})

describe('what it costs to deliver and to lift', () => {
  const PRICED = {
    currency: 'GBP',
    transportPerLoad: 400,
    cranePerHour: 120,
    byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } },
  }

  test('a project with no payload and no cycle time carries neither cost', () => {
    // The rates' rule again, and this pair has been named in `cost.excludes` on every
    // surface since there was a cost: a payload is the lorry the yard sends and a cycle
    // time is this crew on this crane, so there is nothing conservative to assume.
    expect(solveProjectFormwork(steelWallScene()).logistics).toBeUndefined()
    expect(
      solveProjectFormwork(withSettings(steelWallScene(), { rates: PRICED })).logistics,
    ).toBeUndefined()
  })

  test('counts the loads off the bill weight and the hook hours off the picks', () => {
    // The two sweeps, on one scene where both quantities are in frame: 4596 kg of bill on
    // a 3000 kg lorry is two loads out and two back, and the wall is one 2062 kg pick.
    const solution = solveProjectFormwork(
      withSettings(steelWallScene(), {
        logistics: { lorryPayloadKg: 3000, minutesPerPick: 30 },
        rates: PRICED,
      }),
    )

    expect(solution.logistics?.weighedKg).toBe(solution.totalWeightKg)
    expect(solution.logistics?.outboundLoads).toBe(2)
    expect(solution.logistics?.totalLoads).toBe(4)
    expect(solution.logistics?.transportCost).toBe(1600)
    // The picks straight off the lifting schedule rather than a second grouping of the
    // faces, so the hours and the schedule cannot disagree about how many lifts there are.
    expect(solution.logistics?.pickCount).toBe(solution.lifts?.pickCount)
    expect(solution.logistics?.craneHours).toBeCloseTo(0.5, 6)
    expect(solution.logistics?.craneCost).toBeCloseTo(60, 6)
    expect(solution.logistics?.totalCost).toBeCloseTo(1660, 6)
  })

  test('keeps the deliveries out of the cost total, like the labour', () => {
    const priced = solveProjectFormwork(
      withSettings(steelWallScene(), {
        logistics: { lorryPayloadKg: 3000, minutesPerPick: 30 },
        rates: PRICED,
      }),
    )
    const withoutLogistics = solveProjectFormwork(withSettings(steelWallScene(), { rates: PRICED }))

    expect(priced.logistics?.totalCost).toBeGreaterThan(0)
    expect(priced.cost?.totalCost).toBeCloseTo(withoutLogistics.cost?.totalCost ?? -1, 6)
  })

  test('a payload with nothing ganged still counts the lorries', () => {
    // The two halves are independent: a slab is decked rather than panelled, so it has no
    // pick to time, and that says nothing about how many lorries its bill fills.
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(makeSlab('slab_1'), makeAssembly('formwork-assembly_1', 'slab_1', 0, 0)),
        { logistics: { lorryPayloadKg: 3000, minutesPerPick: 30 }, rates: PRICED },
      ),
    )

    expect(solution.lifts).toBeUndefined()
    expect(solution.logistics?.outboundLoads).toBeGreaterThan(0)
    expect(solution.logistics?.craneHours).toBeUndefined()
    expect(solution.logistics?.gaps).toContain('nothing-ganged')
  })

  test('says the loads are the fewest trips, and that a tower crane is already paid for', () => {
    const caveats = projectFormworkCaveats(
      solveProjectFormwork(
        withSettings(steelWallScene(), {
          logistics: { lorryPayloadKg: 3000, minutesPerPick: 30 },
          rates: PRICED,
        }),
      ),
    )

    expect(caveats.some((c) => c.includes('the fewest trips'))).toBe(true)
    expect(caveats.some((c) => c.includes('charged by the week'))).toBe(true)
  })

  test('says a priced takeoff carries no transport where nobody stated a payload', () => {
    // The labour's rule: only where money exists, because a takeoff with no figures at all
    // already tells the reader that and two silences read as two problems.
    const priced = projectFormworkCaveats(
      solveProjectFormwork(withSettings(steelWallScene(), { rates: PRICED })),
    )
    expect(priced.some((c) => c.includes('no transport and no craneage'))).toBe(true)

    const unpriced = projectFormworkCaveats(solveProjectFormwork(steelWallScene()))
    expect(unpriced.some((c) => c.includes('no transport and no craneage'))).toBe(false)
  })
})

describe('the sheets the ply comes out of', () => {
  const SHEETS = {
    stockIds: ['ply-1220x2440x18-plain'],
    minKeepWidthMm: 150,
    minKeepLengthMm: 600,
  }

  /** A plywood deck, which is the element that actually bills cut ply by the hundred. */
  function plywoodSlabScene(): Record<string, AnyNode> {
    return sceneOf(makeSlab('slab_1'), makeAssembly('formwork-assembly_1', 'slab_1', 0, 0))
  }

  test('a project with no stated sheet gets no cut list', () => {
    // The rates' rule. Nesting against every sheet in the catalog would answer for a
    // merchant rather than for the job, and picking one would be a supply decision taken on
    // the project's behalf — 1220 × 2440 and 1250 × 2500 give the same deck different counts.
    expect(solveProjectFormwork(plywoodSlabScene()).cutList).toBeUndefined()
    expect(
      solveProjectFormwork(
        withSettings(plywoodSlabScene(), { parts: { sheathingId: 'film-faced-ply-18' } }),
      ).cutList,
    ).toBeUndefined()
  })

  test('nests the deck’s boards out of the stated sheet', () => {
    const solution = solveProjectFormwork(withSettings(plywoodSlabScene(), { sheets: SHEETS }))

    expect(solution.cutList?.stockIds).toEqual(['ply-1220x2440x18-plain'])
    expect(solution.cutList?.boardCount).toBeGreaterThan(0)
    expect(solution.cutList?.list.order[0]?.sheetId).toBe('ply-1220x2440x18-plain')
    expect(solution.cutList?.list.order[0]?.sheets).toBeGreaterThan(0)
  })

  test('takes the pieces off the parts, not the quantities off the bill', () => {
    // A deck of 140 identical sheets is one bill line with a quantity of 140. A nest over
    // the line would place one board, buy one sheet and be short by 139 — so the piece count
    // is checked against the bill's own quantities rather than against its line count.
    const solution = solveProjectFormwork(withSettings(plywoodSlabScene(), { sheets: SHEETS }))
    const billed = solution.bom
      .filter((line) => line.kind === 'ply-piece')
      .reduce((total, line) => total + line.quantity, 0)

    expect(solution.cutList?.boardCount).toBe(billed)
    expect(solution.bom.filter((line) => line.kind === 'ply-piece').length).toBeLessThan(billed)
  })

  test('a steel-panel job has no cut list because it has nothing to cut', () => {
    // Absent for a second, unrelated reason — which is why the caveats distinguish them.
    const solution = solveProjectFormwork(withSettings(steelWallScene(), { sheets: SHEETS }))

    expect(solution.bom.some((line) => line.kind === 'ply-piece')).toBe(false)
    expect(solution.cutList).toBeUndefined()
  })

  test('keeps the sheets out of the bill, the weight and the money', () => {
    // The one thing here that could produce a *wrong* total rather than a missing one. Every
    // board is already billed as cut ply, so a sheet count folded into the bill would count
    // the same material twice.
    const PRICED = { currency: 'GBP', byCatalogId: { [PANEL_ID]: { purchasePerUnit: 100 } } }
    const nested = solveProjectFormwork(
      withSettings(plywoodSlabScene(), { sheets: SHEETS, rates: PRICED }),
    )
    const plain = solveProjectFormwork(withSettings(plywoodSlabScene(), { rates: PRICED }))

    expect(nested.cutList?.list.order[0]?.sheets).toBeGreaterThan(0)
    expect(nested.bom).toEqual(plain.bom)
    expect(nested.totalWeightKg).toBe(plain.totalWeightKg)
    expect(nested.cost?.totalCost).toBe(plain.cost?.totalCost)
    // No bill line names a sheet product — only the sheathing grade, which has no size.
    expect(nested.bom.some((line) => line.catalogId === 'ply-1220x2440x18-plain')).toBe(false)
  })

  test('one nest across the scope rather than one per element', () => {
    // The whole reason this is a project answer: a board off one slab comes out of another
    // slab's offcut, so two scopes nested apart buy more sheets than one nested together.
    const two = sceneOf(
      makeSlab('slab_1'),
      makeAssembly('formwork-assembly_1', 'slab_1', 0, 0),
      makeSlab('slab_2', {
        polygon: [
          [0, 8],
          [8, 8],
          [8, 14],
          [0, 14],
        ],
      } as Partial<SlabNode>),
      makeAssembly('formwork-assembly_2', 'slab_2', 0, 0),
    )
    const together = solveProjectFormwork(withSettings(two, { sheets: SHEETS }))
    const first = solveProjectFormwork(withSettings(two, { sheets: SHEETS }), {
      hostIds: ['slab_1'],
    })
    const second = solveProjectFormwork(withSettings(two, { sheets: SHEETS }), {
      hostIds: ['slab_2'],
    })
    const apart =
      (first.cutList?.list.sheets.length ?? 0) + (second.cutList?.list.sheets.length ?? 0)

    expect(together.cutList?.list.sheets.length ?? 0).toBeLessThanOrEqual(apart)
    expect(together.cutList?.boardCount).toBe(
      (first.cutList?.boardCount ?? 0) + (second.cutList?.boardCount ?? 0),
    )
  })

  test('carries the handling allowance beside the nested count, never inside it', () => {
    const solution = solveProjectFormwork(
      withSettings(plywoodSlabScene(), { sheets: { ...SHEETS, handlingWasteFraction: 0.1 } }),
    )
    const nested = solution.cutList?.list.order[0]?.sheets ?? 0

    expect(solution.cutList?.list.orderWithAllowance?.[0]?.sheets).toBe(Math.ceil(nested * 1.1))
  })

  test('leads the caveats with the double-count, and says the sheets are not a bill line', () => {
    const caveats = projectFormworkCaveats(
      solveProjectFormwork(withSettings(plywoodSlabScene(), { sheets: SHEETS })),
    )

    expect(caveats.some((c) => c.includes('counts the same material twice'))).toBe(true)
    expect(caveats.some((c) => c.includes('behind a waler'))).toBe(true)
  })

  test('says a job with cut ply and no stated sheet has no cut list, and a steel one does not', () => {
    // The two silences told apart. A deck of 140 boards and no sheet stated is a state to
    // act on; a steel-panel wall has nothing to cut and is owed no sentence about sheets.
    const ply = projectFormworkCaveats(solveProjectFormwork(plywoodSlabScene()))
    expect(ply.some((c) => c.includes('no cut list in this takeoff'))).toBe(true)

    const steel = projectFormworkCaveats(solveProjectFormwork(steelWallScene()))
    expect(steel.some((c) => c.includes('no cut list in this takeoff'))).toBe(false)
  })

  test('names the boards no sheet holds rather than dividing them', () => {
    // A slab's edge form is emitted as one board the length of the rim — 8 m against a
    // 2.44 m sheet — so it is refused and named. A formlining board spliced mid-span is a
    // defect rather than a cut, and the refusal is the honest answer to a part stated that
    // long: what it is not is a sheet count that quietly leaves the rim out.
    const solution = solveProjectFormwork(withSettings(plywoodSlabScene(), { sheets: SHEETS }))

    expect(solution.cutList?.list.oversize.length).toBeGreaterThan(0)
    expect(solution.cutList?.complete).toBe(false)
    expect(
      projectFormworkCaveats(solution).some((c) => c.includes('larger than every stated sheet')),
    ).toBe(true)
  })

  test('records a sheathing grade stated as a sheet as an id that nests nothing', () => {
    // The write paths refuse it; a hand-edited or older scene can still hold it. A grade
    // carries permissible pressures and no width or length, so it can hold no board.
    const solution = solveProjectFormwork(
      withSettings(plywoodSlabScene(), { sheets: { stockIds: ['film-faced-ply-18'] } }),
    )

    expect(solution.cutList?.unknownStockIds).toEqual(['film-faced-ply-18'])
    expect(solution.cutList?.list.order).toEqual([])
    expect(
      projectFormworkCaveats(solution).some((c) => c.includes('names no sheet in the catalog')),
    ).toBe(true)
  })

  test('one repeated floor is nested once, and the purchase is the cycle count, not the board count', () => {
    // 6.4: two identical decks on two levels. The boards are the same rectangles twice,
    // so the nest covers one cycle and the counts are the purchase for the repeated
    // floor — never one set per level. The reuse is claimed out loud in the caveats,
    // because a purchasing figure a reader cannot argue with is a figure they accept
    // wrong. No stated life means every cycle buys its own set — the count the nest of
    // every level always produced, so nothing is lost by recognising the repeat.
    const two = sceneOf(
      makeSlab('slab_1'),
      makeAssembly('formwork-assembly_1', 'slab_1', 0, 0),
      makeSlab('slab_2', { parentId: 'level_2' } as Partial<SlabNode>),
      makeAssembly('formwork-assembly_2', 'slab_2', 0, 0),
    )
    const repeated = solveProjectFormwork(withSettings(two, { sheets: SHEETS }))
    const single = solveProjectFormwork(withSettings(plywoodSlabScene(), { sheets: SHEETS }))

    expect(repeated.cutList?.cycles).toBe(2)
    expect(repeated.cutList?.boardCount).toBe(single.cutList?.boardCount)
    expect(repeated.cutList?.list.order[0]?.sheets).toBe(
      (single.cutList?.list.order[0]?.sheets ?? 0) * 2,
    )
    expect(repeated.cutList?.reuseNote).toContain('identical across 2 levels')
    expect(
      projectFormworkCaveats(repeated).some((c) => c.includes('nested once and cut once')),
    ).toBe(true)
  })

  test('a stated sheet life buys the replacement sets the pours imply, not a set per pour', () => {
    // The life is the sheet's own rate: 2 pours per set means 2 identical levels buy
    // one set where no life buys two. The monotone property — stating a life can only
    // ever buy fewer sheets — is what makes it safe to assume in the solver rather
    // than to ask about.
    const RATED = {
      currency: 'GBP',
      byCatalogId: { 'ply-1220x2440x18-plain': { purchasePerUnit: 10, expectedUses: 2 } },
    }
    const two = sceneOf(
      makeSlab('slab_1'),
      makeAssembly('formwork-assembly_1', 'slab_1', 0, 0),
      makeSlab('slab_2', { parentId: 'level_2' } as Partial<SlabNode>),
      makeAssembly('formwork-assembly_2', 'slab_2', 0, 0),
    )
    const solution = solveProjectFormwork(withSettings(two, { sheets: SHEETS, rates: RATED }))
    const single = solveProjectFormwork(
      withSettings(plywoodSlabScene(), { sheets: SHEETS, rates: RATED }),
    )

    expect(solution.cutList?.cycles).toBe(2)
    expect(solution.cutList?.list.order[0]?.sheets).toBe(single.cutList?.list.order[0]?.sheets)
    expect(solution.cutList?.reuseNote).toContain('2 pours')
  })

  test('a one-off floor is not a repeated floor, and says so by saying nothing', () => {
    const solution = solveProjectFormwork(withSettings(plywoodSlabScene(), { sheets: SHEETS }))

    expect(solution.cutList?.cycles).toBe(1)
    expect(solution.cutList?.reuseNote).toBeUndefined()
  })
})

describe('projectFormworkCaveats', () => {
  test('says nothing about a complete takeoff', () => {
    const wall = makeWall('wall_1')
    const solution = solveProjectFormwork(
      sceneOf(wall, makeAssembly('formwork-assembly_1', 'wall_1', 0, 0)),
    )

    expect(projectFormworkCaveats(solution).filter((c) => c.includes('short'))).toEqual([])
  })

  test('names the element and both counts when a bill is short', () => {
    const wall = makeWall('wall_1', { height: 9, maxLiftHeight: 3 })
    const solution = solveProjectFormwork(
      sceneOf(wall, makeAssembly('formwork-assembly_1', 'wall_1', 0, 0)),
    )

    const caveats = projectFormworkCaveats(solution)
    // Actionable means naming where. "The takeoff is short" on its own is not.
    expect(caveats[0]).toContain('wall_1')
    expect(caveats[0]).toContain('cast in 3 pours and formed for 1')
  })

  test('names an over-shuttered element in the other direction', () => {
    const wall = makeWall('wall_1')

    const solution = solveProjectFormwork(
      sceneOf(
        wall,
        makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
        makeAssembly('formwork-assembly_2', 'wall_1', 0, 1),
      ),
    )

    expect(projectFormworkCaveats(solution)[0]).toContain('2 shutters for 1 pour')
  })

  test('warns when the weight total is incomplete rather than letting it read as final', () => {
    const wall = makeWall('wall_1')
    const solution = solveProjectFormwork(
      sceneOf(wall, makeAssembly('formwork-assembly_1', 'wall_1', 0, 0)),
    )

    const caveats = projectFormworkCaveats(solution)
    // Whichever way this scene falls, the two have to agree — a complete flag with a
    // weight warning beside it is worse than either alone.
    expect(caveats.some((c) => c.includes('no published weight'))).toBe(
      !solution.totalWeightComplete,
    )
  })

  test('warns that two scopes’ owned figures are not a total', () => {
    // The one way this split is read wrongly: it is right per level and adding two
    // levels double-counts a rack that serves both in sequence.
    const solution = solveProjectFormwork(withStock(steelWallScene(), { owned: { [PANEL_ID]: 4 } }))

    expect(projectFormworkCaveats(solution).some((c) => c.includes('not a total'))).toBe(true)
  })

  test('says nothing about scopes where the rack covered none of the bill', () => {
    const solution = solveProjectFormwork(withStock(steelWallScene(), { owned: {} }))

    expect(projectFormworkCaveats(solution).some((c) => c.includes('not a total'))).toBe(false)
  })

  test('calls out hired stock this pour alters as a recharge, not a hire charge', () => {
    // A substituted panel is `modified`, and a hire company's panel returned altered
    // is billed at list — a purchase nobody decided to make.
    const plain = solveProjectFormwork(steelWallScene())
    const mark = plain.elements[0]?.shutters[0]?.parts.find((part) => part.kind === 'panel')
      ?.mark as string
    const edited = sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, {
        partOverrides: { [mark]: { catalogId: 'peri-trio-panel-tr-240' } },
      } as Partial<FormworkAssemblyNode>),
    )

    const solution = solveProjectFormwork(withStock(edited, { owned: {} }))

    expect(solution.supply?.hiredModifiedQuantity).toBe(1)
    expect(projectFormworkCaveats(solution).some((c) => c.includes('recharge at list'))).toBe(true)
  })

  test('leads a priced takeoff with what the price is not', () => {
    // The one figure a reader quotes without reading anything beside it, so what it
    // excludes has to travel with it rather than sit in a tooltip.
    const solution = solveProjectFormwork(
      withSettings(steelWallScene(), {
        stock: { owned: {} },
        rates: { currency: 'GBP', byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } } },
      }),
    )

    const caveats = projectFormworkCaveats(solution)
    expect(caveats.some((c) => c.includes('no labour'))).toBe(true)
    // A floor, because a bill with a rate for one panel type prices nothing else.
    expect(caveats.some((c) => c.includes('a floor rather than a price'))).toBe(true)
  })

  test('says nothing about money where the project recorded no rate', () => {
    const caveats = projectFormworkCaveats(solveProjectFormwork(steelWallScene()))

    expect(caveats.some((c) => c.includes('no labour'))).toBe(false)
  })

  test('puts the lifting caveats straight after the one about the weight total', () => {
    // The order is the point: a reader who has just been told the bill's tonnage is
    // incomplete is the reader about to size a crane off it, and the next sentence has to
    // be that a pick is one hook load rather than a total.
    const caveats = projectFormworkCaveats(solveProjectFormwork(steelWallScene()))
    const weight = caveats.findIndex((c) => c.includes('no published weight'))
    const lifting = caveats.findIndex((c) => c.includes('Walers, ties'))

    expect(weight).toBeGreaterThanOrEqual(0)
    expect(lifting).toBe(weight + 1)
    expect(caveats.some((c) => c.includes('a load nothing ever lifts'))).toBe(true)
  })

  test('says nothing about lifting where nothing in scope is ganged', () => {
    const solution = solveProjectFormwork(
      sceneOf(makeSlab('slab_1'), makeAssembly('formwork-assembly_1', 'slab_1', 0, 0)),
    )

    expect(projectFormworkCaveats(solution).some((c) => c.includes('Walers, ties'))).toBe(false)
  })

  test('a bill on a secondary system carries its weakest level, naming the lines (8.3)', () => {
    // TRIO's panels were read off dealer listings, so a takeoff built from them is
    // secondary — the fold's point: the level travels from the catalog value to the
    // line to the takeoff, and the sentence names the lines at that level.
    const solution = solveProjectFormwork(
      withSettings(
        sceneOf(
          makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
          makeAssembly('formwork-assembly_1', 'wall_1', 0, 0, { systemId: 'peri-trio' }),
        ),
        { parts: { systemId: 'peri-trio' } },
      ),
    )

    expect(solution.bom.some((line) => line.verification === 'secondary')).toBe(true)
    expect(
      projectFormworkCaveats(solution).some(
        (c) => c.includes('secondary') && c.includes('dealer or secondary listing'),
      ),
    ).toBe(true)
  })

  test("the fold takes the weakest line, not the system's headline (8.3)", () => {
    // Framax's panels came off Doka's own item list, so they are certified — but the
    // waler values were read off a dealer listing, so the takeoff is secondary even
    // though the system's headline is certified. The fold's point: one weak line makes
    // the total weak, and the caveat names the lines at that level.
    const solution = solveProjectFormwork(steelWallScene())
    const caveats = projectFormworkCaveats(solution)

    const panelLines = solution.bom.filter((line) =>
      line.catalogId?.startsWith('doka-framax-panel'),
    )
    expect(panelLines.length).toBeGreaterThan(0)
    expect(panelLines.every((line) => line.verification === 'certified')).toBe(true)
    expect(solution.bom.some((line) => line.verification === 'secondary')).toBe(true)
    expect(caveats.some((c) => c.includes('dealer or secondary listing'))).toBe(true)
    expect(caveats.some((c) => c.includes('h20-doka-permissible'))).toBe(true)
  })

  test('a slab on the default film-faced ply is unverified, and named (8.3)', () => {
    // The default sheathing is the unverified typical band, so every ordinary deck
    // depends on it — which is exactly the constant the fold has to name.
    const solution = solveProjectFormwork(
      sceneOf(makeSlab('slab_1'), makeAssembly('formwork-assembly_1', 'slab_1', 0, 0)),
    )

    expect(solution.bom.some((line) => line.verification === 'unverified')).toBe(true)
    expect(
      projectFormworkCaveats(solution).some(
        (c) => c.includes('unverified') && c.includes('film-faced-ply-18'),
      ),
    ).toBe(true)
  })

  test('takeoffVerificationNote is the caveat one wording, and the drawings print it (8.5)', () => {
    // The note is what the drawings and the CSV print on their face; it has to be the
    // same sentence the caveats list carries, or a document and the panel disagree about
    // the level of the same figures. The absent-when-certified branch is the core fold's
    // own rule (`weakestVerification` in catalog.test.ts), which every consumer shares.
    const solution = solveProjectFormwork(
      sceneOf(makeSlab('slab_1'), makeAssembly('formwork-assembly_1', 'slab_1', 0, 0)),
    )
    const caveat = projectFormworkCaveats(solution).find((c) => c.includes('unverified'))
    expect(takeoffVerificationNote(solution)).toBe(caveat)
    expect(takeoffVerificationNote(solution)).toContain('film-faced-ply-18')
  })

  test('certifying a constant changes the level with the number, each named (8.8)', () => {
    // The attribution claim: the only input that changed between the two solves is the
    // sheathing constant, so the movement in the takeoff's level is attributable to the
    // certification rather than an unexplained shift — the constant is named in the before
    // state (the unverified note) and named out of the after state, with the level that
    // replaced it belonging to a different, named constant. The settings node sits on the
    // level so both readers find it: the geometry climbs the host's ancestors and the
    // takeoff scans the scene, and a constant only one of them can see would move the
    // parts and not the bill or the reverse.
    const slab = (sheathingId: string) => {
      const nodes = sceneOf(makeSlab('slab_1'), makeAssembly('formwork-assembly_1', 'slab_1', 0, 0))
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
        parts: { sheathingId },
      } as unknown as AnyNode
      return solveProjectFormwork(nodes)
    }
    const provisional = slab('film-faced-ply-18')
    const certified = slab('plyform-class-i-3-4')

    const provisionalNote = takeoffVerificationNote(provisional)
    const certifiedNote = takeoffVerificationNote(certified)
    expect(provisionalNote).toContain('film-faced-ply-18')
    expect(provisionalNote).toContain('unverified')
    // The certified grade carries derived values, so the deck no longer drags the takeoff
    // down to unverified — what is left is the H20 beam's secondary, a different constant,
    // and the fold says so rather than silently improving the takeoff's level.
    expect(certifiedNote).not.toContain('unverified')
    expect(certifiedNote).not.toContain('film-faced-ply-18')
    expect(certifiedNote).toContain('secondary')
    // The level follows the constant down to the parts: provisional sheathing parts are
    // unverified, the same scene on the certified grade has none.
    const provisionalParts = provisional.elements[0]?.shutters[0]?.parts ?? []
    const certifiedParts = certified.elements[0]?.shutters[0]?.parts ?? []
    expect(provisionalParts.some((part) => part.verification === 'unverified')).toBe(true)
    expect(certifiedParts.some((part) => part.verification === 'unverified')).toBe(false)
  })
})

describe('the pour plan — permitted joint elevations', () => {
  const tallWall = () => makeWall('wall_1', { height: 9, maxLiftHeight: 5 } as Partial<WallNode>)

  function solve(pours: Record<string, unknown> | undefined) {
    const scene = sceneOf(
      tallWall(),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
      makeAssembly('formwork-assembly_2', 'wall_1', 0, 1),
      makeAssembly('formwork-assembly_3', 'wall_1', 0, 2),
    )
    return solveProjectFormwork(pours ? withSettings(scene, { pours }) : scene)
  }

  test('scenario 1 — every boundary lands on a permitted elevation when one is in reach', () => {
    const solution = solve({ permittedJointElevations: [4.6], jointSnapTolerance: 0.3 })

    expect(solution.pours).toBeDefined()
    expect(solution.pours?.permittedJointElevations).toEqual([4.6])
    expect(solution.pours?.conflicts).toEqual([])
    // Uniform would put the joint at 4.5; the permitted set pulls it to 4.6.
    expect(solution.pours?.elements[0]?.lifts.map((lift) => lift.baseElevation)).toEqual([0, 4.6])
    expect(solution.pours?.elements[0]?.lifts[1]).toMatchObject({
      snappedTo: 4.6,
      jointSource: 'permitted',
    })
  })

  test('scenario 2 — no permitted joint in reach is a conflict naming the limit and the set', () => {
    const solution = solve({ permittedJointElevations: [7], jointSnapTolerance: 0.3 })

    expect(solution.pours?.conflicts).toHaveLength(1)
    const conflict = solution.pours?.conflicts[0]
    expect(conflict?.elementId).toBe('wall_1')
    // The split still places the boundary; it reports rather than silently forcing one.
    expect(conflict?.boundaryElevation).toBe(4.5)
    expect(conflict?.maxLiftHeight).toBe(5)
    expect(conflict?.permittedJointElevations).toEqual([7])
    // And the caveat reads as the two-part remedy: more joints, or a wider tolerance.
    const caveats = projectFormworkCaveats(solution)
    expect(caveats.some((c) => c.includes('none of the permitted'))).toBe(true)
  })

  test('scenario 3 — no stated joints splits from the limits and labels the boundaries solver-chosen', () => {
    const solution = solve(undefined)

    expect(solution.pours).toBeDefined()
    expect(solution.pours?.permittedJointElevations).toBeNull()
    expect(solution.pours?.conflicts).toEqual([])
    expect(solution.pours?.elements[0]?.lifts.map((lift) => lift.baseElevation)).toEqual([0, 4.5])
    expect(solution.pours?.elements[0]?.lifts[1]?.jointSource).toBe('solver')
  })

  test('an element cast in one lift is not in the report at all', () => {
    const wall = makeWall('wall_1', { height: 3 })
    const solution = solveProjectFormwork(
      sceneOf(wall, makeAssembly('formwork-assembly_1', 'wall_1', 0, 0)),
    )

    expect(solution.pours).toBeUndefined()
  })
})

describe('the deferred-clash inputs (group 9)', () => {
  test('stating reinforcement, slab capacity or a setback changes no quantity, cost, date or finding', () => {
    // The whole contract of these inputs, and why they are optional fields on existing nodes
    // rather than a new kind: they exist so a project *can* state the data the clash checks
    // need, and the checks are a later group — so today they are read by nothing, and a
    // project that states all of them must solve exactly like the pre-change fixture that
    // states none. This is the regression the scenario promises: the same bill, the same
    // money, the same dates, the same findings.
    const plain = sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeSlab('slab_1'),
      makeAssembly('formwork-assembly_1', 'wall_1', 0, 0),
      makeAssembly('formwork-assembly_2', 'slab_1', 0, 0),
    )
    const stated: Record<string, AnyNode> = {
      ...plain,
      // The site the settings node is parented to, now carrying a stated boundary setback.
      site_1: {
        object: 'node',
        id: 'site_1',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
        children: [],
        polygon: {
          type: 'polygon',
          points: [
            [-20, -20],
            [20, -20],
            [20, 20],
            [-20, 20],
          ],
        },
        setback: 2,
      } as unknown as AnyNode,
    }
    ;(stated.wall_1 as WallNode).reinforcement = {
      arrangement: { diameter: 0.016, spacing: 0.2, cover: 0.04 },
    }
    ;(stated.slab_1 as SlabNode).loadCapacityKnM2 = 7.5

    const settings = {
      stock: { owned: {} },
      pressureStandard: 'BS_8110',
      schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
      rates: { byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } } },
    }
    const without = solveProjectFormwork(withSettings(plain, settings))
    const withInputs = solveProjectFormwork(withSettings(stated, settings))

    // The derived surfaces — not `elements[].host`, which embeds the raw node and would
    // rightly show the stated field.
    expect(withInputs.bom).toEqual(without.bom)
    expect(withInputs.totalWeightKg).toBe(without.totalWeightKg)
    expect(withInputs.shutterCount).toBe(without.shutterCount)
    expect(withInputs.cost).toEqual(without.cost)
    expect(withInputs.hire).toEqual(without.hire)
    expect(withInputs.schedule).toEqual(without.schedule)
    expect(withInputs.incomplete).toEqual(without.incomplete)
    expect(withInputs.rejected).toEqual(without.rejected)
    expect(projectFormworkCaveats(withInputs)).toEqual(projectFormworkCaveats(without))
  })
})
