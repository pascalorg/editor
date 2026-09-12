import type {
  AnyNode,
  AnyNodeId,
  DuctFittingNode,
  DuctSegmentNode,
  NodePort,
  PipeFittingNode,
  PipeSegmentNode,
} from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { getPipeFittingPorts } from '../pipe-fitting/ports'

type Point = [number, number, number]
type Run = DuctSegmentNode | PipeSegmentNode
type Fitting = DuctFittingNode | PipeFittingNode

type Connection = {
  portId: string
  port: NodePort
  run: Run
  endIndex: number
}

export type FittingDeletionPlan = {
  fittingId: AnyNodeId
  deleteFitting: boolean
  cascadeDeleteIds: AnyNodeId[]
  updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>
}

const MATE_TOLERANCE_SQ = 0.05 ** 2
const DIRECTION_TOLERANCE = 1e-4

function distanceSquared(a: readonly number[], b: readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

function fittingPorts(fitting: Fitting): NodePort[] {
  return fitting.type === 'duct-fitting'
    ? getDuctFittingPorts(fitting)
    : getPipeFittingPorts(fitting)
}

function fittingConnections(fitting: Fitting, nodes: Record<AnyNodeId, AnyNode>): Connection[] {
  const runType = fitting.type === 'duct-fitting' ? 'duct-segment' : 'pipe-segment'
  const connections: Connection[] = []
  for (const port of fittingPorts(fitting)) {
    let match: Connection | undefined
    for (const node of Object.values(nodes)) {
      if (node.type !== runType || node.system !== fitting.system) continue
      const run = node as Run
      const endIndices = [0, run.path.length - 1]
      for (const endIndex of endIndices) {
        const endpoint = run.path[endIndex]
        if (endpoint && distanceSquared(endpoint, port.position) <= MATE_TOLERANCE_SQ) {
          match = { portId: port.id, port, run, endIndex }
          break
        }
      }
      if (match) break
    }
    if (match) connections.push(match)
  }
  return connections
}

function frame(primary: Vector3, reference: Vector3): Matrix4 | null {
  const x = primary.clone().normalize()
  const z = new Vector3().crossVectors(x, reference)
  if (z.lengthSq() < 1e-10) return null
  z.normalize()
  const y = new Vector3().crossVectors(z, x)
  return new Matrix4().makeBasis(x, y, z)
}

function rotationMapping(
  localPrimary: Vector3,
  localReference: Vector3,
  worldPrimary: Vector3,
  worldReference: Vector3,
): Point | null {
  const localFrame = frame(localPrimary, localReference)
  const worldFrame = frame(worldPrimary, worldReference)
  if (!localFrame || !worldFrame) return null
  const rotation = new Quaternion().setFromRotationMatrix(
    worldFrame.multiply(localFrame.transpose()),
  )
  const euler = new Euler().setFromQuaternion(rotation)
  return [euler.x, euler.y, euler.z]
}

function direction(connection: Connection): Vector3 {
  return new Vector3(...connection.port.direction).normalize()
}

function ductProfile(fitting: DuctFittingNode, portId: string) {
  const secondary = portId === 'branch' || portId === 'branch2'
  return secondary
    ? {
        shape: fitting.shape2,
        width: fitting.width2,
        height: fitting.height2,
        diameter: fitting.diameter2,
      }
    : {
        shape: fitting.shape,
        width: fitting.width,
        height: fitting.height,
        diameter: fitting.diameter,
      }
}

function fittingPatchForTee(
  fitting: Fitting,
  runConnection: Connection,
  branchConnection: Connection,
  rotation: Point,
): Partial<Fitting> {
  if (fitting.type === 'duct-fitting') {
    const run = ductProfile(fitting, runConnection.portId)
    const branch = ductProfile(fitting, branchConnection.portId)
    return {
      name: 'Tee',
      fittingType: 'tee',
      rotation,
      branchAngle: 90,
      shape: run.shape,
      width: run.width,
      height: run.height,
      diameter: run.diameter,
      shape2: branch.shape,
      width2: branch.width,
      height2: branch.height,
      diameter2: branch.diameter,
    }
  }
  const runDiameter =
    runConnection.portId === 'branch' || runConnection.portId === 'branch2'
      ? fitting.diameter2
      : fitting.diameter
  const branchDiameter =
    branchConnection.portId === 'branch' || branchConnection.portId === 'branch2'
      ? fitting.diameter2
      : fitting.diameter
  return {
    name: 'Sanitary tee',
    fittingType: 'sanitary-tee',
    rotation,
    diameter: runDiameter,
    diameter2: branchDiameter,
  }
}

function fittingPatchForElbow(
  fitting: Fitting,
  connection: Connection,
  angle: number,
  rotation: Point,
): Partial<Fitting> {
  if (fitting.type === 'duct-fitting') {
    const profile = ductProfile(fitting, connection.portId)
    return {
      name: 'Elbow',
      fittingType: 'elbow',
      rotation,
      angle,
      shape: profile.shape,
      width: profile.width,
      height: profile.height,
      diameter: profile.diameter,
      diameter2: profile.diameter,
    }
  }
  const diameter =
    connection.portId === 'branch' || connection.portId === 'branch2'
      ? fitting.diameter2
      : fitting.diameter
  return {
    name: 'Elbow',
    fittingType: 'elbow',
    rotation,
    angle,
    diameter,
    diameter2: diameter,
  }
}

function endpointUpdates(
  connections: Connection[],
  targets: ReadonlyMap<Connection, readonly [number, number, number]>,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  return connections.flatMap((connection) => {
    const target = targets.get(connection)
    if (!target) return []
    const path = connection.run.path.map((point) => [...point] as Point)
    path[connection.endIndex] = [...target]
    return [{ id: connection.run.id, data: { path } as Partial<AnyNode> }]
  })
}

function removalPlan(fitting: Fitting, remaining: Connection[]): FittingDeletionPlan {
  const target = fitting.position as Point
  const targets = new Map(remaining.map((connection) => [connection, target] as const))
  return {
    fittingId: fitting.id,
    deleteFitting: true,
    cascadeDeleteIds: [],
    updates: endpointUpdates(remaining, targets),
  }
}

function pathFromOuterEnd(connection: Connection): Point[] {
  const path = connection.run.path.map((point) => [...point] as Point)
  return connection.endIndex === 0 ? path.reverse() : path
}

function pathTowardOuterEnd(connection: Connection): Point[] {
  const path = connection.run.path.map((point) => [...point] as Point)
  return connection.endIndex === 0 ? path : path.reverse()
}

function straightMergePlan(
  fitting: Fitting,
  remaining: [Connection, Connection],
): FittingDeletionPlan {
  const [primary, secondary] = remaining
  const primarySide = pathFromOuterEnd(primary)
  const secondarySide = pathTowardOuterEnd(secondary)
  const path = [...primarySide.slice(0, -1), ...secondarySide.slice(1)]
  return {
    fittingId: fitting.id,
    deleteFitting: true,
    cascadeDeleteIds: [secondary.run.id],
    updates: [{ id: primary.run.id, data: { path } as Partial<AnyNode> }],
  }
}

function teePlan(fitting: Fitting, remaining: Connection[]): FittingDeletionPlan | null {
  let pair: [Connection, Connection] | null = null
  for (let i = 0; i < remaining.length; i += 1) {
    for (let j = i + 1; j < remaining.length; j += 1) {
      if (direction(remaining[i]!).dot(direction(remaining[j]!)) < -1 + DIRECTION_TOLERANCE) {
        pair = [remaining[i]!, remaining[j]!]
        break
      }
    }
    if (pair) break
  }
  if (!pair) return null
  const branch = remaining.find((connection) => !pair?.includes(connection))
  if (!branch) return null
  const rotation = rotationMapping(
    new Vector3(1, 0, 0),
    new Vector3(0, 0, 1),
    direction(pair[1]),
    direction(branch),
  )
  if (!rotation) return null
  const patch = fittingPatchForTee(fitting, pair[0], branch, rotation)
  const nextFitting = { ...fitting, ...patch } as Fitting
  const nextPorts = new Map(fittingPorts(nextFitting).map((port) => [port.id, port]))
  const portAssignments = new Map<Connection, string>([
    [pair[0], 'inlet'],
    [pair[1], 'outlet'],
    [branch, 'branch'],
  ])
  const targets = new Map<Connection, readonly [number, number, number]>()
  for (const connection of remaining) {
    const port = nextPorts.get(portAssignments.get(connection) ?? '')
    if (port) targets.set(connection, port.position)
  }
  return {
    fittingId: fitting.id,
    deleteFitting: false,
    cascadeDeleteIds: [],
    updates: [
      { id: fitting.id, data: patch as Partial<AnyNode> },
      ...endpointUpdates(remaining, targets),
    ],
  }
}

function elbowPlan(fitting: Fitting, remaining: Connection[]): FittingDeletionPlan | null {
  const first = remaining[0]
  const second = remaining[1]
  if (!first || !second) return null
  const separation = direction(first).angleTo(direction(second))
  const angle = 180 - (separation * 180) / Math.PI
  if (angle < -DIRECTION_TOLERANCE || angle > 90 + DIRECTION_TOLERANCE) return null
  if (angle <= DIRECTION_TOLERANCE) return null
  const localOutlet = new Vector3(
    Math.cos((angle * Math.PI) / 180),
    0,
    Math.sin((angle * Math.PI) / 180),
  )
  const rotation = rotationMapping(
    new Vector3(-1, 0, 0),
    localOutlet,
    direction(first),
    direction(second),
  )
  if (!rotation) return null
  const patch = fittingPatchForElbow(fitting, first, Math.min(90, Math.max(0, angle)), rotation)
  const nextFitting = { ...fitting, ...patch } as Fitting
  const nextPorts = new Map(fittingPorts(nextFitting).map((port) => [port.id, port]))
  const inlet = nextPorts.get('inlet')
  const outlet = nextPorts.get('outlet')
  if (!inlet || !outlet) return null
  const targets = new Map<Connection, readonly [number, number, number]>([
    [first, inlet.position],
    [second, outlet.position],
  ])
  return {
    fittingId: fitting.id,
    deleteFitting: false,
    cascadeDeleteIds: [],
    updates: [
      { id: fitting.id, data: patch as Partial<AnyNode> },
      ...endpointUpdates(remaining, targets),
    ],
  }
}

function planFittingAfterDeletion(
  fitting: Fitting,
  nodes: Record<AnyNodeId, AnyNode>,
  topologyDeleteIds: ReadonlySet<AnyNodeId>,
): FittingDeletionPlan | null {
  const remaining = fittingConnections(fitting, nodes).filter(
    (connection) => !topologyDeleteIds.has(connection.run.id),
  )
  if (remaining.length === 3) return teePlan(fitting, remaining) ?? removalPlan(fitting, remaining)
  if (remaining.length === 2) {
    const dot = direction(remaining[0]!).dot(direction(remaining[1]!))
    if (dot < -1 + DIRECTION_TOLERANCE) {
      return straightMergePlan(fitting, [remaining[0]!, remaining[1]!])
    }
    return elbowPlan(fitting, remaining) ?? removalPlan(fitting, remaining)
  }
  return removalPlan(fitting, remaining)
}

export function fittingDeletionPlansForRun(
  run: Run,
  nodes: Record<AnyNodeId, AnyNode>,
  topologyDeleteIds: ReadonlySet<AnyNodeId>,
  ownerOnly: boolean,
): FittingDeletionPlan[] {
  const fittingType = run.type === 'duct-segment' ? 'duct-fitting' : 'pipe-fitting'
  const plans: FittingDeletionPlan[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== fittingType) continue
    const fitting = node as Fitting
    if (['end-cap', 'damper', 'access-panel', 'cleanout', 'coupling'].includes(fitting.fittingType))
      continue
    const connections = fittingConnections(fitting, nodes)
    if (!connections.some((connection) => connection.run.id === run.id)) continue
    if (ownerOnly) {
      const deletedRunIds = connections
        .map((connection) => connection.run.id)
        .filter((id) => topologyDeleteIds.has(id))
        .sort()
      if (deletedRunIds[0] !== run.id) continue
    }
    const plan = planFittingAfterDeletion(fitting, nodes, topologyDeleteIds)
    if (plan) plans.push(plan)
  }
  return plans
}
