import { describe, expect, test } from 'bun:test'
import { type AnyNode, matchScriptSlotsToLibrary, scriptSource } from '@pascal-app/core'
import { addObject, applySceneChanges, editedScriptParams } from '@pascal-app/core/agent-operations'
import { GeometryArtifactManifest, ItemNode, LevelNode } from '@pascal-app/core/schema'
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

test('an edit keeps the current param values the new code still accepts', async () => {
  const module = (params: string) => `export const params = ${params}
  export default function build({ THREE }) {
    const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))); return g
  }`
  const before = await compileGeometryScript({
    code: module(
      `{ width: { default: 5.2, min: 3, max: 8 }, depth: 2.4, height: 2.75, finish: 'pine', rail: 1, gone: 9 }`,
    ),
    params: { width: 6.3, depth: 1.7, height: 2.52, finish: 'walnut', rail: 0, gone: 4 },
  })
  const node = { type: 'item', source: scriptSource(before) } as AnyNode
  const after = await compileGeometryScript({
    code: module(`{
      width: { default: 5.2, min: 3, max: 8 },
      depth: { default: 2.4, min: 2, max: 4 },
      height: 2.75,
      finish: { default: 'oak', options: ['oak', 'ash'] },
      rail: true,
      lit: false,
    }`),
    params: editedScriptParams(node, { height: 3 }),
  })
  expect(after.params).toEqual({
    width: 6.3,
    depth: 2,
    height: 3,
    finish: 'oak',
    rail: true,
    lit: false,
  })
})

test('building and adding a scripted item assigns Pascal finishes and rebuilding keeps paint', async () => {
  const compiled = await compileGeometryScript({
    code: `export default function build({ THREE }) {
      const group = new THREE.Group();
      const samples = [
        ['slot_oak', '#a77440', 0, 1, false],
        ['slot_hardware', '#b08d57', 0.9, 1, false],
        ['glass', '#87ceeb', 0, 0.3, true],
        ['slot_paint', '#eae6de', 0, 1, false],
        ['slot_unknown', '#ff00ff', 0, 1, false],
        ['slot_oakTop', '#f3dcb5', 0, 1, false],
      ];
      samples.forEach(([name, color, metalness, opacity, transparent], i) => {
        const material = new THREE.MeshStandardMaterial({ color, metalness, opacity, transparent, roughness: 0.7 });
        material.name = name;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), material);
        mesh.position.x = i * 0.2; group.add(mesh);
      });
      const bulb = new THREE.MeshStandardMaterial({color: '#ffffff', emissive: '#ffffff'});
      bulb.name = 'slot_bulb'; group.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), bulb));
      return group;
    }`,
  })
  const level = LevelNode.parse({ id: 'level_material_test' })
  const initial = { [level.id]: level }
  const context = { activeLevelId: level.id }
  const added = addObject(initial, { compiled }, context)
  const nodes = applySceneChanges(initial, added.changes)
  const node = ItemNode.parse(nodes[added.result.nodeId as string])
  expect(node.slots).toEqual({
    oak: 'library:wood-finewood27',
    hardware: 'library:metal-brass',
    glass: 'library:preset-glass',
    paint: 'library:preset-softwhite',
    oaktop: 'library:wood-finewood27',
  })
  expect(node.source!.manifest.slots.find((slot) => slot.id === 'hardware')).toMatchObject({
    color: '#b08d57',
    metalness: 0.9,
    roughness: 0.7,
  })
  expect(node.source!.manifest.slots.find((slot) => slot.id === 'unknown')?.color).toBe('#ff00ff')
  expect(node.source!.manifest.slots.find((slot) => slot.id === 'bulb')?.emissive).toBe(true)
  const artifact = await new GLTFLoader().parseAsync(compiled.glb, '')
  expect(
    artifact.parser.json.materials.some(
      (material: { name?: string }) => material.name === 'slot_glass',
    ),
  ).toBe(true)

  for (const paint of ['scene:mtl_user', 'library:preset-white', '#123456']) {
    const painted = ItemNode.parse({ ...node, slots: { ...node.slots, oak: paint } })
    const rebuilt = addObject(
      { ...nodes, [node.id]: painted },
      { compiled, nodeId: node.id },
      context,
    )
    const after = applySceneChanges({ ...nodes, [node.id]: painted }, rebuilt.changes)
    expect(ItemNode.parse(JSON.parse(JSON.stringify(after[node.id]))).slots).toEqual({
      ...node.slots,
      oak: paint,
    })
  }
})

test('conflicting materials in one slot do not invent a matching tone', async () => {
  const { manifest } = await compileGeometryScript({
    code: `export default function build({ THREE }) {
      const group = new THREE.Group();
      for (const color of ['#a77440', '#3e220d']) {
        const material = new THREE.MeshStandardMaterial({ color }); material.name = 'slot_body';
        group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
      }
      return group;
    }`,
  })
  expect(manifest.slots).toHaveLength(1)
  expect(manifest.slots[0]!.color).toBeUndefined()
})

test('only see-through materials hint glass', async () => {
  const { manifest } = await compileGeometryScript({
    code: `export default function build({ THREE }) {
      const group = new THREE.Group();
      const materials = [
        new THREE.MeshStandardMaterial({ color: '#fff8e7', transparent: true, opacity: 0.85 }),
        new THREE.MeshStandardMaterial({ color: '#2e7d32', transparent: true }),
        new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.3 }),
        new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1 }),
      ];
      ['slot_shade', 'slot_leaves', 'slot_pane', 'slot_lens'].forEach((name, i) => {
        materials[i].name = name;
        group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials[i]));
      });
      return group;
    }`,
  })
  expect(matchScriptSlotsToLibrary(manifest)).toMatchObject({
    pane: 'library:preset-glass',
    lens: 'library:preset-glass',
  })
  expect(matchScriptSlotsToLibrary(manifest).shade).not.toBe('library:preset-glass')
  expect(matchScriptSlotsToLibrary(manifest).leaves).not.toBe('library:preset-glass')
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
