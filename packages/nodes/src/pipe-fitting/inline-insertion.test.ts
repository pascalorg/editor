import { describe, expect, test } from 'bun:test'
import { PipeFittingNode, PipeSegmentNode } from '@pascal-app/core'
import { planPipeInlineInsertion } from './inline-insertion'
import { getPipeFittingPorts } from './ports'

type Point = [number, number, number]

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}

function pipe(path: Point[]) {
  return PipeSegmentNode.parse({
    name: 'Drain',
    path,
    diameter: 3,
    pipeMaterial: 'abs',
    system: 'waste',
  })
}

function coupling() {
  return PipeFittingNode.parse({ fittingType: 'coupling', diameter: 2, diameter2: 2 })
}

describe('planPipeInlineInsertion', () => {
  test('splits a sloped run and mates both halves to the fitting collars', () => {
    const run = pipe([
      [0, 0, 0],
      [6, -0.12, 0],
    ])
    const plan = planPipeInlineInsertion(
      run,
      { nodeId: run.id, segmentIndex: 0, point: [3, -0.06, 0] },
      coupling(),
    )

    expect(plan).not.toBeNull()
    expect(plan!.fitting.diameter).toBe(3)
    expect(plan!.fitting.pipeMaterial).toBe('abs')
    const ports = getPipeFittingPorts(plan!.fitting)
    const inlet = ports.find((port) => port.id === 'inlet')!
    const outlet = ports.find((port) => port.id === 'outlet')!
    const headPath = plan!.runUpdate.data.path!
    expect(distance(headPath.at(-1)!, inlet.position)).toBeLessThan(1e-6)
    expect(distance(plan!.runTail.path[0]!, outlet.position)).toBeLessThan(1e-6)
    expect(plan!.runTail.path.at(-1)).toEqual([6, -0.12, 0])
  })

  test('keeps every original bend on its side of the split', () => {
    const run = pipe([
      [0, 0, 0],
      [2, 0, 0],
      [2, -0.04, 4],
    ])
    const plan = planPipeInlineInsertion(
      run,
      { nodeId: run.id, segmentIndex: 1, point: [2, -0.02, 2] },
      coupling(),
    )!

    expect(plan.runUpdate.data.path?.[1]).toEqual([2, 0, 0])
    expect(plan.runTail.path.at(-1)).toEqual([2, -0.04, 4])
  })

  test('rejects branch fittings and placements without collar clearance', () => {
    const run = pipe([
      [0, 0, 0],
      [1, 0, 0],
    ])
    const hit = { nodeId: run.id, segmentIndex: 0, point: [0.02, 0, 0] as Point }
    expect(planPipeInlineInsertion(run, hit, coupling())).toBeNull()
    expect(
      planPipeInlineInsertion(run, hit, PipeFittingNode.parse({ fittingType: 'sanitary-tee' })),
    ).toBeNull()
  })

  test('continues a reducer with its outlet diameter', () => {
    const run = pipe([
      [0, 0, 0],
      [4, 0, 0],
    ])
    const reducer = PipeFittingNode.parse({
      fittingType: 'reducer',
      diameter: 3,
      diameter2: 2,
    })
    const plan = planPipeInlineInsertion(
      run,
      { nodeId: run.id, segmentIndex: 0, point: [2, 0, 0] },
      reducer,
    )!

    expect(plan.runTail.diameter).toBe(2)
  })
})
