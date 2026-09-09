import {
  type AnyNode,
  type AnyNodeId,
  DuctFittingNode,
  type DuctSegmentNode,
  PipeFittingNode,
  type PipeSegmentNode,
} from '@pascal-app/core'
import { Euler, Quaternion, Vector3 } from 'three'
import { getDuctFittingPorts, localFittingPorts } from '../duct-fitting/ports'
import { ductPortDiameterIn } from '../duct-segment/geometry'
import { getPipeFittingPorts, localPipeFittingPorts } from '../pipe-fitting/ports'
import { accessoryMateQuaternion } from './accessory-placement'
import type { ScenePort } from './ports'

const END_CAP_MATE_TOLERANCE_M = 0.01

function runEndpoint(
  path: Array<readonly [number, number, number]>,
  endpoint: 'start' | 'end',
): { position: [number, number, number]; direction: [number, number, number] } | null {
  if (path.length < 2) return null
  const index = endpoint === 'start' ? 0 : path.length - 1
  const neighborIndex = endpoint === 'start' ? 1 : path.length - 2
  const position = [...path[index]!] as [number, number, number]
  const neighbor = path[neighborIndex]!
  const delta: [number, number, number] = [
    position[0] - neighbor[0],
    position[1] - neighbor[1],
    position[2] - neighbor[2],
  ]
  const length = Math.hypot(...delta)
  return {
    position,
    direction:
      length < 1e-9 ? [1, 0, 0] : [delta[0] / length, delta[1] / length, delta[2] / length],
  }
}

function placeInletAtPort(
  port: ScenePort,
  inletPosition: Vector3,
  rotation: Quaternion,
): { position: [number, number, number]; rotation: [number, number, number] } {
  const offset = inletPosition.clone().applyQuaternion(rotation)
  const position = new Vector3(...port.position).sub(offset)
  const euler = new Euler().setFromQuaternion(rotation)
  return {
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
  }
}

export function createDuctRunEndCap(
  duct: DuctSegmentNode,
  endpoint: 'start' | 'end' = 'end',
): DuctFittingNode | null {
  const end = runEndpoint(duct.path, endpoint)
  if (!end) return null
  const port: ScenePort = {
    ...end,
    id: endpoint,
    nodeId: duct.id,
    diameter: ductPortDiameterIn(duct),
    shape: duct.shape,
    width: duct.width,
    height: duct.height,
    system: duct.system,
  }
  const cap = DuctFittingNode.parse({
    name: 'End Cap',
    fittingType: 'end-cap',
    shape: duct.shape,
    shape2: duct.shape,
    width: duct.width,
    height: duct.height,
    width2: duct.width,
    height2: duct.height,
    diameter: port.diameter,
    diameter2: port.diameter,
    ductMaterial: duct.ductMaterial,
    system: duct.system,
  })
  const rotation = accessoryMateQuaternion(cap, port, {
    [duct.id]: duct,
  } as Record<AnyNodeId, AnyNode>)
  const inlet = localFittingPorts(cap)[0]
  if (!inlet) return null
  return DuctFittingNode.parse({
    ...cap,
    ...placeInletAtPort(port, inlet.position, rotation),
  })
}

export function createPipeRunEndCap(
  pipe: PipeSegmentNode,
  endpoint: 'start' | 'end' = 'end',
): PipeFittingNode | null {
  const end = runEndpoint(pipe.path, endpoint)
  if (!end) return null
  const port: ScenePort = {
    ...end,
    id: endpoint,
    nodeId: pipe.id,
    diameter: pipe.diameter,
    system: pipe.system,
  }
  const cap = PipeFittingNode.parse({
    name: 'End Cap',
    fittingType: 'end-cap',
    diameter: pipe.diameter,
    diameter2: pipe.diameter,
    pipeMaterial: pipe.pipeMaterial,
    system: pipe.system,
  })
  const rotation = new Quaternion().setFromUnitVectors(
    new Vector3(1, 0, 0),
    new Vector3(...port.direction).normalize(),
  )
  const inlet = localPipeFittingPorts(cap)[0]
  if (!inlet) return null
  return PipeFittingNode.parse({
    ...cap,
    ...placeInletAtPort(port, inlet.position, rotation),
  })
}

export function isRunEndCapPort(
  port: ScenePort,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  const owner = nodes[port.nodeId]
  return (
    (owner?.type === 'duct-fitting' || owner?.type === 'pipe-fitting') &&
    owner.fittingType === 'end-cap'
  )
}

export function findMatedRunEndCapIds(
  source: ScenePort | null,
  nodes: Readonly<Record<string, AnyNode>>,
  fittingKind: 'duct-fitting' | 'pipe-fitting',
): AnyNodeId[] {
  if (!source) return []
  const toleranceSq = END_CAP_MATE_TOLERANCE_M * END_CAP_MATE_TOLERANCE_M
  const ids: AnyNodeId[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== fittingKind || node.fittingType !== 'end-cap') continue
    if (node.id === source.nodeId) {
      ids.push(node.id)
      continue
    }
    const ports =
      node.type === 'duct-fitting' ? getDuctFittingPorts(node) : getPipeFittingPorts(node)
    const mated = ports.some((port) => {
      if (source.system && port.system && source.system !== port.system) return false
      const dx = source.position[0] - port.position[0]
      const dy = source.position[1] - port.position[1]
      const dz = source.position[2] - port.position[2]
      return dx * dx + dy * dy + dz * dz <= toleranceSq
    })
    if (mated) ids.push(node.id)
  }
  return ids
}
