import {
  type AnyNode,
  type AnyNodeId,
  DuctFittingNode,
  nodeRegistry,
  PipeFittingNode,
} from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { getPipeFittingPorts, WYE_BRANCH_RAD } from '../pipe-fitting/ports'
import type { ScenePort } from './ports'

type Point = [number, number, number]

export type ElbowBranchPromotion<T> = {
  fitting: T
  continuationPort: ScenePort
}

export type RunContinuationHandlePlan = {
  position: Point
  fittingId?: AnyNodeId
}

const MATE_TOLERANCE_M = 0.05

export function findMatedScenePorts(
  source: ScenePort,
  nodes: Readonly<Record<string, AnyNode>>,
): ScenePort[] {
  const toleranceSq = MATE_TOLERANCE_M * MATE_TOLERANCE_M
  const mates: ScenePort[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.id === source.nodeId) continue
    const ports = nodeRegistry.get(node.type)?.ports?.(node)
    if (!ports) continue
    for (const port of ports) {
      if (source.system && port.system && source.system !== port.system) continue
      const dx = source.position[0] - port.position[0]
      const dy = source.position[1] - port.position[1]
      const dz = source.position[2] - port.position[2]
      if (dx * dx + dy * dy + dz * dz <= toleranceSq) {
        mates.push({ ...port, nodeId: node.id })
      }
    }
  }
  return mates
}

function handlePosition(port: ScenePort, gap: number): Point {
  return [
    port.position[0] + port.direction[0] * gap,
    port.position[1] + port.direction[1] * gap,
    port.position[2] + port.direction[2] * gap,
  ]
}

function allPortsOccupied(
  fitting: DuctFittingNode | PipeFittingNode,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  const ports = nodeRegistry.get(fitting.type)?.ports?.(fitting) ?? []
  return ports.every(
    (port) => findMatedScenePorts({ ...port, nodeId: fitting.id }, nodes).length > 0,
  )
}

function resolveFittingExpansionHandle<T extends DuctFittingNode | PipeFittingNode>(
  source: ScenePort,
  nodes: Readonly<Record<string, AnyNode>>,
  gap: number,
  fittingType: 'duct-fitting' | 'pipe-fitting',
  promoteElbow: (fitting: T, connectedPortId: string) => ElbowBranchPromotion<T> | null,
  promoteTee: (fitting: T) => ElbowBranchPromotion<T> | null,
): RunContinuationHandlePlan | null {
  const mates = findMatedScenePorts(source, nodes)
  if (mates.length === 0) return { position: handlePosition(source, gap) }
  for (const mate of mates) {
    const fitting = nodes[mate.nodeId]
    if (fitting?.type !== fittingType) continue
    const promotion =
      fitting.fittingType === 'elbow'
        ? promoteElbow(fitting as T, mate.id)
        : promoteTee(fitting as T)
    if (!promotion) continue
    if (!allPortsOccupied(fitting, nodes)) continue
    return {
      position: handlePosition(promotion.continuationPort, gap),
      fittingId: fitting.id,
    }
  }
  return null
}

export function resolveDuctContinuationHandle(
  source: ScenePort,
  nodes: Readonly<Record<string, AnyNode>>,
  gap: number,
): RunContinuationHandlePlan | null {
  return resolveFittingExpansionHandle(
    source,
    nodes,
    gap,
    'duct-fitting',
    planDuctElbowBranchPromotion,
    planDuctTeeCrossPromotion,
  )
}

export function resolvePipeContinuationHandle(
  source: ScenePort,
  nodes: Readonly<Record<string, AnyNode>>,
  gap: number,
): RunContinuationHandlePlan | null {
  return resolveFittingExpansionHandle(
    source,
    nodes,
    gap,
    'pipe-fitting',
    planPipeElbowBranchPromotion,
    planPipeTeeCrossPromotion,
  )
}

function frame(primary: Vector3, reference: Vector3): Matrix4 | null {
  const x = primary.clone().normalize()
  const z = new Vector3().crossVectors(x, reference)
  if (z.lengthSq() < 1e-10) return null
  z.normalize()
  const y = new Vector3().crossVectors(z, x)
  return new Matrix4().makeBasis(x, y, z)
}

function branchRotation(
  growthDirection: Vector3,
  existingBranchDirection: Vector3,
  localBranchDirection: Vector3,
): Point | null {
  const localFrame = frame(new Vector3(1, 0, 0), localBranchDirection)
  const worldFrame = frame(growthDirection, existingBranchDirection)
  if (!localFrame || !worldFrame) return null
  const rotation = new Quaternion().setFromRotationMatrix(
    worldFrame.multiply(localFrame.transpose()),
  )
  const euler = new Euler().setFromQuaternion(rotation)
  return [euler.x, euler.y, euler.z]
}

function elbowDirections(
  ports: ScenePort[],
  connectedPortId: string,
): { growth: Vector3; branch: Vector3 } | null {
  const connected = ports.find((port) => port.id === connectedPortId)
  const other = ports.find((port) => port.id !== connectedPortId)
  if (!connected || !other) return null
  const growth = new Vector3(...connected.direction).multiplyScalar(-1).normalize()
  const branch = new Vector3(...other.direction).normalize()
  if (growth.lengthSq() < 1e-10 || branch.lengthSq() < 1e-10) return null
  return { growth, branch }
}

export function planDuctElbowBranchPromotion(
  elbow: DuctFittingNode,
  connectedPortId: string,
): ElbowBranchPromotion<DuctFittingNode> | null {
  if (elbow.fittingType !== 'elbow') return null
  const existingPorts = getDuctFittingPorts(elbow).map((port) => ({
    ...port,
    nodeId: elbow.id as AnyNodeId,
  }))
  const directions = elbowDirections(existingPorts, connectedPortId)
  if (!directions) return null
  const measuredBranchAngle = (directions.growth.angleTo(directions.branch) * 180) / Math.PI
  if (measuredBranchAngle < 45 - 1e-4 || measuredBranchAngle > 135 + 1e-4) return null
  // The tolerance above intentionally accepts values infinitesimally outside
  // the schema range, so normalize before parsing the generated fitting.
  const branchAngle = Math.min(135, Math.max(45, measuredBranchAngle))
  const phi = (branchAngle * Math.PI) / 180
  const rotation = branchRotation(
    directions.growth,
    directions.branch,
    new Vector3(Math.cos(phi), 0, Math.sin(phi)),
  )
  if (!rotation) return null
  const fitting = DuctFittingNode.parse({
    ...elbow,
    name: 'Tee',
    fittingType: 'tee',
    rotation,
    branchAngle,
    shape2: elbow.shape,
    width2: elbow.width,
    height2: elbow.height,
    diameter2: elbow.diameter,
  })
  const continuation = getDuctFittingPorts(fitting).find((port) => port.id === 'outlet')
  if (!continuation) return null
  return {
    fitting,
    continuationPort: { ...continuation, nodeId: elbow.id as AnyNodeId },
  }
}

export function planPipeElbowBranchPromotion(
  elbow: PipeFittingNode,
  connectedPortId: string,
): ElbowBranchPromotion<PipeFittingNode> | null {
  if (elbow.fittingType !== 'elbow') return null
  const existingPorts = getPipeFittingPorts(elbow).map((port) => ({
    ...port,
    nodeId: elbow.id as AnyNodeId,
  }))
  const directions = elbowDirections(existingPorts, connectedPortId)
  if (!directions) return null
  const angle = (directions.growth.angleTo(directions.branch) * 180) / Math.PI
  const isWye = Math.abs(angle - 45) <= 1
  const isSanitaryTee = Math.abs(angle - 90) <= 1
  if (!isWye && !isSanitaryTee) return null
  const localBranch = isWye
    ? new Vector3(Math.cos(WYE_BRANCH_RAD), 0, Math.sin(WYE_BRANCH_RAD))
    : new Vector3(0, 0, 1)
  const rotation = branchRotation(directions.growth, directions.branch, localBranch)
  if (!rotation) return null
  const fitting = PipeFittingNode.parse({
    ...elbow,
    name: isWye ? 'Wye' : 'Sanitary Tee',
    fittingType: isWye ? 'wye' : 'sanitary-tee',
    rotation,
    diameter2: elbow.diameter,
  })
  const continuation = getPipeFittingPorts(fitting).find((port) => port.id === 'outlet')
  if (!continuation) return null
  return {
    fitting,
    continuationPort: { ...continuation, nodeId: elbow.id as AnyNodeId },
  }
}

export function planDuctTeeCrossPromotion(
  tee: DuctFittingNode,
): ElbowBranchPromotion<DuctFittingNode> | null {
  if (tee.fittingType !== 'tee' || Math.abs(tee.branchAngle - 90) > 1e-4) return null
  const fitting = DuctFittingNode.parse({ ...tee, name: 'Cross', fittingType: 'cross' })
  const continuation = getDuctFittingPorts(fitting).find((port) => port.id === 'branch2')
  return continuation
    ? {
        fitting,
        continuationPort: { ...continuation, nodeId: tee.id as AnyNodeId },
      }
    : null
}

export function planPipeTeeCrossPromotion(
  tee: PipeFittingNode,
): ElbowBranchPromotion<PipeFittingNode> | null {
  if (tee.fittingType !== 'sanitary-tee') return null
  const fitting = PipeFittingNode.parse({ ...tee, name: 'Cross', fittingType: 'cross' })
  const continuation = getPipeFittingPorts(fitting).find((port) => port.id === 'branch2')
  return continuation
    ? {
        fitting,
        continuationPort: { ...continuation, nodeId: tee.id as AnyNodeId },
      }
    : null
}
