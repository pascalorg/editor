import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, PipeFittingNode, PipeSegmentNode } from '@pascal-app/core'
import { pipeFittingParametrics } from './parametrics'
import { getPipeFittingPorts } from './ports'

type Point = [number, number, number]

function pipeElbow() {
  return PipeFittingNode.parse({
    id: 'pipe-fitting_elbow' as AnyNodeId,
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'DWV bend',
    fittingType: 'elbow',
    angle: 90,
    diameter: 3,
    diameter2: 3,
    pipeMaterial: 'pvc',
    system: 'waste',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  })
}

function pipe(id: string, path: Point[]) {
  return PipeSegmentNode.parse({
    id: id as AnyNodeId,
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'DWV pipe',
    path,
    diameter: 3,
    pipeMaterial: 'pvc',
    system: 'waste',
  })
}

function add(point: readonly number[], dir: readonly number[], length: number): Point {
  return [point[0]! + dir[0]! * length, point[1]! + dir[1]! * length, point[2]! + dir[2]! * length]
}

describe('pipeFittingParametrics', () => {
  test('deleting an elbow re-extends mated pipe ends back onto the junction', () => {
    const fitting = pipeElbow()
    const inlet = getPipeFittingPorts(fitting).find((p) => p.id === 'inlet')!
    const outlet = getPipeFittingPorts(fitting).find((p) => p.id === 'outlet')!
    const inletRun = pipe('pipe-segment_inlet', [
      add(inlet.position, inlet.direction, 3),
      [...inlet.position] as Point,
    ])
    const outletRun = pipe('pipe-segment_outlet', [
      [...outlet.position] as Point,
      add(outlet.position, outlet.direction, 3),
    ])
    const nodes: Record<AnyNodeId, AnyNode> = {
      [fitting.id]: fitting as AnyNode,
      [inletRun.id]: inletRun as AnyNode,
      [outletRun.id]: outletRun as AnyNode,
    }

    const updates = pipeFittingParametrics.onDelete?.(fitting, nodes) ?? []
    const inletUpdate = updates.find((u) => u.id === inletRun.id)
    const outletUpdate = updates.find((u) => u.id === outletRun.id)

    expect((inletUpdate?.data as Partial<PipeSegmentNode>).path?.[1]).toEqual([...fitting.position])
    expect((outletUpdate?.data as Partial<PipeSegmentNode>).path?.[0]).toEqual([
      ...fitting.position,
    ])
  })

  test('delete repair matches the 5 cm live connectivity mate tolerance', () => {
    const fitting = pipeElbow()
    const inlet = getPipeFittingPorts(fitting).find((p) => p.id === 'inlet')!
    const inletRun = pipe('pipe-segment_inlet', [
      add(inlet.position, inlet.direction, 3),
      add(inlet.position, [0, 0, 1], 0.04),
    ])
    const nodes: Record<AnyNodeId, AnyNode> = {
      [fitting.id]: fitting as AnyNode,
      [inletRun.id]: inletRun as AnyNode,
    }

    const updates = pipeFittingParametrics.onDelete?.(fitting, nodes) ?? []

    expect((updates[0]?.data as Partial<PipeSegmentNode>).path?.[1]).toEqual([...fitting.position])
  })

  test('deleting a branch fitting leaves mated pipe ends untouched', () => {
    const wye = PipeFittingNode.parse({ ...pipeElbow(), fittingType: 'wye' })
    const inlet = getPipeFittingPorts(wye).find((p) => p.id === 'inlet')!
    const inletRun = pipe('pipe-segment_inlet', [
      add(inlet.position, inlet.direction, 3),
      [...inlet.position] as Point,
    ])
    const nodes: Record<AnyNodeId, AnyNode> = {
      [wye.id]: wye as AnyNode,
      [inletRun.id]: inletRun as AnyNode,
    }

    expect(pipeFittingParametrics.onDelete?.(wye, nodes) ?? []).toEqual([])
  })
})
