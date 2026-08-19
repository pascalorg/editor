import {
  DeviceMotionSampleSchema,
  type DeviceMotionTrajectoryPayload,
  DeviceMotionTrajectorySchema,
} from '@pascal-app/capture-protocol'
import { Matrix4, Quaternion, Vector3 } from 'three'

export type DeviceTrajectoryPose = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  segment: number
  timestamp: number
}

export type DeviceTrajectory = {
  duration: number
  poses: DeviceTrajectoryPose[]
}

export type DeviceTrajectoryFrame = {
  alpha: number
  from: DeviceTrajectoryPose
  to: DeviceTrajectoryPose
}

export function parseDeviceTrajectoryPayload(
  trajectory: DeviceMotionTrajectoryPayload | null | undefined,
): DeviceTrajectory | null {
  if (!trajectory) return null
  const parsed = DeviceMotionTrajectorySchema.safeParse(trajectory)
  if (!parsed.success) return null

  const poses = parsed.data.samples
    .map(parsePose)
    .sort((left, right) => left.timestamp - right.timestamp)
  if (poses.length < 2) return null

  const firstTimestamp = poses[0]?.timestamp ?? 0
  for (const pose of poses) pose.timestamp -= firstTimestamp
  const duration = poses.at(-1)?.timestamp ?? 0
  if (!(duration > 0)) return null
  return { duration, poses }
}

export function parseDeviceTrajectoryPackets(
  payloads: readonly unknown[],
): DeviceTrajectory | null {
  let coordinateSystem = 'source'
  let samples: DeviceMotionTrajectoryPayload['samples'] = []
  for (const payload of payloads) {
    const trajectory = DeviceMotionTrajectorySchema.safeParse(payload)
    if (trajectory.success) {
      coordinateSystem = trajectory.data.coordinateSystem
      samples = [...trajectory.data.samples]
      continue
    }
    const sample = DeviceMotionSampleSchema.safeParse(payload)
    if (sample.success) samples.push(sample.data)
  }
  if (samples.length < 2) return null
  return parseDeviceTrajectoryPayload({ coordinateSystem, samples })
}

export function sampleDeviceTrajectory(
  trajectory: DeviceTrajectory,
  elapsed: number,
): DeviceTrajectoryFrame {
  const time = positiveModulo(elapsed, trajectory.duration)
  const poses = trajectory.poses
  const first = poses[0]
  const last = poses.at(-1)
  if (!(first && last)) throw new Error('Device trajectory requires at least two poses.')
  let upperIndex = poses.findIndex((pose) => pose.timestamp > time)

  if (upperIndex < 0) upperIndex = poses.length - 1
  if (upperIndex === 0) return { alpha: 0, from: first, to: first }

  const from = poses[upperIndex - 1] ?? first
  const to = poses[upperIndex] ?? last
  if (from.segment !== to.segment) return { alpha: 0, from, to: from }

  const interval = to.timestamp - from.timestamp
  return {
    alpha: interval > 0 ? Math.min(1, Math.max(0, (time - from.timestamp) / interval)) : 0,
    from,
    to,
  }
}

function parsePose(value: DeviceMotionTrajectoryPayload['samples'][number]): DeviceTrajectoryPose {
  const matrix = new Matrix4().fromArray(value.transform)
  const position = new Vector3()
  const quaternion = new Quaternion()
  matrix.decompose(position, quaternion, new Vector3())

  return {
    position: [position.x, position.y, position.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    segment: value.segment,
    timestamp: value.timestamp,
  }
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}
