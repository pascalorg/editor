import {
  type AnyNode,
  type AnyNodeId,
  DuctFittingNode,
  type DuctSegmentNode,
  PipeFittingNode,
  type PipeSegmentNode,
} from '@pascal-app/core'
import { Euler, Quaternion, Vector3 } from 'three'
import { localFittingPorts } from '../duct-fitting/ports'
import { ductPortDiameterIn } from '../duct-segment/geometry'
import { localPipeFittingPorts } from '../pipe-fitting/ports'
import { accessoryMateQuaternion } from './accessory-placement'
import type { ScenePort } from './ports'

const END_CAP_OWNER_ID_KEY = 'automaticRunEndCapOwnerId'
const END_CAP_ENDPOINT_KEY = 'automaticRunEndCapEndpoint'

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
    metadata: {
      [END_CAP_OWNER_ID_KEY]: duct.id,
      [END_CAP_ENDPOINT_KEY]: endpoint,
    },
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
    metadata: {
      [END_CAP_OWNER_ID_KEY]: pipe.id,
      [END_CAP_ENDPOINT_KEY]: endpoint,
    },
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
  const ids: AnyNodeId[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== fittingKind || node.fittingType !== 'end-cap') continue
    if (node.id === source.nodeId) {
      ids.push(node.id)
      continue
    }
    if (
      node.metadata[END_CAP_OWNER_ID_KEY] === source.nodeId &&
      node.metadata[END_CAP_ENDPOINT_KEY] === source.id
    )
      ids.push(node.id)
  }
  return ids
}

export function planRunEndCapFollowUpdates(
  originalRun: DuctSegmentNode | PipeSegmentNode,
  nextRun: DuctSegmentNode | PipeSegmentNode,
  endpoint: 'start' | 'end',
  nodes: Readonly<Record<string, AnyNode>>,
): { id: AnyNodeId; data: Partial<AnyNode> }[] {
  if (originalRun.type !== nextRun.type) return []
  const originalEnd = runEndpoint(originalRun.path, endpoint)
  if (!originalEnd) return []
  const fittingKind = originalRun.type === 'duct-segment' ? 'duct-fitting' : 'pipe-fitting'
  const source: ScenePort = {
    ...originalEnd,
    id: endpoint,
    nodeId: originalRun.id,
    diameter:
      originalRun.type === 'duct-segment' ? ductPortDiameterIn(originalRun) : originalRun.diameter,
    system: originalRun.system,
  }
  const capIds = findMatedRunEndCapIds(source, nodes, fittingKind)
  if (capIds.length === 0) return []
  const placed =
    nextRun.type === 'duct-segment'
      ? createDuctRunEndCap(nextRun, endpoint)
      : createPipeRunEndCap(nextRun, endpoint)
  if (!placed) return []
  return capIds.map((id) => ({
    id,
    data: { position: placed.position, rotation: placed.rotation } as Partial<AnyNode>,
  }))
}
