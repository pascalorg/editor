import { describe, expect, test } from 'bun:test'
import type { AnyNode, FormworkAssemblyNode, WallNode } from '@pascal-app/core'
import { buildFormworkNodes } from './attach'
import { formworkCoverageCaveat, formworkPartsReport } from './parts-report'

/**
 * The shape every AI surface reads one element's shutter in.
 *
 * The numbers belong to `solve.test.ts` and `parts.test.ts`; both surfaces call the same
 * solver, so no figure can diverge. The *shape* can, and does so silently — which is
 * what is asserted here. A `partCount` that followed the `kind` filter is not a wrong
 * number, it is a right number to a different question, and the model quotes it as the
 * shutter's. `duplicateMarks` flattened across lifts is a clash list that is always full
 * on a correctly built wall, so nobody reads it. And an element nobody has formed has to
 * come back as nothing rather than as an empty bill, because a bill of nothing reads as
 * an element that needs nothing.
 */

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id: 'wall_1',
    type: 'wall',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [6, 0],
    thickness: 0.25,
    height: 3,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'steel-panel',
    ...overrides,
  } as WallNode
}

/** The wall plus the shutters `attach_formwork` would build for it, as a graph. */
function shuttered(
  wall: WallNode,
  edit?: (assembly: FormworkAssemblyNode) => void,
): Record<string, AnyNode> {
  const assemblies = buildFormworkNodes(wall, [])
  for (const assembly of assemblies) edit?.(assembly)
  const nodes: Record<string, AnyNode> = {
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['wall_1'],
      elevation: 0,
      height: 6,
      level: 0,
    } as unknown as AnyNode,
    wall_1: { ...wall, children: assemblies.map((assembly) => assembly.id) } as AnyNode,
  }
  for (const assembly of assemblies) nodes[assembly.id] = assembly as unknown as AnyNode
  return nodes
}

describe('formworkPartsReport', () => {
  test('reports the parts of a shuttered wall, with a mark on every one', () => {
    const wall = makeWall()
    const nodes = shuttered(wall)

    const report = formworkPartsReport(nodes.wall_1 as never, nodes)

    expect(report?.kind).toBe('wall')
    expect(report?.shutters).toHaveLength(1)
    expect(report?.shutters[0]?.partCount).toBeGreaterThan(0)
    expect(report?.shutters[0]?.parts.every((part) => part.mark.length > 0)).toBe(true)
    expect(report?.bom.length).toBeGreaterThan(0)
    expect(report?.totalWeightKg).toBeGreaterThan(0)
    expect(report?.coversWholeElement).toBe(true)
    expect(report?.duplicateMarks).toEqual([])
    expect(report?.staleEdits).toEqual([])
  })

  test('an unformed element is nothing, not an empty bill', () => {
    const wall = makeWall()

    const report = formworkPartsReport(wall as never, {
      wall_1: wall as AnyNode,
    })

    expect(report).toBeUndefined()
  })

  test('the kind filter trims the itemised list and nothing else', () => {
    const wall = makeWall()
    const nodes = shuttered(wall)

    const all = formworkPartsReport(nodes.wall_1 as never, nodes)
    const panels = formworkPartsReport(nodes.wall_1 as never, nodes, { kind: 'panel' })

    expect(panels?.shutters[0]?.parts.length).toBeGreaterThan(0)
    expect(panels?.shutters[0]?.parts.every((part) => part.kind === 'panel')).toBe(true)
    expect(panels?.shutters[0]?.parts.length).toBeLessThan(all?.shutters[0]?.parts.length ?? 0)
    // The count and the bill are the shutter's, so they do not follow the filter.
    expect(panels?.shutters[0]?.partCount).toBe(all?.shutters[0]?.partCount)
    expect(panels?.bom).toEqual(all?.bom)
    expect(panels?.totalWeightKg).toBe(all?.totalWeightKg)
  })

  test('a kind nothing matches leaves the bill intact rather than reading as an empty shutter', () => {
    const wall = makeWall()
    const nodes = shuttered(wall)

    const report = formworkPartsReport(nodes.wall_1 as never, nodes, { kind: 'not-a-kind' })

    expect(report?.shutters[0]?.parts).toEqual([])
    expect(report?.shutters[0]?.partCount).toBeGreaterThan(0)
    expect(report?.bom.length).toBeGreaterThan(0)
  })

  test('lifts of one wall share marks without any of them reading as a clash', () => {
    // A mark's station and elevation are measured within its own pour unit, so lift 0 and
    // lift 1 legitimately carry the same marks. Flattened, every part of a correct wall
    // is reported as a duplicate.
    const wall = makeWall({ height: 6, maxLiftHeight: 2 } as Partial<WallNode>)
    const nodes = shuttered(wall)

    const report = formworkPartsReport(nodes.wall_1 as never, nodes)

    expect(report?.shutters.length).toBeGreaterThan(1)
    const marks = report?.shutters.flatMap((shutter) =>
      shutter.parts.map((part) => part.mark),
    ) as string[]
    expect(new Set(marks).size).toBeLessThan(marks.length)
    expect(report?.duplicateMarks).toEqual([])
  })

  test('an override against a mark the solve does not produce is reported as a stale edit', () => {
    // Not cleared automatically: a wall shortened below a panel and lengthened again
    // should get its decisions back. So the orphan is surfaced instead of silently kept.
    const wall = makeWall()
    const nodes = shuttered(wall, (assembly) => {
      assembly.partOverrides = { 'P-Z-9-99999': { omitted: true } }
    })

    const report = formworkPartsReport(nodes.wall_1 as never, nodes)

    expect(report?.staleEdits.map((edit) => edit.mark)).toEqual(['P-Z-9-99999'])
    expect(report?.staleEdits[0]?.assemblyId).toBe(report?.shutters[0]?.assemblyId)
  })

  test('an omitted part leaves the bill and the weight but stays in the shutter', () => {
    const wall = makeWall()
    const before = shuttered(wall)
    const mark = formworkPartsReport(before.wall_1 as never, before)?.shutters[0]?.parts.find(
      (part) => part.kind === 'panel',
    )?.mark as string
    const after = shuttered(wall, (assembly) => {
      assembly.partOverrides = { [mark]: { omitted: true } }
    })

    const plain = formworkPartsReport(before.wall_1 as never, before)
    const omitted = formworkPartsReport(after.wall_1 as never, after)

    expect(omitted?.bom.flatMap((line) => line.marks)).not.toContain(mark)
    expect(omitted?.totalWeightKg).toBeLessThan(plain?.totalWeightKg ?? 0)
    // Still erected and still drawn — somebody else supplied it.
    expect(omitted?.shutters[0]?.partCount).toBe(plain?.shutters[0]?.partCount)
    expect(omitted?.shutters[0]?.parts.find((part) => part.mark === mark)?.omittedFromOrder).toBe(
      true,
    )
  })
})

describe('formworkCoverageCaveat', () => {
  test('says nothing when the shutters match the pours', () => {
    expect(formworkCoverageCaveat('wall_1', 3, 3)).toBeUndefined()
  })

  test('says nothing about an element nobody has formed', () => {
    // That is `noFormworkAssembly`'s sentence, and two remedies in one reply is one too
    // many for the agent to pick between.
    expect(formworkCoverageCaveat('wall_1', 0, 3)).toBeUndefined()
  })

  test('names the remedy when the takeoff is short of the pours', () => {
    const caveat = formworkCoverageCaveat('wall_1', 1, 3) as string

    expect(caveat).toContain('1 of the 3 pours are shuttered')
    expect(caveat).toContain('attach_formwork on wall_1')
    expect(caveat).toContain('the other 2')
  })

  test('names the remedy when a pour limit loosened and left shutters behind', () => {
    const caveat = formworkCoverageCaveat('wall_1', 3, 1) as string

    expect(caveat).toContain('3 shutters for 1 pour')
    expect(caveat).toContain('remove the 2')
  })

  test('reads as one where only one shutter is missing or spare', () => {
    expect(formworkCoverageCaveat('wall_1', 1, 2)).toContain('the other one')
    expect(formworkCoverageCaveat('wall_1', 2, 1)).toContain('forms a pour unit')
  })
})
