import {
  AnimationClip,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import { motionValueAtTime } from './motion'
import type { ArticraftAssetNode } from './schema'
import type { ArticraftJoint } from './types'

const JOINT_TARGET_KEY = '__articraftJointTarget'
const MOTION_DURATION_SECONDS = (Math.PI * 2) / 1.4
const MOTION_SAMPLES = 32

type JointTargetMarker = {
  basePosition: [number, number, number]
  baseQuaternion: [number, number, number, number]
  name: string
}

export function markArticraftJointTarget(target: Object3D, name: string): void {
  target.userData[JOINT_TARGET_KEY] = {
    basePosition: target.position.toArray(),
    baseQuaternion: target.quaternion.toArray(),
    name,
  } satisfies JointTargetMarker
}

export function bakeArticraftAnimation(
  node: ArticraftAssetNode,
  object: Object3D,
): AnimationClip | null {
  const targets = jointTargets(object)
  const tracks = [] as Array<QuaternionKeyframeTrack | VectorKeyframeTrack>
  const times = Array.from(
    { length: MOTION_SAMPLES + 1 },
    (_, step) => (step / MOTION_SAMPLES) * MOTION_DURATION_SECONDS,
  )
  let motionIndex = 0

  for (const joint of node.joints) {
    if (joint.type === 'fixed') continue
    const entry = targets.get(joint.name)
    if (!entry) {
      motionIndex += 1
      continue
    }

    entry.target.name = `${node.id}__articraft_joint_${motionIndex}_${safeName(joint.name)}`
    if (joint.type === 'prismatic') {
      const values = times.flatMap((time) =>
        jointPose(entry.marker, joint, motionValueAtTime(joint, motionIndex, time)).position.toArray(),
      )
      tracks.push(new VectorKeyframeTrack(`${entry.target.uuid}.position`, times, values))
    } else {
      const values = times.flatMap((time) =>
        jointPose(entry.marker, joint, motionValueAtTime(joint, motionIndex, time)).quaternion.toArray(),
      )
      tracks.push(new QuaternionKeyframeTrack(`${entry.target.uuid}.quaternion`, times, values))
    }

    applyJointPose(entry.target, entry.marker, joint, node.jointValues[joint.name] ?? 0)
    motionIndex += 1
  }

  if (tracks.length === 0) return null
  const clip = new AnimationClip(`${node.id}: loop`, MOTION_DURATION_SECONDS, tracks)
  clip.userData = { loop: true }
  return clip
}

function jointTargets(
  root: Object3D,
): Map<string, { marker: JointTargetMarker; target: Object3D }> {
  const targets = new Map<string, { marker: JointTargetMarker; target: Object3D }>()
  root.traverse((target) => {
    const marker = target.userData[JOINT_TARGET_KEY] as JointTargetMarker | undefined
    if (marker) targets.set(marker.name, { marker, target })
  })
  return targets
}

function applyJointPose(
  target: Object3D,
  marker: JointTargetMarker,
  joint: ArticraftJoint,
  value: number,
): void {
  const pose = jointPose(marker, joint, value)
  target.position.copy(pose.position)
  target.quaternion.copy(pose.quaternion)
}

function jointPose(
  marker: JointTargetMarker,
  joint: ArticraftJoint,
  value: number,
): { position: Vector3; quaternion: Quaternion } {
  const position = new Vector3().fromArray(marker.basePosition)
  const quaternion = new Quaternion().fromArray(marker.baseQuaternion)
  const axis = new Vector3(...joint.axis).normalize()

  if (joint.type === 'prismatic') {
    position.add(axis.applyQuaternion(quaternion).multiplyScalar(value))
  } else if (joint.type !== 'fixed') {
    quaternion.multiply(new Quaternion().setFromAxisAngle(axis, value))
  }

  return { position, quaternion }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_')
}
