import { describe, expect, test } from 'bun:test'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { compileGeometryScript } from './compile'

const SASH = `
import * as THREE from 'three'
export const mount = 'wall'
export default function build() {
  const g = new THREE.Group()
  const sash = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05), new THREE.MeshStandardMaterial())
  sash.name = 'sash'
  g.add(sash)
  const times = [0, 1]
  g.animations = [new THREE.AnimationClip('open', 1, [new THREE.VectorKeyframeTrack('sash.position', times, [0, 0, 0, 0, 0.7, 0])])]
  return g
}
`

describe('clips', () => {
  test('a clip is stored ending on its last pose, not wrapped to its first', async () => {
    const { glb } = await compileGeometryScript({ code: SASH })
    const gltf = await new GLTFLoader().parseAsync(glb, '')
    const track = gltf.animations[0]!.tracks.find((t) => t.name.endsWith('.position'))!
    const start = track.values[1]!
    const end = track.values[track.values.length - 2]!
    expect(end - start).toBeCloseTo(0.7, 3)
  })
})
