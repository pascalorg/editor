import { describe, expect, test } from 'bun:test'
import type { AnyNode, WallNode } from '@pascal-app/core'
import { bomLines, bomWeightKg, duplicateMarks } from '@pascal-app/core/formwork'
import type { FormworkAssemblyNode } from './schema'
import { solveShuttersForHost } from './solve'

/**
 * The solve the panel and the chat tool share.
 *
 * `parts.test.ts` covers one shutter against one builder. This covers the layer above:
 * finding a host's assemblies in the scene, solving each, and putting them in an order.
 * Every one of those is a place the two callers could diverge — the panel showing pour 2
 * where the AI reports pour 1, or one of them silently dropping a lift — and none of it
 * would look wrong on screen.
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
    height: 6,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'plywood',
    ...overrides,
  } as WallNode
}

function makeAssembly(
  id: string,
  segmentIndex: number,
  liftIndex: number,
  overrides: Partial<FormworkAssemblyNode> = {},
): FormworkAssemblyNode {
  return {
    object: 'node',
    id,
    type: 'formwork-assembly',
    parentId: 'wall_1',
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

/** A level holding the wall, which is what the coverage engine classifies faces against. */
function sceneOf(wall: WallNode, assemblies: FormworkAssemblyNode[]): Record<string, AnyNode> {
  const nodes: Record<string, AnyNode> = {
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      children: [wall.id as string],
      elevation: 0,
      height: 6,
    } as unknown as AnyNode,
    [wall.id as string]: wall as unknown as AnyNode,
  }
  for (const assembly of assemblies) nodes[assembly.id as string] = assembly as unknown as AnyNode
  return nodes
}

describe('solveShuttersForHost', () => {
  test('a host with no assemblies solves to nothing rather than to an empty shutter', () => {
    const wall = makeWall()

    expect(solveShuttersForHost(wall, sceneOf(wall, []))).toEqual([])
  })

  test('an unformed host produces no parts even with an assembly attached', () => {
    // The assembly can outlive the decision that made it — `formworkType` back to
    // `none` has to mean no parts, or a bill survives the shutter being cancelled.
    const wall = makeWall({ formworkType: 'none' })
    const assembly = makeAssembly('formwork-assembly_1', 0, 0)

    expect(solveShuttersForHost(wall, sceneOf(wall, [assembly]))).toEqual([])
  })

  test('solves every assembly on the host', () => {
    const wall = makeWall({ maxLiftHeight: 3 })
    const lower = makeAssembly('formwork-assembly_1', 0, 0)
    const upper = makeAssembly('formwork-assembly_2', 0, 1)

    const solved = solveShuttersForHost(wall, sceneOf(wall, [lower, upper]))

    expect(solved).toHaveLength(2)
    for (const shutter of solved) expect(shutter.parts.length).toBeGreaterThan(0)
  })

  test('orders by pour, not by whatever order the node map iterates in', () => {
    const wall = makeWall({ maxLiftHeight: 3 })
    // Inserted upper-first, which is the state a scene reaches after an undo or a
    // re-attach — an unordered list has the panel labelling lift 2 as the base lift.
    const upper = makeAssembly('formwork-assembly_2', 0, 1)
    const lower = makeAssembly('formwork-assembly_1', 0, 0)

    const solved = solveShuttersForHost(wall, sceneOf(wall, [upper, lower]))

    expect(solved.map((shutter) => shutter.assembly.liftIndex)).toEqual([0, 1])
  })

  test('each lift gets its own parts, with marks that do not collide across the stack', () => {
    const wall = makeWall({ maxLiftHeight: 3 })
    const solved = solveShuttersForHost(
      wall,
      sceneOf(wall, [
        makeAssembly('formwork-assembly_1', 0, 0),
        makeAssembly('formwork-assembly_2', 0, 1),
      ]),
    )

    // Within one shutter a mark identifies one part. Across the stack the two lifts are
    // separately erected shutters of the same panels, so they legitimately repeat.
    for (const shutter of solved) expect(duplicateMarks(shutter.parts)).toEqual([])
  })

  test('the whole element bills as one order', () => {
    const wall = makeWall({ maxLiftHeight: 3 })
    const solved = solveShuttersForHost(
      wall,
      sceneOf(wall, [
        makeAssembly('formwork-assembly_1', 0, 0),
        makeAssembly('formwork-assembly_2', 0, 1),
      ]),
    )

    const perLift = solved.map((shutter) => bomLines(shutter.parts))
    const together = bomLines(solved.flatMap((shutter) => shutter.parts))

    // Fewer lines than the two bills laid end to end, because the same panel type on
    // both lifts is one thing to order — that is the whole reason the bill is taken
    // across the element rather than per shutter.
    expect(together.length).toBeLessThan(perLift[0]!.length + perLift[1]!.length)
    expect(bomWeightKg(together).totalKg).toBeGreaterThan(0)
  })

  test('a part override reaches the solve through the assembly it is stored on', () => {
    const wall = makeWall()
    const plain = solveShuttersForHost(
      wall,
      sceneOf(wall, [makeAssembly('formwork-assembly_1', 0, 0)]),
    )
    const mark = plain[0]!.parts.find((part) => part.kind === 'panel')!.mark

    const edited = solveShuttersForHost(
      wall,
      sceneOf(wall, [
        makeAssembly('formwork-assembly_1', 0, 0, { partOverrides: { [mark]: { omitted: true } } }),
      ]),
    )

    const part = edited[0]!.parts.find((candidate) => candidate.mark === mark)
    expect(part?.omitted).toBe(true)
    // Off the order, still in the shutter.
    expect(edited[0]!.parts).toHaveLength(plain[0]!.parts.length)
    expect(bomLines(edited[0]!.parts).flatMap((line) => line.marks)).not.toContain(mark)
  })
})
