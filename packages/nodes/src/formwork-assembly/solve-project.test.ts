import { describe, expect, test } from 'bun:test'
import type { AnyNode, ColumnNode, SlabNode, WallNode } from '@pascal-app/core'
import type { FormworkAssemblyNode } from './schema'
import { projectFormworkCaveats, solveProjectFormwork } from './solve-project'

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

  test('the yard’s own panels are excluded from the total, not priced at zero', () => {
    // A sunk asset amortising over a reuse count nothing in the model carries. Priced at
    // zero it would make owning formwork free, which is the conclusion a reader draws
    // from a total that quietly includes it.
    const solution = solveProjectFormwork(
      withSettings(steelWallScene(), {
        stock: { owned: { [PANEL_ID]: 4 } },
        rates: { byCatalogId: { [PANEL_ID]: { rentalPerUnitPerMonth: 10 } } },
      }),
    )

    expect(solution.cost?.ownedQuantityExcluded).toBe(4)
    const panel = solution.cost?.lines.find((entry) => entry.line.catalogId === PANEL_ID)
    const billed = solution.bom.find((line) => line.catalogId === PANEL_ID)?.quantity as number
    // Charged on the hired remainder only, so the figure moves with the rack.
    expect(panel?.hireCost).toBeLessThan((billed * 10 * (panel?.chargedDays ?? 0)) / 30)
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
})
