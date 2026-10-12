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
  const added = addObject(initial, { compiled, reason: 'no catalog cabinet' }, context)
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

test('compiles a bespoke bed with consecutive allowlisted imports on one line', async () => {
  const { manifest, mount, params, glb } = await compileGeometryScript({
    code: `import * as THREE from 'three'; import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
export const params={width:{default:4,min:2.8,max:4.6,step:.1},depth:{default:2.8,min:2.5,max:3.2,step:.1},color:{default:'#d5c5ad'}};export const mount='floor';
export default function build({params:p}){const g=new THREE.Group();const fabric=new THREE.MeshStandardMaterial({color:p.color,roughness:.94});fabric.name='slot_upholstery';const linen=new THREE.MeshStandardMaterial({color:'#f2ece1',roughness:1});linen.name='slot_linen';const wood=new THREE.MeshStandardMaterial({color:'#493426',roughness:.4});wood.name='slot_joinery';const brass=new THREE.MeshStandardMaterial({color:'#b39660',metalness:.78,roughness:.3});brass.name='slot_bronze';const accent=new THREE.MeshStandardMaterial({color:'#6b6e57',roughness:1});accent.name='slot_throw';
function part(id,type){let q=new THREE.Group();q.name='part:'+id;q.userData.type=type;g.add(q);return q;}function b(q,w,h,d,x,y,z,m,r=.05){let a=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,r),m);a.position.set(x,y,z);q.add(a);return a;}
let a=part('headboard','panel');b(a,p.width,1.48,.2,0,.84,-p.depth/2+.1,fabric,.085);for(let x=-p.width/2+.22;x<p.width/2;x+=.24)b(a,.012,1.12,.012,x,.94,-p.depth/2+.207,brass,.003);
a=part('bed','bed');b(a,2.24,.17,2.26,0,.13,.13,brass);b(a,2.4,.24,2.36,0,.3,.13,fabric,.09);b(a,2.2,.27,2.22,0,.555,.15,linen,.11);b(a,2.21,.075,.83,0,.73,.87,accent,.025);for(let x of[-.56,.56]){const pillow=b(a,.88,.18,.53,x,.78,-.62,linen,.085);pillow.rotation.x=-.14;b(a,.46,.19,.32,x,.83,-.28,fabric,.09);}
a=part('bedside_cabinets','cabinet');for(let s of[-1,1]){let x=s*(p.width/2-.34);b(a,.6,.11,.55,x,.08,-.78,brass);b(a,.64,.47,.58,x,.37,-.78,wood);b(a,.67,.035,.61,x,.625,-.78,brass,.015);b(a,.22,.018,.024,x,.37,-.478,brass,.005);let ball=new THREE.Mesh(new THREE.SphereGeometry(.10,24,16),brass);ball.position.set(x,.74,-.78);a.add(ball);}
return g;}`,
    params: { width: 3.15, depth: 2.7, color: '#b6c0b5' },
  })
  expect(mount).toBe('floor')
  expect(params).toEqual({ width: 3.15, depth: 2.7, color: '#b6c0b5' })
  expect(manifest.parts.map((part) => part.id)).toEqual(['headboard', 'bed', 'bedside_cabinets'])
  expect(manifest.slots.map((slot) => slot.id).sort()).toEqual([
    'bronze',
    'joinery',
    'linen',
    'throw',
    'upholstery',
  ])
  expect(manifest.triangles).toBeGreaterThan(0)
  const artifact = await new GLTFLoader().parseAsync(glb, '')
  expect(artifact.scene.children.length).toBeGreaterThan(0)
})

test.each([
  'node:fs',
  'https://example.com/module.js',
  'three/addons/loaders/GLTFLoader.js',
])('rejects a non-allowlisted import after a same-line import: %s', async (specifier) => {
  await expect(
    compileGeometryScript({
      code: `import * as THREE from 'three'; import { unavailable } from '${specifier}';
export default function build() { return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); }`,
    }),
  ).rejects.toThrow(`Unsupported import ${specifier}`)
})
