import {
  type AnyNode,
  type AnyNodeId,
  DuctFittingNode,
  DuctSegmentNode,
  nodeRegistry,
} from '@pascal-app/core'
import type { AgentOperation, SceneChanges, SceneNodes } from '@pascal-app/core/agent-operations'
import { refuse } from '@pascal-app/core/agent-tools'
import type { ScenePort } from '@pascal-app/editor/distribution'
import { Vector3 } from 'three'
import { fittingLegLength, getDuctFittingPorts } from '../duct-fitting/ports'
import { type DuctProfile, planElbowAtPort, profileDiameterIn } from '../shared/auto-fitting'
import { autoOffsetInvalidationUpdates } from '../shared/auto-offset-tag'
import { transferRunEndCapOwnership } from '../shared/automatic-run-end-cap'
import { ductProfilesMatch, planDuctAdapter } from '../shared/duct-adapter'
import { rectSectionAxes, rollToContinueAcrossElbow } from './profile'

type Point = [number, number, number]
export type DuctEditInput = {
  nodeId: string
  action: 'resize' | 'offset'
  scope?: 'segment' | 'branch'
  alignment?: 'center' | 'top' | 'bottom' | 'left' | 'right'
  shape?: 'round' | 'rect' | 'oval'
  diameter?: number
  width?: number
  height?: number
  offset?: number
  from?: number
  to?: number
}

function portsOf(node: AnyNode): ScenePort[] {
  const definition = nodeRegistry.get(node.type)
  if (!definition?.ports) return []
  return definition.ports(node).map((port) => ({ ...port, nodeId: node.id }))
}
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
function mates(port: ScenePort, ports: ScenePort[]): ScenePort[] {
  return ports.filter(
    (other) =>
      other.nodeId !== port.nodeId &&
      other.system === port.system &&
      distance(port.position, other.position) < 0.005 &&
      new Vector3(...port.direction).dot(new Vector3(...other.direction)) < -0.99,
  )
}
function profileOf(node: AnyNode, port: ScenePort): DuctProfile {
  if (node.type === 'duct-segment') return node
  return {
    shape: port.shape ?? 'round',
    diameter: port.diameter,
    width: port.width ?? port.diameter,
    height: port.height ?? port.diameter,
  }
}
function validPaths(before: SceneNodes, changes: SceneChanges) {
  for (const entry of changes.update ?? []) {
    const old = before[entry.id]
    if (old?.type !== 'duct-segment' || !('path' in entry.data) || !entry.data.path) continue
    const path = entry.data.path as Point[]
    for (let i = 1; i < path.length; i++) {
      const original = new Vector3(...old.path[i]!).sub(new Vector3(...old.path[i - 1]!))
      const next = new Vector3(...path[i]!).sub(new Vector3(...path[i - 1]!))
      if (next.length() < 0.08 || next.dot(original) <= 0)
        refuse(
          'duct_clearance',
          'Not enough straight duct for the fittings. Use a longer run or a smaller size change.',
        )
    }
  }
}

/** One plan is used by the inspector and agent hosts; neither writes a partial network. */
export const editDuct: AgentOperation<DuctEditInput> = (before, input) => {
  const duct = before[input.nodeId]
  if (duct?.type !== 'duct-segment') return refuse('duct_not_found', 'Select a duct run.')
  if (!nodeRegistry.get('duct-segment')?.ports)
    return refuse('node_capability_unavailable', 'Register duct node definitions before editing.')
  const changes: SceneChanges = { create: [], update: [] }
  if (input.action === 'offset') {
    const { offset = 0, from = 0, to = 0 } = input
    if (
      ![offset, from, to].every(Number.isFinite) ||
      duct.path.length !== 2 ||
      Math.abs(duct.path[0]![1] - duct.path[1]![1]) > 0.001
    )
      return refuse('duct_offset_route', 'Choose a straight horizontal run for an obstacle offset.')
    const start = new Vector3(...duct.path[0]!)
    const end = new Vector3(...duct.path[1]!)
    const axis = end.clone().sub(start).normalize()
    const length = start.distanceTo(end)
    const leg = fittingLegLength(profileDiameterIn(duct))
    if (
      from < leg + 0.08 ||
      to > length - leg - 0.08 ||
      to - from < 2 * leg + 0.08 ||
      Math.abs(offset) < 2 * leg + 0.08
    )
      return refuse(
        'duct_offset_clearance',
        `Allow ${(2 * leg + 0.08).toFixed(2)} m for the rise and offset span, and ${(leg + 0.08).toFixed(2)} m at each end.`,
      )
    const up = new Vector3(0, Math.sign(offset), 0)
    const a = start.clone().addScaledVector(axis, from)
    const b = a.clone().add(new Vector3(0, offset, 0))
    const d = start.clone().addScaledVector(axis, to)
    const c = d.clone().add(new Vector3(0, offset, 0))
    const corners = [a, b, c, d]
    const incoming = [axis, up, axis, up.clone().negate()]
    const outgoing = [up, axis, up.clone().negate(), axis]
    const elbows = corners.map(
      (corner, i) =>
        planElbowAtPort(
          {
            id: 'end',
            nodeId: duct.id,
            position: corner.toArray(),
            direction: incoming[i]!.toArray(),
            diameter: profileDiameterIn(duct),
            system: duct.system,
          },
          outgoing[i]!.toArray(),
          duct,
        )!,
    )
    const paths: Point[][] = [
      [start.toArray(), elbows[0]!.trimmedPortPoint],
      [elbows[0]!.collarPoint, elbows[1]!.trimmedPortPoint],
      [elbows[1]!.collarPoint, elbows[2]!.trimmedPortPoint],
      [elbows[2]!.collarPoint, elbows[3]!.trimmedPortPoint],
      [elbows[3]!.collarPoint, end.toArray()],
    ]
    // Rolled rectangular sections require a twist, which the elbow schema cannot express.
    if (duct.shape !== 'round' && Math.abs(duct.roll) > 0.001)
      return refuse('duct_offset_roll', 'Reset the section roll before adding an obstacle offset.')
    changes.update!.push({ id: duct.id, data: { path: paths[0] } })
    const { id: _id, ...defaults } = duct
    for (const path of paths.slice(1))
      changes.create!.push({
        node: DuctSegmentNode.parse({
          ...defaults,
          metadata: {},
          path,
          roll:
            duct.shape === 'round'
              ? 0
              : rollToContinueAcrossElbow(
                  axis,
                  duct.roll,
                  axis,
                  new Vector3(...path[1]!).sub(new Vector3(...path[0]!)).normalize(),
                ),
        }),
        parentId: duct.parentId ?? undefined,
      })
    const tail = changes.create!.at(-1)!.node
    changes.update!.push(...transferRunEndCapOwnership(before, duct.id, tail.id, 'end'))
    for (const elbow of elbows)
      changes.create!.push({ node: elbow.fitting, parentId: duct.parentId ?? undefined })
  } else {
    const targetResult = DuctSegmentNode.safeParse({
      ...duct,
      shape: input.shape ?? duct.shape,
      diameter: input.diameter ?? duct.diameter,
      width: input.width ?? duct.width,
      height: input.height ?? duct.height,
    })
    if (!targetResult.success)
      return refuse(
        'duct_profile_invalid',
        'Enter duct dimensions within the supported profile range.',
      )
    const target = targetResult.data
    if (ductProfilesMatch(duct, target))
      return { result: { message: 'The duct already has this profile.', affected: [] }, changes }
    const levelNodes = Object.values(before).filter((node) => node.parentId === duct.parentId)
    const ports = levelNodes.flatMap(portsOf)
    const selected = new Set<string>([duct.id])
    for (const port of ports.filter((p) => p.nodeId === duct.id)) {
      for (const mate of mates(port, ports)) {
        const owner = before[mate.nodeId]
        if (owner?.type === 'duct-fitting' && owner.fittingType === 'end-cap')
          selected.add(owner.id)
      }
    }
    const queue: AnyNode[] = [duct]
    if (input.scope === 'branch') {
      while (queue.length) {
        const current = queue.shift()!
        for (const port of ports.filter((p) => p.nodeId === current.id)) {
          for (const mate of mates(port, ports)) {
            const owner = before[mate.nodeId]!
            const traversable =
              owner.type === 'duct-segment' ||
              (owner.type === 'duct-fitting' &&
                ['elbow', 'coupling', 'damper', 'end-cap'].includes(owner.fittingType) &&
                ports
                  .filter((p) => p.nodeId === owner.id)
                  .every((p) =>
                    mates(p, ports).every((m) => before[m.nodeId]?.type === 'duct-segment'),
                  ))
            if (
              !selected.has(owner.id) &&
              traversable &&
              owner.system === duct.system &&
              ductProfilesMatch(profileOf(owner, mate), duct)
            ) {
              selected.add(owner.id)
              queue.push(owner)
            }
          }
        }
      }
    }
    const alignment = input.alignment ?? 'center'
    const connected = ports.some(
      (port) =>
        port.nodeId === duct.id &&
        mates(port, ports).some(
          (mate) =>
            !selected.has(mate.nodeId) ||
            before[mate.nodeId]?.type !== 'duct-fitting' ||
            (before[mate.nodeId] as DuctFittingNode).fittingType !== 'end-cap',
        ),
    )
    if (alignment !== 'center' && (connected || duct.path.length !== 2))
      return refuse(
        'duct_alignment_anchored',
        'Face alignment requires a free straight run. Use center alignment to keep connected collars fixed.',
      )
    const updated = new Map<string, AnyNode>()
    for (const id of selected) {
      const node = before[id]!
      if (node.type === 'duct-segment') {
        let path = node.path.map((p) => [...p] as Point)
        if (alignment !== 'center') {
          const axes = rectSectionAxes(
            new Vector3(...path[1]!).sub(new Vector3(...path[0]!)).normalize(),
            node.roll,
          )
          if (axes.height.y < 0) axes.height.negate()
          const side = alignment === 'left' || alignment === 'right'
          const dimension = (p: DuctProfile) =>
            p.shape === 'round' ? p.diameter : side ? p.width : p.height
          const sign = alignment === 'top' || alignment === 'right' ? 1 : -1
          const delta = (side ? axes.width : axes.height)
            .clone()
            .multiplyScalar((sign * (dimension(node) - dimension(target)) * 0.0254) / 2)
          path = path.map((p) => new Vector3(...p).add(delta).toArray())
        }
        updated.set(id, {
          ...node,
          shape: target.shape,
          diameter: target.diameter,
          width: target.width,
          height: target.height,
          path,
          ductMaterial:
            node.ductMaterial === 'spiral' && target.shape !== 'round'
              ? 'sheet-metal'
              : node.ductMaterial,
        })
      } else if (node.type === 'duct-fitting') {
        updated.set(
          id,
          DuctFittingNode.parse({
            ...node,
            shape: target.shape,
            diameter: profileDiameterIn(target),
            diameter2: profileDiameterIn(target),
            width: target.width,
            height: target.height,
          }),
        )
      }
    }
    if (alignment !== 'center') {
      const resized = updated.get(duct.id) as DuctSegmentNode
      const delta = new Vector3(...resized.path[0]!).sub(new Vector3(...duct.path[0]!))
      for (const id of selected) {
        const cap = updated.get(id)
        if (cap?.type === 'duct-fitting' && cap.fittingType === 'end-cap')
          cap.position = new Vector3(...cap.position).add(delta).toArray()
      }
    }
    for (const id of selected) {
      const node = updated.get(id)!
      if (node.type !== 'duct-segment') continue
      for (const port of ports.filter((p) => p.nodeId === id)) {
        const matches = mates(port, ports)
        if (matches.length > 1)
          return refuse(
            'duct_connection_ambiguous',
            'More than one collar shares an endpoint. Resolve the connection before resizing.',
          )
        const mate = matches[0]
        if (!mate) continue
        const owner = before[mate.nodeId]!
        let point: Point = [...port.position]
        if (selected.has(owner.id)) {
          const changed = updated.get(owner.id)!
          if (changed.type === 'duct-fitting')
            point = [...getDuctFittingPorts(changed).find((p) => p.id === mate.id)!.position]
        } else {
          const adapter = planDuctAdapter(mate, profileOf(owner, mate), target)
          if (adapter) {
            changes.create!.push({ node: adapter.fitting, parentId: duct.parentId ?? undefined })
            point = adapter.collarPoint
          }
        }
        node.path[port.id === 'start' ? 0 : node.path.length - 1] = point
      }
    }
    for (const [id, node] of updated) changes.update!.push({ id, data: node })
    validPaths(before, changes)
  }
  const touched = changes.update!.map((entry) => entry.id as AnyNodeId)
  const invalidations = touched.flatMap((id) => autoOffsetInvalidationUpdates({ ...before }, id))
  for (const entry of invalidations) {
    const existing = changes.update!.find((update) => update.id === entry.id)
    if (existing) existing.data = { ...existing.data, ...entry.data } as Partial<AnyNode>
    else changes.update!.push(entry)
  }
  return {
    result: {
      message:
        input.action === 'offset'
          ? 'Offset with four elbows; original end connections stay fixed. Check obstacle clearance before applying.'
          : 'Ducts resized; boundary collars stay fixed with transitions where needed.',
      affected: changes.update!.map((entry) => entry.id),
      created: changes.create!.length,
    },
    changes,
  }
}
