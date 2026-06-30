import {
  type AnyNode,
  type AnyNodeId,
  PipeSegmentNode,
  type PortConnection,
} from '@pascal-app/core'
import { pipeFittingLegLength } from '../pipe-fitting/ports'
import type { PipeFittingNode } from '../pipe-fitting/schema'
import { planPipeElbowAtPort, planPipeElbowRealign } from './auto-fitting'
import type { ScenePort } from './ports'

type Point = [number, number, number]
type PipeProfile = {
  diameter: number
  pipeMaterial: PipeFittingNode['pipeMaterial']
}

const COINCIDENT_EPS_M = 0.05
const MIN_CONNECTOR_M = 0.05

export type PipeRunTranslationOffsetPlan = {
  pipePath: Point[]
  fittings: PipeFittingNode[]
  connectors: PipeSegmentNode[]
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

function connectorRun(from: Point, to: Point, pipe: PipeSegmentNode): PipeSegmentNode {
  return PipeSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: pipe.name ?? 'Pipe run',
    path: [from, to],
    diameter: pipe.diameter,
    pipeMaterial: pipe.pipeMaterial,
    system: pipe.system,
  })
}

function pipeElbowProfilePatch(profile: PipeProfile): Partial<PipeFittingNode> {
  return {
    diameter: profile.diameter,
    diameter2: profile.diameter,
    pipeMaterial: profile.pipeMaterial,
  }
}

export function planPipeRunTranslationOffsets(args: {
  pipe: PipeSegmentNode
  translatedPath: Point[]
  profile: PipeProfile
  connections: PortConnection[]
  scenePorts: ScenePort[]
  nodesById: Record<string, AnyNode>
}): PipeRunTranslationOffsetPlan | null {
  const { pipe, translatedPath, profile, connections, scenePorts, nodesById } = args
  if (pipe.path.length < 2 || translatedPath.length !== pipe.path.length) return null
  if (connections.length === 0) return null

  const leg = pipeFittingLegLength(profile.diameter)
  const minOffset = 2 * leg + MIN_CONNECTOR_M
  const eps2 = COINCIDENT_EPS_M * COINCIDENT_EPS_M
  const pipePath = translatedPath.map((p) => [...p] as Point)
  const fittings: PipeFittingNode[] = []
  const connectors: PipeSegmentNode[] = []
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  let routedAny = false

  for (const endIdx of pipe.path.length > 1 ? [0, pipe.path.length - 1] : [0]) {
    const startEnd = pipe.path[endIdx]!
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

    const pipePortDir = endpointOutwardDir(translatedPath, endIdx)
    const top = planPipeElbowAtPort(
      portLike(movedEnd, pipePortDir, pipe.system),
      neg(offsetDir),
      profile.diameter,
      profile.pipeMaterial,
    )
    if (!top) return null

    if (conn.kind === 'run') {
      const bottom = planPipeElbowAtPort(
        portLike(
          [startEnd[0], startEnd[1], startEnd[2]],
          [partnerPort.direction[0], partnerPort.direction[1], partnerPort.direction[2]],
          pipe.system,
        ),
        offsetDir,
        profile.diameter,
        profile.pipeMaterial,
      )
      if (!bottom) return null
      fittings.push(bottom.fitting, top.fitting)
      connectors.push(connectorRun(bottom.collarPoint, top.collarPoint, pipe))
      pipePath[endIdx] = top.trimmedPortPoint

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
    if (partner?.type !== 'pipe-fitting') return null
    const elbow = {
      ...(partner as PipeFittingNode),
      ...pipeElbowProfilePatch(profile),
    } as PipeFittingNode
    if (elbow.fittingType !== 'elbow') return null
    const realign = planPipeElbowRealign(elbow, partnerPort.id, offsetDir)
    if (!realign) return null

    fittings.push(top.fitting)
    connectors.push(connectorRun(realign.collarPoint, top.collarPoint, pipe))
    pipePath[endIdx] = top.trimmedPortPoint
    updates.push({
      id: elbow.id,
      data: { ...pipeElbowProfilePatch(profile), ...realign.update.data } as Partial<AnyNode>,
    })
    routedAny = true
  }

  if (!routedAny) return null
  return { pipePath, fittings, connectors, updates }
}
