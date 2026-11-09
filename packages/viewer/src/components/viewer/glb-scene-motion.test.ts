import { expect, test } from 'bun:test'
import { type AnyNodeId, useInteractive } from '@pascal-app/core'
import * as THREE from 'three'
import { bindGlbShutters, isGlbShutterHit, toggleGlbShutters } from './glb-scene-motion'

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

test.each([0, 0.3, 0.7, 1])(
  'shutters toggle from saved fraction %s and reverse without restarting',
  (fraction) => {
    const id = 'window_shutters' as AnyNodeId
    const root = new THREE.Group()
    const curtain = new THREE.Group()
    root.add(curtain)
    curtain.scale.y = 1 - 0.98 * fraction
    const clip = new THREE.AnimationClip(`${id}: shutters`, 1, [
      new THREE.VectorKeyframeTrack(`${curtain.uuid}.scale`, [0, 1], [1, 1, 1, 1, 0.02, 1]),
    ])
    root.userData = { pascalId: id, shutters: true, shuttersOpen: fraction, clips: [clip.name] }
    const mixer = new THREE.AnimationMixer(root)
    const action = mixer.clipAction(clip)
    const cleanup = bindGlbShutters(new Map([[id, root]]), { [clip.name]: action })
    expect(useInteractive.getState().mechanismParts[`${id}:shutters`]).toBe(fraction > 0.5)
    expect(action.time).toBeCloseTo(fraction)
    mixer.update(0)
    expect(curtain.scale.y).toBeCloseTo(1 - 0.98 * fraction)
    expect(toggleGlbShutters(root)).toBe(true)
    const direction = fraction > 0.5 ? -1 : 1
    expect(action.timeScale).toBe(direction)
    mixer.update(0.1)
    expect(action.time).toBeCloseTo(fraction + direction * 0.1)
    const time = action.time
    toggleGlbShutters(root)
    expect(action.time).toBe(time)
    expect(action.timeScale).toBe(-direction)
    mixer.update(2)
    expect(action.time).toBe(direction > 0 ? 0 : 1)
    expect(action.paused).toBe(true)
    toggleGlbShutters(root)
    mixer.update(2)
    expect(action.time).toBe(direction > 0 ? 1 : 0)
    expect(action.paused).toBe(true)
    cleanup()
    expect(useInteractive.getState().mechanismParts[`${id}:shutters`]).toBeUndefined()
  },
)

test('a hit inside shutter-left or roller groups maps to shutters, while a sash maps to open', () => {
  const window = new THREE.Group()
  for (const name of [
    'shutter-left',
    'shutter-outer',
    'window-roller-curtain',
    'window-roller-box',
    'casement-window-sash',
  ]) {
    const part = new THREE.Group()
    part.name = name
    const hit = new THREE.Mesh()
    part.add(hit)
    window.add(part)
    expect(isGlbShutterHit(hit, window)).toBe(name !== 'casement-window-sash')
  }
})
