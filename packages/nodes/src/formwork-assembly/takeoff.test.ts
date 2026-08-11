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

/** The same node, carrying any settings group verbatim — the rates, the norms. */
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
    expect(text).toContain(`,${line?.quantity},`)
    expect(text).toContain(`,${line?.unit},`)
  })

  test('every line says how long it is held, and a tie says it is not struck at all', () => {
    // The second factor a hire charge needs, and the one that is only reachable here:
    // the period is per thing-struck and a bill line is per catalog id, so nothing in
    // the serialiser or the solver alone can produce this column.
    const solution = solveProjectFormwork(
      sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')),
    )

    const { text } = takeoffCsv(solution, 'Project')

    const header = text.split('\n').find((row) => row.startsWith('Mark count,')) as string
    expect(header).toContain('Days held,Struck as')
    expect(text).toContain('Vertical form to a wall, column or beam side')
    // A tie is cut off inside the wall. A 0 would price it as plant returned same-day.
    expect(text.split('\n').find((row) => row.startsWith('40,tie'))).toContain(',not struck,')
  })

  test('a DIN project says its periods came from another code family', () => {
    // The shipped default is DIN, which publishes no striking table at all — its family
    // answers removal in EN 13670. Every figure in the column is BS 8110's, and only
    // this row says so.
    const solution = solveProjectFormwork(
      sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')),
    )

    const { text } = takeoffCsv(solution, 'Project')

    expect(text).toContain('DIN 18218 publishes no striking periods')
    expect(text).toContain('Striking standard,BS 8110')
  })

  test('the curing temperature the project stated lengthens the period in the file', () => {
    // The end of the chain the `curing` group exists for: a January cure is a longer
    // hire, and the file is where somebody acts on it.
    const scene = sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1'))
    const warm = solveProjectFormwork(scene)
    const cold = solveProjectFormwork({
      ...scene,
      'formwork-settings_1': {
        object: 'node',
        id: 'formwork-settings_1',
        type: 'formwork-settings',
        parentId: 'site_1',
        visible: true,
        metadata: {},
        children: [],
        curing: { surfaceTemperatureC: 5 },
      } as unknown as AnyNode,
    })

    expect(cold.hire.longestHours).toBeGreaterThan(warm.hire.longestHours)
    // And the assumption is gone, because the job answered the question.
    expect(takeoffCsv(cold, 'Project').text).not.toContain('No curing surface temperature')
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

  test('the acquisition list reaches the file, and is smaller than the hired quantity', () => {
    // The one join in this file where two figures the reader can see disagree by design:
    // the split spends the rack line by line and the shortfall compares it against the peak
    // day, so a sequential programme hires more than it acquires.
    const scene = {
      ...sceneOf(
        makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
        makeAssembly('formwork-assembly_1', 'wall_1', 0),
        makeAssembly('formwork-assembly_2', 'wall_1', 1),
      ),
    }
    const dated = Object.fromEntries(
      Object.entries(scene).map(([id, node]) => [
        id,
        node.type === 'formwork-assembly'
          ? ({
              ...node,
              pourAt: id.endsWith('_1') ? '2026-03-02' : '2026-04-13',
            } as unknown as AnyNode)
          : node,
      ]),
    )
    const plain = solveProjectFormwork(dated)
    const panel = plain.bom.find((row) => row.kind === 'panel')
    const solution = solveProjectFormwork(withStock(dated, { [panel?.catalogId as string]: 2 }))

    const { text } = takeoffCsv(solution, 'Project')
    const line = solution.acquisition?.lines.find((entry) => entry.catalogId === panel?.catalogId)
    const hired = solution.supply?.lines.find((entry) => entry.line.catalogId === panel?.catalogId)

    expect(text).toContain('TO ACQUIRE')
    expect(text).toContain(`Short in total,,,,${solution.acquisition?.shortfallQuantity}`)
    expect(line?.shortfall).toBeLessThan(hired?.hiredQuantity as number)
  })

  test('the gang’s hours reach the file, and the money block points at them', () => {
    // The join the panel cannot cover: a takeoff emailed to a hire desk with the hours
    // left behind is the same file that says labour is the largest thing it excludes.
    const scene = sceneOf(
      makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1'),
    )
    const plain = solveProjectFormwork(scene)
    const panel = plain.bom.find((row) => row.kind === 'panel')
    const solution = solveProjectFormwork(
      withSettings(scene, {
        labour: { byPartKind: { panel: { erectHours: 0.5, strikeHours: 0.25 } } },
        rates: {
          currency: 'GBP',
          gangRatePerHour: 32,
          byCatalogId: { [panel?.catalogId as string]: { rentalPerUnitPerMonth: 30 } },
        },
      }),
    )

    const rows = takeoffCsv(solution, 'Project').text.split('\n')

    expect(rows.some((row) => row.startsWith('LABOUR,'))).toBe(true)
    expect(rows).toContain('Operation,Fittings,Erect h,Strike h,Total h,Cost')
    expect(rows.some((row) => row.startsWith('TOTAL MAN-HOURS'))).toBe(true)
    const basis = rows.find((row) => row.startsWith('Cost basis,')) as string
    expect(basis).toContain('LABOUR block below')
  })

  test('a file taken with no norms recorded has no hours block to misread', () => {
    const solution = solveProjectFormwork(
      sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')),
    )

    expect(takeoffCsv(solution, 'Project').text).not.toContain('MAN-HOURS')
  })

  test('a programme with no rack carries no acquisition block', () => {
    const solution = solveProjectFormwork(
      sceneOf(
        makeWall('wall_1', { formworkType: 'steel-panel' } as Partial<WallNode>),
        makeAssembly('formwork-assembly_1', 'wall_1'),
      ),
    )

    expect(takeoffCsv(solution, 'Project').text).not.toContain('TO ACQUIRE')
  })
})
