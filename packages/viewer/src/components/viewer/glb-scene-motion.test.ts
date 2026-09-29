import { expect, test } from 'bun:test'
import * as THREE from 'three'

test('paused procedural actions evaluate assigned time without advancing the mixer', () => {
  const root = new THREE.Group()
  const target = new THREE.Group()
  root.add(target)
  const clip = new THREE.AnimationClip('drawer: open', 0.65, [
    new THREE.VectorKeyframeTrack(
      `${target.uuid}.position`,
      [0, 0.3, 0.65],
      [0, 0, 0, 0, 0, 0, 0, 0, 1],
    ),
  ])
  const mixer = new THREE.AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.enabled = true
  action.paused = true
  action.setEffectiveWeight(1)
  action.play()
  action.time = 0.2
  mixer.update(0)
  expect(target.position.z).toBe(0)
  action.time = 0.475
  mixer.update(0)
  expect(target.position.z).toBeCloseTo(0.5)
  action.time = 0.2
  mixer.update(0)
  expect(target.position.z).toBe(0)
})
