import type { CabinetModuleNode, CabinetNode } from '@pascal-app/core'
import * as THREE from 'three'

type CabinetPose =
  | { type: 'rotate'; axis: 'x' | 'y' | 'z'; angle: number }
  | { type: 'translate'; axis: 'x' | 'y' | 'z'; distance: number }

const POSE_EPSILON = 1e-5

export function poseCabinetMovingParts(root: THREE.Object3D, openScale: number): boolean {
  let posed = false
  root.traverse((obj) => {
    const pose = obj.userData.cabinetPose as CabinetPose | undefined
    if (!pose) return
    posed = true
    if (pose.type === 'rotate') obj.rotation[pose.axis] = pose.angle * openScale
    else obj.position[pose.axis] = pose.distance * openScale
  })
  return posed
}

export function bakeCabinetAnimationClip(
  node: CabinetNode | CabinetModuleNode,
  object: THREE.Object3D,
): THREE.AnimationClip | null {
  if (!poseCabinetMovingParts(object, 0)) return null

  const objects: THREE.Object3D[] = []
  object.traverse((child) => objects.push(child))
  const basePoses = objects.map((child) => ({
    position: child.position.clone(),
    quaternion: child.quaternion.clone(),
    scale: child.scale.clone(),
  }))

  poseCabinetMovingParts(object, 1)

  const tracks: THREE.KeyframeTrack[] = []
  for (let i = 0; i < objects.length; i++) {
    const child = objects[i]!
    const base = basePoses[i]!

    if (child.position.distanceToSquared(base.position) > POSE_EPSILON) {
      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${child.uuid}.position`,
          [0, 1],
          [...base.position.toArray(), ...child.position.toArray()],
        ),
      )
    }
    if (child.quaternion.angleTo(base.quaternion) > POSE_EPSILON) {
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${child.uuid}.quaternion`,
          [0, 1],
          [...base.quaternion.toArray(), ...child.quaternion.toArray()],
        ),
      )
    }
    if (child.scale.distanceToSquared(base.scale) > POSE_EPSILON) {
      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${child.uuid}.scale`,
          [0, 1],
          [...base.scale.toArray(), ...child.scale.toArray()],
        ),
      )
    }
  }

  poseCabinetMovingParts(object, 0)

  if (tracks.length === 0) return null
  const clip = new THREE.AnimationClip(`${node.id}: open`, 1, tracks)
  clip.userData = { loop: false }
  return clip
}
