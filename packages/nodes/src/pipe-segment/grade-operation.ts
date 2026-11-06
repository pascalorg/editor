import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  nodeRegistry,
  type PipeSegmentNode,
  resolveConnectivityUpdates,
} from '@pascal-app/core'
import type { AgentOperation } from '@pascal-app/core/agent-operations'
import { refuse } from '@pascal-app/core/agent-tools'
import { planRunEndCapFollowUpdates } from '../shared/automatic-run-end-cap'
import { applyPipeGrade, pipeGradesMatch, preservePipeGrades } from './slope'

type Point = [number, number, number]
export type PipeGradeInput = {
  nodeId: string
  action: 'grade' | 'endpoint' | 'elevation'
  gradePercent?: number
  flow?: 'forward' | 'reverse'
  anchor?: 'start' | 'end'
  pointIndex?: number
  point?: Point
  elevation?: number
  detach?: boolean
}

/** Refuse a connected edit that would silently regrade another run. */
export function pipeUpdatesPreserveGrades(
  nodes: Readonly<Record<string, AnyNode>>,
  updates: { id: string; data: Partial<AnyNode> }[],
  exceptId?: string,
): boolean {
  return updates.every((update) => {
    const node = nodes[update.id]
    return (
      update.id === exceptId ||
      node?.type !== 'pipe-segment' ||
      !('path' in update.data) ||
      !update.data.path ||
      pipeGradesMatch(node.path, update.data.path as Point[])
    )
  })
}

export const editPipeGrade: AgentOperation<PipeGradeInput> = (nodes, input) => {
  const pipe = nodes[input.nodeId]
  if (pipe?.type !== 'pipe-segment') return refuse('pipe_not_found', 'Select a pipe run.')
  if (!nodeRegistry.get('pipe-segment')?.ports)
    return refuse('node_capability_unavailable', 'Register pipe node definitions before editing.')
  let path: Point[] = pipe.path.map((p) => [...p])
  if (input.action === 'grade') {
    const grade = input.gradePercent
    if (grade === undefined || !Number.isFinite(grade) || grade < 0)
      return refuse('pipe_grade_invalid', 'Enter a finite, non-negative grade percentage.')
    const signed = (grade / 100) * (input.flow === 'reverse' ? -1 : 1)
    for (let i = 1; i < path.length; i++) {
      const previous = pipe.path[i - 1]!
      const current = pipe.path[i]!
      // Vertical legs keep their height; grades describe horizontal travel only.
      path[i] =
        Math.hypot(current[0] - previous[0], current[2] - previous[2]) < 1e-6
          ? [current[0], path[i - 1]![1] + current[1] - previous[1], current[2]]
          : applyPipeGrade(path[i - 1]!, current, signed)
    }
    if (input.anchor === 'end') {
      const dy = pipe.path.at(-1)![1] - path.at(-1)![1]
      path = path.map((p) => [p[0], p[1] + dy, p[2]])
    }
  } else if (input.action === 'elevation') {
    if (input.elevation === undefined || !Number.isFinite(input.elevation))
      return refuse('pipe_elevation_invalid', 'Enter a finite elevation above the level.')
    const index = input.anchor === 'end' ? path.length - 1 : 0
    const dy = input.elevation - path[index]![1]
    path = path.map((p) => [p[0], p[1] + dy, p[2]])
  } else {
    const index = input.pointIndex
    if (
      index === undefined ||
      !Number.isInteger(index) ||
      !path[index] ||
      !input.point ||
      input.point.some((v) => !Number.isFinite(v))
    )
      return refuse('pipe_endpoint_invalid', 'Choose a valid path point and finite coordinates.')
    path[index] = input.point
    const constrained = preservePipeGrades(pipe.path, path, index)
    if (!constrained)
      return refuse(
        'pipe_grade_conflict',
        'This edit collapses a run or tilts a vertical stack. Move the whole stack instead.',
      )
    path = constrained
  }
  const detached = input.action === 'endpoint' && input.detach === true
  const next: PipeSegmentNode = { ...pipe, path, wallAttachment: undefined }
  const connectivity = analyzePortConnectivity(pipe, { ...nodes })
  for (const endpoint of ['start', 'end'] as const) {
    if (detached) continue
    const mates = connectivity.adjacency[pipe.id]?.[endpoint] ?? []
    if (
      !mates.some((mate) => {
        const owner = nodes[mate.nodeId]
        return owner?.type !== 'pipe-fitting' || owner.fittingType !== 'end-cap'
      })
    )
      continue
    const index = endpoint === 'start' ? 0 : path.length - 1
    const neighbor = endpoint === 'start' ? 1 : path.length - 2
    const oldDirection = pipe.path[index]!.map((v, i) => v - pipe.path[neighbor]![i]!)
    const newDirection = path[index]!.map((v, i) => v - path[neighbor]![i]!)
    const oldLength = Math.hypot(...oldDirection),
      newLength = Math.hypot(...newDirection)
    const dot =
      oldDirection.reduce((sum, v, i) => sum + v * newDirection[i]!, 0) / (oldLength * newLength)
    if (!Number.isFinite(dot) || dot < 0.999999)
      return refuse(
        'pipe_connection_angle',
        'This would turn a connected collar. Adjust the fitting or detach the run before changing its direction or grade.',
      )
  }
  const follow = !detached && connectivity ? resolveConnectivityUpdates(connectivity, next) : []
  const caps = detached
    ? []
    : (['start', 'end'] as const).flatMap((end) =>
        planRunEndCapFollowUpdates(pipe, next, end, { ...nodes }),
      )
  const capIds = new Set(caps.map((cap) => cap.id))
  const update = [
    { id: pipe.id as AnyNodeId, data: { path, wallAttachment: undefined } as Partial<AnyNode> },
    ...follow.filter((entry) => !capIds.has(entry.id)),
    ...caps,
  ]
  if (!pipeUpdatesPreserveGrades(nodes, update, pipe.id))
    return refuse(
      'pipe_connected_grade',
      'This would change a connected pipe’s grade. Adjust the connected route explicitly first.',
    )
  if (
    update.some((entry) => {
      const owner = nodes[entry.id]
      return (
        owner &&
        owner.id !== pipe.id &&
        owner.type !== 'pipe-segment' &&
        owner.type !== 'pipe-fitting'
      )
    })
  )
    return refuse(
      'pipe_fixed_connection',
      'This edit would move a fixture or equipment connection. Keep that endpoint fixed.',
    )
  return {
    result: {
      message: 'Pipe elevations updated; grades preserved on connected runs.',
      startElevation: path[0]![1],
      endElevation: path.at(-1)![1],
    },
    changes: { update },
  }
}
