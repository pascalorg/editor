import { evaluateRecipe, type ProceduralItemNode } from '@pascal-app/core/procedural-items'
import * as THREE from 'three'

export const PROCEDURAL_OPEN_DURATION = 0.45

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

export function bakeProceduralAnimationClips(
  node: ProceduralItemNode,
  object: THREE.Object3D,
): THREE.AnimationClip[] {
  const motions = evaluateRecipe(node.recipe, node.parameters).motions
  poseProceduralMotionsAtRest(node, object)
  const tracksByPart = new Map<
    string,
    { kind: 'open' | 'loop'; tracks: THREE.KeyframeTrack[]; duration: number }
  >()
  for (const motion of motions) {
    const group = object.getObjectByName(`${node.id}__motion__${motion.id}`)
    if (!group) continue
    const kind = motion.kind === 'spin' ? 'loop' : 'open'
    const duration =
      kind === 'loop' ? (2 * Math.PI) / Math.abs(motion.amount) : PROCEDURAL_OPEN_DURATION
    const entry = tracksByPart.get(motion.partId) ?? { kind, tracks: [], duration }
    const axis = new THREE.Vector3(
      motion.axis === 'x' ? 1 : 0,
      motion.axis === 'y' ? 1 : 0,
      motion.axis === 'z' ? 1 : 0,
    )
    if (motion.kind === 'slide') {
      const end = new THREE.Vector3(...motion.pivot).addScaledVector(axis, motion.amount)
      entry.tracks.push(
        new THREE.VectorKeyframeTrack(
          `${group.uuid}.position`,
          [0, duration],
          [...motion.pivot, ...end.toArray()],
        ),
      )
    } else {
      const fractions = motion.kind === 'spin' ? [0, 0.25, 0.5, 0.75, 1] : [0, 1]
      const times = fractions.map((fraction) => fraction * duration)
      const values = fractions.flatMap((fraction) =>
        new THREE.Quaternion()
          .setFromAxisAngle(
            axis,
            (motion.kind === 'spin' ? Math.sign(motion.amount) * 2 * Math.PI : motion.amount) *
              fraction,
          )
          .toArray(),
      )
      entry.tracks.push(
        new THREE.QuaternionKeyframeTrack(`${group.uuid}.quaternion`, times, values),
      )
    }
    tracksByPart.set(motion.partId, entry)
  }
  return [...tracksByPart].map(([partId, entry]) => {
    const clip = new THREE.AnimationClip(
      `${node.id}:${partId}: ${entry.kind}`,
      entry.duration,
      entry.tracks,
    )
    clip.userData = { loop: entry.kind === 'loop' }
    return clip
  })
}
