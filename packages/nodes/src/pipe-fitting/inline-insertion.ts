import { PipeFittingNode, PipeSegmentNode } from '@pascal-app/core'
import { Euler, Quaternion, Vector3 } from 'three'
import type { RunBodyHit } from '../shared/ports'
import { pipeFittingLegLength } from './ports'

type Point = [number, number, number]

const MIN_PIPE_STUB_M = 0.05

export type PipeInlineInsertionPlan = {
  fitting: PipeFittingNode
  runUpdate: { id: PipeSegmentNode['id']; data: Partial<PipeSegmentNode> }
  runTail: PipeSegmentNode
}

export function isInlinePipeFitting(node: PipeFittingNode): boolean {
  return (
    node.fittingType === 'coupling' ||
    node.fittingType === 'reducer' ||
    (node.fittingType === 'cleanout' && node.cleanoutStyle === 'inline')
  )
}

function splitWallAttachment(
  run: PipeSegmentNode,
  hit: RunBodyHit,
): {
  head?: PipeSegmentNode['wallAttachment']
  tail?: PipeSegmentNode['wallAttachment']
} {
  const attachment = run.wallAttachment
  if (!attachment) return {}

  let distanceBefore = 0
  let totalDistance = 0
  for (let index = 0; index < run.path.length - 1; index++) {
    const length = new Vector3(...run.path[index + 1]!).distanceTo(new Vector3(...run.path[index]!))
    if (index < hit.segmentIndex) distanceBefore += length
    totalDistance += length
  }
  if (totalDistance < 1e-8) return {}

  const segmentStart = new Vector3(...run.path[hit.segmentIndex]!)
  const hitDistance = segmentStart.distanceTo(new Vector3(...hit.point))
  const ratio = Math.min(1, Math.max(0, (distanceBefore + hitDistance) / totalDistance))
  const splitUV: [number, number] = [
    attachment.startUV[0] + (attachment.endUV[0] - attachment.startUV[0]) * ratio,
    attachment.startUV[1] + (attachment.endUV[1] - attachment.startUV[1]) * ratio,
  ]

  return {
    head: { ...attachment, endUV: splitUV },
    tail: { ...attachment, startUV: splitUV },
  }
}

export function planPipeInlineInsertion(
  run: PipeSegmentNode,
  hit: RunBodyHit,
  template: PipeFittingNode,
): PipeInlineInsertionPlan | null {
  if (!isInlinePipeFitting(template)) return null

  const a = run.path[hit.segmentIndex]
  const b = run.path[hit.segmentIndex + 1]
  if (!a || !b) return null

  const axis = new Vector3(...b).sub(new Vector3(...a))
  if (axis.lengthSq() < 1e-10) return null
  axis.normalize()

  const fitting = PipeFittingNode.parse({
    ...template,
    diameter: run.diameter,
    pipeMaterial: run.pipeMaterial,
    system: run.system,
    position: hit.point,
    rotation: (() => {
      const euler = new Euler().setFromQuaternion(
        new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), axis),
      )
      return [euler.x, euler.y, euler.z] as Point
    })(),
  })

  const legLength = pipeFittingLegLength(
    fitting.fittingType === 'reducer'
      ? Math.max(fitting.diameter, fitting.diameter2)
      : fitting.diameter,
  )
  const center = new Vector3(...hit.point)
  if (
    center.distanceTo(new Vector3(...a)) < legLength + MIN_PIPE_STUB_M ||
    center.distanceTo(new Vector3(...b)) < legLength + MIN_PIPE_STUB_M
  ) {
    return null
  }

  const inlet = center.clone().addScaledVector(axis, -legLength)
  const outlet = center.clone().addScaledVector(axis, legLength)
  const upstreamPath: Point[] = [
    ...run.path.slice(0, hit.segmentIndex + 1).map((point) => [...point] as Point),
    inlet.toArray(),
  ]
  const tailPath: Point[] = [
    outlet.toArray(),
    ...run.path.slice(hit.segmentIndex + 1).map((point) => [...point] as Point),
  ]
  const wallAttachment = splitWallAttachment(run, hit)
  const tailDiameter = fitting.fittingType === 'reducer' ? fitting.diameter2 : run.diameter
  const runTail = PipeSegmentNode.parse({
    ...run,
    id: undefined,
    path: tailPath,
    diameter: tailDiameter,
    ...(wallAttachment.tail ? { wallAttachment: wallAttachment.tail } : {}),
  })

  return {
    fitting,
    runUpdate: {
      id: run.id,
      data: {
        path: upstreamPath,
        ...(wallAttachment.head ? { wallAttachment: wallAttachment.head } : {}),
      },
    },
    runTail,
  }
}
