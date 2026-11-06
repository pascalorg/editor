import { type AnyNode, type AnyNodeId, nodeRegistry, PipeSegmentNode } from '@pascal-app/core'
import type { AgentOperation, SceneChanges } from '@pascal-app/core/agent-operations'
import { refuse } from '@pascal-app/core/agent-tools'
import { Vector3 } from 'three'
import { planPipeElbowAtPort } from '../shared/auto-fitting'
import { autoOffsetInvalidationUpdates } from '../shared/auto-offset-tag'
import { transferRunEndCapOwnership } from '../shared/automatic-run-end-cap'
import { pipeGrade, pipeGradesMatch } from './slope'

export type PipeOffsetInput = { nodeId: string; from: number; to: number; offset: number }
type Point = [number, number, number]

export const offsetPipe: AgentOperation<PipeOffsetInput> = (nodes, input) => {
  const pipe = nodes[input.nodeId]
  if (pipe?.type !== 'pipe-segment') return refuse('pipe_not_found', 'Select a pipe run.')
  if (!nodeRegistry.get('pipe-segment')?.ports || !nodeRegistry.get('pipe-fitting')?.ports)
    return refuse(
      'node_capability_unavailable',
      'Register pipe and fitting definitions before editing.',
    )
  if (pipe.path.length !== 2 || ![input.from, input.to, input.offset].every(Number.isFinite))
    return refuse('pipe_offset_route', 'Choose a straight run and enter finite offset dimensions.')
  if (
    Object.values(nodes).some((node) => node.parentId === pipe.id) ||
    Object.keys(pipe.hangerOverrides ?? {}).length
  )
    return refuse(
      'pipe_offset_attachments',
      'Remove custom hanger adjustments or hosted children before splitting this run.',
    )
  const start = new Vector3(...pipe.path[0]!),
    end = new Vector3(...pipe.path[1]!)
  const delta = end.clone().sub(start)
  const length = Math.hypot(delta.x, delta.z)
  if (length < 0.001 || Math.abs(input.offset) < 0.001)
    return refuse('pipe_offset_route', 'Choose a non-vertical run and a non-zero vertical offset.')
  const axis = delta.clone().divideScalar(length)
  const at = (distance: number) => start.clone().addScaledVector(axis, distance)
  const travel = Math.abs(input.offset)
  const a = at(input.from),
    b = at(input.from + travel).add(new Vector3(0, input.offset, 0))
  const d = at(input.to),
    c = at(input.to - travel).add(new Vector3(0, input.offset, 0))
  const corners = [start, a, b, c, d, end]
  if (input.from <= 0 || input.to >= length || input.to - input.from <= 2 * travel)
    return refuse(
      'pipe_offset_space',
      'Place the bends inside the run and allow more than twice the offset height between the first and last bend.',
    )
  const directions = corners.slice(1).map((point, i) => point.clone().sub(corners[i]!).normalize())
  const elbows = [a, b, c, d].map((corner, i) => {
    const plan = planPipeElbowAtPort(
      {
        id: 'end',
        nodeId: pipe.id,
        position: corner.toArray(),
        direction: directions[i]!.toArray(),
        diameter: pipe.diameter,
        system: pipe.system,
      },
      directions[i + 1]!.toArray(),
      pipe.diameter,
      pipe.pipeMaterial,
    )
    if (!plan)
      return refuse('pipe_offset_angle', 'The requested bends cannot be formed on this route.')
    return plan
  })
  const paths: Point[][] = [
    [start.toArray(), elbows[0]!.trimmedPortPoint],
    [elbows[0]!.collarPoint, elbows[1]!.trimmedPortPoint],
    [elbows[1]!.collarPoint, elbows[2]!.trimmedPortPoint],
    [elbows[2]!.collarPoint, elbows[3]!.trimmedPortPoint],
    [elbows[3]!.collarPoint, end.toArray()],
  ]
  for (const [i, path] of paths.entries()) {
    const segment = new Vector3(...path[1]!).sub(new Vector3(...path[0]!))
    if (
      !segment.toArray().every(Number.isFinite) ||
      segment.length() < 0.001 ||
      segment.normalize().dot(directions[i]!) < 0.999999
    )
      return refuse(
        'pipe_offset_space',
        'Not enough straight pipe between the bends. Increase the offset height or spacing, or move the bends away from the endpoints.',
      )
  }
  if ([0, 2, 4].some((i) => !pipeGradesMatch(pipe.path, paths[i]!)))
    return refuse('pipe_offset_grade', 'This offset cannot preserve the existing grade.')
  const { id: _id, ...defaults } = pipe
  const newRuns = paths.slice(1).map((path) =>
    PipeSegmentNode.parse({
      ...defaults,
      metadata: {},
      path,
      wallAttachment: undefined,
      hangerOverrides: undefined,
    }),
  )
  const changes: SceneChanges = {
    update: [
      {
        id: pipe.id,
        data: { path: paths[0], wallAttachment: undefined, hangerOverrides: undefined },
      },
    ],
    create: [
      ...newRuns,
      ...elbows.map((elbow) => ({ ...elbow.fitting, parentId: pipe.parentId })),
    ].map((node) => ({ node, parentId: pipe.parentId ?? undefined })),
  }
  changes.update!.push(...transferRunEndCapOwnership(nodes, pipe.id, newRuns.at(-1)!.id, 'end'))
  for (const entry of autoOffsetInvalidationUpdates({ ...nodes }, pipe.id as AnyNodeId)) {
    const existing = changes.update!.find((update) => update.id === entry.id)
    if (existing) existing.data = { ...existing.data, ...entry.data } as Partial<AnyNode>
    else changes.update!.push(entry)
  }
  const grade = pipeGrade(pipe.path[0]!, pipe.path[1]!)!
  const uphill =
    grade === 0 || paths.some((path) => (path[1]![1] - path[0]![1]) * Math.sign(grade) > 1e-6)
  return {
    changes,
    result: {
      message: 'Four-bend offset; boundary connections and parallel-run grades preserved.',
      paths,
      uphill: pipe.system === 'waste' && uphill,
      offset: input.offset,
      fittings: 4,
      runs: 5,
    },
  }
}
