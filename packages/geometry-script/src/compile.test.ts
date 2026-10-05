import { describe, expect, test } from 'bun:test'
import { GeometryArtifactManifest } from '@pascal-app/core/schema'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { compileGeometryScript } from './index'

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

test('cutter footprints retain concavity and host kind while old manifests still load', async () => {
  const { manifest } = await compileGeometryScript({
    code: `export default function build({ THREE }) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4), new THREE.MeshStandardMaterial()));
    const shape = new THREE.Shape(); shape.moveTo(0,0); shape.lineTo(2,0); shape.lineTo(2,1); shape.lineTo(1,1); shape.lineTo(1,2); shape.lineTo(0,2); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {depth:2, bevelEnabled:false}); geometry.rotateX(-Math.PI/2);
    const cutter = new THREE.Mesh(geometry); cutter.name='cut:slab'; cutter.position.y=-1; g.add(cutter); return g;
  }`,
  })
  const parsed = GeometryArtifactManifest.parse(manifest)
  expect(parsed.cutters).toHaveLength(1)
  expect(parsed.cutters![0]!.host).toBe('slab')
  const ring = parsed.cutters![0]!.polygon
  const area =
    Math.abs(
      ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length]!
        return sum + p[0]! * q[1]! - q[0]! * p[1]!
      }, 0),
    ) / 2
  expect(area).toBeCloseTo(3)
  expect(ring).toHaveLength(6)
  const { cutters, ...legacy } = manifest
  expect(GeometryArtifactManifest.parse(legacy).cutters).toBeUndefined()
})

test('only slab and ceiling cutter outlines are stored while wall cutters stay in the artifact', async () => {
  for (const [mount, name, host] of [
    ['floor', 'cut:wall', undefined],
    ['wall', 'cutout', undefined],
    ['wall-side', 'cutout', undefined],
    ['floor', 'cutout', 'mounted'],
    ['ceiling', 'cutout', 'mounted'],
    ['ceiling', 'cut:ceiling', 'ceiling'],
  ] as const) {
    const { manifest, glb } = await compileGeometryScript({
      code: `export const mount = '${mount}';
      export default function build({ THREE }) {
        const group = new THREE.Group();
        group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
        const cutter = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2, 0.5));
        cutter.name = '${name}'; group.add(cutter); return group;
      }`,
    })
    expect(manifest.cutout).toBe(true)
    expect(manifest.cutters?.map((cutter) => cutter.host)).toEqual(host ? [host] : [])
    const artifact = await new GLTFLoader().parseAsync(glb, '')
    expect(artifact.parser.json.nodes.some((node: { name?: string }) => node.name === name)).toBe(
      true,
    )
  }
})
