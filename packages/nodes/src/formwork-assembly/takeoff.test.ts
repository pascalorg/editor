import { describe, expect, test } from 'bun:test'
import type { AnyNode, WallNode } from '@pascal-app/core'
import type { FormworkAssemblyNode } from './schema'
import { solveProjectFormwork } from './solve-project'
import { takeoffCsv } from './takeoff'

/**
 * The file the takeoff panel hands over.
 *
 * `bom-csv.test.ts` covers the serialiser and `solve-project.test.ts` the
 * aggregation; the only thing left to get wrong is the join between them — a scope
 * count the file contradicts, or a caveat that stays in the panel and does not
 * travel. The second is the one that matters: a short bill's rows are each correct,
 * so the emailed file carries no sign of it unless this puts one there.
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

function makeAssembly(id: string, hostId: string, liftIndex = 0): FormworkAssemblyNode {
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
  } as unknown as FormworkAssemblyNode
}

function sceneOf(...members: Array<WallNode | FormworkAssemblyNode>): Record<string, AnyNode> {
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
      level: 0,
    } as unknown as AnyNode,
  }
  for (const member of members) nodes[member.id as string] = member as unknown as AnyNode
  return nodes
}

/** The project settings node, which is where the yard's own rack is recorded. */
function withStock(
  nodes: Record<string, AnyNode>,
  owned: Record<string, number>,
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
      stock: { owned },
    } as unknown as AnyNode,
  }
}

describe('takeoffCsv', () => {
  test('names the scope it was taken at, in the file and in the filename', () => {
    const solution = solveProjectFormwork(
      sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')),
    )

    const { filename, text } = takeoffCsv(solution, 'Ground Floor')

    expect(text.split('\n')[0]).toBe('Formwork bill of materials,Ground Floor')
    expect(filename).toStartWith('formwork-bom-ground-floor-')
    expect(filename).toEndWith('.csv')
  })

  test('states the elements and pours the bill covers', () => {
    const solution = solveProjectFormwork(
      sceneOf(
        makeWall('wall_1'),
        makeWall('wall_2', { start: [0, 4], end: [6, 4] }),
        makeAssembly('formwork-assembly_1', 'wall_1'),
        makeAssembly('formwork-assembly_2', 'wall_2'),
      ),
    )

    const rows = takeoffCsv(solution, 'Project').text.split('\n')

    expect(rows).toContain('Elements,2')
    expect(rows).toContain('Pours,2')
  })

  test('a short bill carries its own warning into the file', () => {
    // The one thing the export cannot afford to leave in the UI. Every row of a
    // one-third bill is individually right, so the file itself has to say so.
    const solution = solveProjectFormwork(
      sceneOf(
        makeWall('wall_1', { height: 9, maxLiftHeight: 3 }),
        makeAssembly('formwork-assembly_1', 'wall_1'),
      ),
    )

    const { text } = takeoffCsv(solution, 'Project')

    expect(text).toContain('INCOMPLETE,')
    expect(text).toContain('wall_1 is cast in 3 pours and formed for 1')
  })

  test('a complete bill carries no INCOMPLETE row about coverage', () => {
    const solution = solveProjectFormwork(
      sceneOf(
        makeWall('wall_1', { height: 9, maxLiftHeight: 3 }),
        makeAssembly('formwork-assembly_1', 'wall_1', 0),
        makeAssembly('formwork-assembly_2', 'wall_1', 1),
        makeAssembly('formwork-assembly_3', 'wall_1', 2),
      ),
    )

    const { text } = takeoffCsv(solution, 'Project')

    expect(text).not.toContain('formed for')
  })

  test('the quantities in the file are the solved lines, not a re-derivation', () => {
    const solution = solveProjectFormwork(
      sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')),
    )

    const { text } = takeoffCsv(solution, 'Project')

    const line = solution.bom[0]
    expect(line).toBeDefined()
    expect(text).toContain(`,${line?.quantity},${line?.unit},`)
  })

  test('the owned/hired split reaches the file, columns and all', () => {
    const scene = sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1'),
    )
    const plain = solveProjectFormwork(scene)
    const panel = plain.bom.find((row) => row.catalogId !== undefined)
    const solution = solveProjectFormwork(withStock(scene, { [panel?.catalogId as string]: 4 }))

    const { text } = takeoffCsv(solution, 'Project')

    const header = text.split('\n').find((row) => row.startsWith('Mark count,')) as string
    expect(header).toContain('From own stock,To hire,Consumed')
    expect(text).toContain(`,${panel?.quantity},4,${(panel?.quantity ?? 0) - 4},0,`)
  })

  test('a file taken with no rack recorded has no hire columns to misread', () => {
    // A column of blanks under "Hire" is the most confident wrong answer this file
    // could give, so the columns are absent rather than empty.
    const solution = solveProjectFormwork(
      sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')),
    )

    const { text } = takeoffCsv(solution, 'Project')

    expect(text).not.toContain('To hire')
  })
})
