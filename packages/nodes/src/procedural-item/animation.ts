import {
  type EvaluatedMotion,
  evaluateRecipe,
  finitePoseFraction,
  motionTimeline,
  type ProceduralItemNode,
} from '@pascal-app/core/procedural-items'
import * as THREE from 'three'

export function poseProceduralMotionsAtRest(
  node: ProceduralItemNode,
  object: THREE.Object3D,
): void {
  for (const motion of evaluateRecipe(node.recipe, node.parameters).motions) {
    const group = object.getObjectByName(`${node.id}__motion__${motion.id}`)
    if (!group) continue
    group.position.set(...motion.pivot)
    group.quaternion.identity()
  }
}

function axisVector(motion: EvaluatedMotion): THREE.Vector3 {
  return new THREE.Vector3(
    Number(motion.axis === 'x'),
    Number(motion.axis === 'y'),
    Number(motion.axis === 'z'),
  )
}

export function bakeProceduralAnimationClips(
  node: ProceduralItemNode,
  object: THREE.Object3D,
): THREE.AnimationClip[] {
  const evaluation = evaluateRecipe(node.recipe, node.parameters)
  const { T, perPart } = motionTimeline(evaluation)
  poseProceduralMotionsAtRest(node, object)
  const clips: THREE.AnimationClip[] = []
  const finiteByPart = new Map<string, EvaluatedMotion[]>()
  const spinByPartAndPeriod = new Map<string, EvaluatedMotion[]>()
  for (const motion of evaluation.motions) {
    const group = object.getObjectByName(`${node.id}__motion__${motion.id}`)
    if (!group) continue
    if (motion.kind === 'spin') {
      const key = `${motion.partId}:${Math.abs(motion.amount)}`
      spinByPartAndPeriod.set(key, [...(spinByPartAndPeriod.get(key) ?? []), motion])
    } else finiteByPart.set(motion.partId, [...(finiteByPart.get(motion.partId) ?? []), motion])
  }
  for (const [partId, motions] of finiteByPart) {
    const tracks: THREE.KeyframeTrack[] = []
    const clipName = `${node.id}:${partId}: open`
    for (const motion of motions) {
      const group = object.getObjectByName(`${node.id}__motion__${motion.id}`)!
      const start = motion.delay
      const times = [
        ...new Set([
          0,
          ...Array.from({ length: 33 }, (_, i) => start + (motion.duration * i) / 32),
          T,
        ]),
      ].sort((a, b) => a - b)
      const values = times.flatMap((time) => {
        const fraction = finitePoseFraction(motion, time)
        if (motion.kind === 'slide')
          return new THREE.Vector3(...motion.pivot)
            .addScaledVector(axisVector(motion), motion.amount * fraction)
            .toArray()
        return new THREE.Quaternion()
          .setFromAxisAngle(axisVector(motion), motion.amount * fraction)
          .toArray()
      })
      tracks.push(
        motion.kind === 'slide'
          ? new THREE.VectorKeyframeTrack(`${group.uuid}.position`, times, values)
          : new THREE.QuaternionKeyframeTrack(`${group.uuid}.quaternion`, times, values),
      )
      group.userData.proceduralMotion = {
        ...group.userData.proceduralMotion,
        clip: clipName,
        activeWindow: [perPart[partId]!.A, perPart[partId]!.B],
      }
    }
    const clip = new THREE.AnimationClip(clipName, T, tracks)
    clip.userData = { loop: false }
    clips.push(clip)
  }
  const spinCounts = new Map<string, number>()
  for (const motions of spinByPartAndPeriod.values()) {
    const partId = motions[0]!.partId
    const ordinal = spinCounts.get(partId) ?? 0
    spinCounts.set(partId, ordinal + 1)
    const clipName = `${node.id}:${partId}${ordinal ? `:${ordinal}` : ''}: loop`
    const duration = (2 * Math.PI) / Math.abs(motions[0]!.amount)
    const times = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * duration)
    const tracks = motions.map((motion) => {
      const group = object.getObjectByName(`${node.id}__motion__${motion.id}`)!
      group.userData.proceduralMotion = { ...group.userData.proceduralMotion, clip: clipName }
      const values = [0, 0.25, 0.5, 0.75, 1].flatMap((fraction) =>
        new THREE.Quaternion()
          .setFromAxisAngle(axisVector(motion), Math.sign(motion.amount) * 2 * Math.PI * fraction)
          .toArray(),
      )
      return new THREE.QuaternionKeyframeTrack(`${group.uuid}.quaternion`, times, values)
    })
    const clip = new THREE.AnimationClip(clipName, duration, tracks)
    clip.userData = { loop: true }
    clips.push(clip)
  }
  return clips
}
