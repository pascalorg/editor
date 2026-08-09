import { describe, expect, test } from 'bun:test'
import type { AnyNode, ColumnNode, WallNode } from '@pascal-app/core'
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
  ...members: Array<WallNode | ColumnNode | FormworkAssemblyNode>
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
})
