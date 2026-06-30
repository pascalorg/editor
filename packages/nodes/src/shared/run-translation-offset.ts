import {
  type AnyNode,
  type AnyNodeId,
  DuctSegmentNode,
  type PortConnection,
} from '@pascal-app/core'
import { fittingLegLength } from '../duct-fitting/ports'
import type { DuctFittingNode } from '../duct-fitting/schema'
import {
  type DuctProfile,
  planElbowAtPort,
  planElbowRealign,
  profileDiameterIn,
} from './auto-fitting'
import type { ScenePort } from './ports'

type Point = [number, number, number]

const COINCIDENT_EPS_M = 0.05
const MIN_CONNECTOR_M = 0.05

export type RunTranslationOffsetPlan = {
  ductPath: Point[]
  fittings: DuctFittingNode[]
  connectors: DuctSegmentNode[]
  updates: { id: AnyNodeId; data: Partial<AnyNode> }[]
}

function distSq(a: Point | readonly number[], b: Point | readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function neg(v: Point): Point {
  return [-v[0], -v[1], -v[2]]
}

function unit(v: Point): Point | null {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len < 1e-9) return null
  return [v[0] / len, v[1] / len, v[2] / len]
}

function endpointOutwardDir(path: ReadonlyArray<readonly number[]>, idx: number): Point {
  const last = path.length - 1
  const [a, b] = idx === 0 ? [path[0]!, path[1]!] : [path[last]!, path[last - 1]!]
  return unit([a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]) ?? [1, 0, 0]
}

function portLike(position: Point, direction: Point, system: string): ScenePort {
  return {
    id: 'x',
    nodeId: 'x' as AnyNodeId,
    position,
    direction,
    diameter: 0,
    system,
  } as unknown as ScenePort
}

function connectorRun(from: Point, to: Point, duct: DuctSegmentNode): DuctSegmentNode {
  return DuctSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: duct.name ?? 'Duct run',
    path: [from, to],
    shape: duct.shape,
    diameter: duct.diameter,
    width: duct.width,
    height: duct.height,
    roll: duct.roll,
    ductMaterial: duct.ductMaterial,
    insulated: duct.insulated,
    insulationR: duct.insulationR,
    system: duct.system,
  })
}

function elbowProfilePatch(profile: DuctProfile): Partial<DuctFittingNode> {
  const diameter = profileDiameterIn(profile)
  return {
    shape: profile.shape,
    width: profile.width,
    height: profile.height,
    diameter,
    diameter2: diameter,
  }
}

export function planRunTranslationOffsets(args: {
  duct: DuctSegmentNode
  translatedPath: Point[]
  profile: DuctProfile
  connections: PortConnection[]
  scenePorts: ScenePort[]
  nodesById: Record<string, AnyNode>
}): RunTranslationOffsetPlan | null {
  const { duct, translatedPath, profile, connections, scenePorts, nodesById } = args
  if (duct.path.length < 2 || translatedPath.length !== duct.path.length) return null
  if (connections.length === 0) return null

  const leg = fittingLegLength(profileDiameterIn(profile))
  const minOffset = 2 * leg + MIN_CONNECTOR_M
  const eps2 = COINCIDENT_EPS_M * COINCIDENT_EPS_M
  const ductPath = translatedPath.map((p) => [...p] as Point)
  const fittings: DuctFittingNode[] = []
  const connectors: DuctSegmentNode[] = []
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  let routedAny = false

  for (const endIdx of duct.path.length > 1 ? [0, duct.path.length - 1] : [0]) {
    const startEnd = duct.path[endIdx]!
    const movedEnd = translatedPath[endIdx]!
    const delta = sub(movedEnd, startEnd)
    const offsetDir = unit(delta)
    if (!offsetDir || Math.hypot(delta[0], delta[1], delta[2]) < minOffset) continue

    const partnerPort = scenePorts.find(
      (sp) =>
        distSq(sp.position, startEnd) <= eps2 &&
        connections.some((conn) => conn.nodeId === sp.nodeId),
    )
    if (!partnerPort) continue
    const conn = connections.find((c) => c.nodeId === partnerPort.nodeId)
    if (!conn) continue

    const ductPortDir = endpointOutwardDir(translatedPath, endIdx)
    const top = planElbowAtPort(
      portLike(movedEnd, ductPortDir, duct.system),
      neg(offsetDir),
      profile,
    )
    if (!top) return null

    if (conn.kind === 'run') {
      const bottom = planElbowAtPort(
        portLike(
          [startEnd[0], startEnd[1], startEnd[2]],
          [partnerPort.direction[0], partnerPort.direction[1], partnerPort.direction[2]],
          duct.system,
        ),
        offsetDir,
        profile,
      )
      if (!bottom) return null
      fittings.push(bottom.fitting, top.fitting)
      connectors.push(connectorRun(bottom.collarPoint, top.collarPoint, duct))
      ductPath[endIdx] = top.trimmedPortPoint

      const path = conn.startPath.map((p) => [...p] as Point)
      const tip = path.findIndex((p) => distSq(p, startEnd) <= eps2)
      if (tip !== -1) {
        path[tip] = bottom.trimmedPortPoint
        updates.push({ id: conn.nodeId, data: { path } as Partial<AnyNode> })
      }
      routedAny = true
      continue
    }

    const partner = nodesById[conn.nodeId]
    if (partner?.type !== 'duct-fitting') return null
    const elbow = {
      ...(partner as DuctFittingNode),
      ...elbowProfilePatch(profile),
    } as DuctFittingNode
    if (elbow.fittingType !== 'elbow') return null
    const realign = planElbowRealign(elbow, partnerPort.id, offsetDir)
    if (!realign) return null

    fittings.push(top.fitting)
    connectors.push(connectorRun(realign.collarPoint, top.collarPoint, duct))
    ductPath[endIdx] = top.trimmedPortPoint
    updates.push({
      id: elbow.id,
      data: { ...elbowProfilePatch(profile), ...realign.update.data } as Partial<AnyNode>,
    })
    routedAny = true
  }

  if (!routedAny) return null
  return { ductPath, fittings, connectors, updates }
}
