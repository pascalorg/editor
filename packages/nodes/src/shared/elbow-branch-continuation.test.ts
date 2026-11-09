import { describe, expect, test } from 'bun:test'
import { DuctFittingNode, PipeFittingNode } from '@pascal-app/core'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import {
  planDuctElbowBranchPromotion,
  planDuctTeeCrossPromotion,
  planPipeElbowBranchPromotion,
  planPipeTeeCrossPromotion,
} from './elbow-branch-continuation'

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
}

function ductElbow(angle = 90): DuctFittingNode {
  return DuctFittingNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Elbow',
    fittingType: 'elbow',
    shape: 'rect',
    width: 14,
    height: 8,
    diameter: 12,
    angle,
    system: 'supply',
    position: [4, 2.4, 3],
    rotation: [0, 0.35, 0],
  })
}

function pipeElbow(angle: number): PipeFittingNode {
  return PipeFittingNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Elbow',
    fittingType: 'elbow',
    diameter: 2,
    angle,
    system: 'waste',
    position: [1, 1, 2],
    rotation: [0.2, 0.4, -0.1],
  })
}

describe('elbow branch continuation', () => {
  test('promotes a duct elbow without moving either occupied collar', () => {
    const elbow = ductElbow()
    const oldPorts = getDuctFittingPorts(elbow)
    const oldConnected = oldPorts.find((port) => port.id === 'outlet')!
    const oldOther = oldPorts.find((port) => port.id === 'inlet')!
    const plan = planDuctElbowBranchPromotion(elbow, 'outlet')
    expect(plan).not.toBeNull()
    expect(plan!.fitting.fittingType).toBe('tee')
    const ports = getDuctFittingPorts(plan!.fitting)
    expect(
      distance(ports.find((port) => port.id === 'inlet')!.position, oldConnected.position),
    ).toBeLessThan(1e-6)
    expect(
      distance(ports.find((port) => port.id === 'branch')!.position, oldOther.position),
    ).toBeLessThan(1e-6)
    expect(dot(plan!.continuationPort.direction, oldConnected.direction)).toBeCloseTo(-1, 6)
  })

  test('works from either occupied duct collar', () => {
    const elbow = ductElbow(45)
    const oldPorts = getDuctFittingPorts(elbow)
    const oldConnected = oldPorts.find((port) => port.id === 'inlet')!
    const oldOther = oldPorts.find((port) => port.id === 'outlet')!
    const plan = planDuctElbowBranchPromotion(elbow, 'inlet')
    expect(plan).not.toBeNull()
    const ports = getDuctFittingPorts(plan!.fitting)
    expect(
      distance(ports.find((port) => port.id === 'inlet')!.position, oldConnected.position),
    ).toBeLessThan(1e-6)
    expect(
      distance(ports.find((port) => port.id === 'branch')!.position, oldOther.position),
    ).toBeLessThan(1e-6)
  })

  test('promotes a square DWV elbow to a sanitary tee', () => {
    const elbow = pipeElbow(90)
    const oldPorts = getPipeFittingPorts(elbow)
    const plan = planPipeElbowBranchPromotion(elbow, 'outlet')
    expect(plan).not.toBeNull()
    expect(plan!.fitting.fittingType).toBe('sanitary-tee')
    const ports = getPipeFittingPorts(plan!.fitting)
    expect(
      distance(
        ports.find((port) => port.id === 'inlet')!.position,
        oldPorts.find((port) => port.id === 'outlet')!.position,
      ),
    ).toBeLessThan(1e-6)
    expect(
      distance(
        ports.find((port) => port.id === 'branch')!.position,
        oldPorts.find((port) => port.id === 'inlet')!.position,
      ),
    ).toBeLessThan(1e-6)
  })

  test('promotes a 45-degree DWV elbow to a wye', () => {
    const elbow = pipeElbow(45)
    const plan = planPipeElbowBranchPromotion(elbow, 'inlet')
    expect(plan).not.toBeNull()
    expect(plan!.fitting.fittingType).toBe('wye')
  })

  test('promotes a square duct tee to a cross without moving its three collars', () => {
    const tee = DuctFittingNode.parse({
      ...ductElbow(),
      fittingType: 'tee',
      branchAngle: 90,
      diameter2: 12,
    })
    const oldPorts = getDuctFittingPorts(tee)
    const plan = planDuctTeeCrossPromotion(tee)
    expect(plan?.fitting.fittingType).toBe('cross')
    const newPorts = getDuctFittingPorts(plan!.fitting)
    for (const id of ['inlet', 'outlet', 'branch']) {
      expect(
        distance(
          oldPorts.find((port) => port.id === id)!.position,
          newPorts.find((port) => port.id === id)!.position,
        ),
      ).toBeLessThan(1e-6)
    }
    expect(plan?.continuationPort.id).toBe('branch2')
  })

  test('promotes a sanitary tee to a DWV cross without moving its three collars', () => {
    const tee = PipeFittingNode.parse({
      ...pipeElbow(90),
      fittingType: 'sanitary-tee',
      diameter2: 2,
    })
    const oldPorts = getPipeFittingPorts(tee)
    const plan = planPipeTeeCrossPromotion(tee)
    expect(plan?.fitting.fittingType).toBe('cross')
    const newPorts = getPipeFittingPorts(plan!.fitting)
    for (const id of ['inlet', 'outlet', 'branch']) {
      expect(
        distance(
          oldPorts.find((port) => port.id === id)!.position,
          newPorts.find((port) => port.id === id)!.position,
        ),
      ).toBeLessThan(1e-6)
    }
    expect(plan?.continuationPort.id).toBe('branch2')
  })
})
