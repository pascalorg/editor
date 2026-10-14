import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  CEILING_DRAW_OFFSET,
  matchScriptSlotsToLibrary,
  resolveCeilingHeight,
  scriptSource,
} from '@pascal-app/core'
import {
  addObject,
  applySceneChanges,
  editedScriptParams,
  verifyScene,
} from '@pascal-app/core/agent-operations'
import {
  BuildingNode,
  CeilingNode,
  GeometryArtifactManifest,
  ItemNode,
  LevelNode,
  SlabNode,
  WallNode,
} from '@pascal-app/core/schema'
import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CHEF_LAMP_SCRIPT } from './__fixtures__/ceiling-lamp'
import { FITTED_CABINET_SCRIPT } from './__fixtures__/fitted-cabinet'
import { SLIDING_DOOR_SCRIPT } from './__fixtures__/sliding-door'
import { CINEMA_SCREEN_SCRIPT } from './__fixtures__/wall-screen'
import { finishBuild } from './compile'
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

test('ceiling artifacts hang below their attachment while floor and wall origins stay unchanged', async () => {
  const level = LevelNode.parse({ id: 'level_mount', height: 3.6 })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_mount',
    parentId: level.id,
    polygon: [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ],
  })
  const plane =
    resolveCeilingHeight(ceiling, {
      [level.id]: level,
      [ceiling.id]: ceiling,
    }) - CEILING_DRAW_OFFSET
  for (const mount of ['ceiling', 'floor', 'wall', 'wall-side']) {
    const compiled = await compileGeometryScript({
      code: `export const mount = '${mount}';
      export default function build({ THREE }) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1));
        mesh.position.set(3, 4, 5);
        return mesh;
      }`,
    })
    const artifact = await new GLTFLoader().parseAsync(compiled.glb, '')
    artifact.scene.position.y = plane
    const bounds = new Box3().setFromObject(artifact.scene)
    expect(bounds.getSize(new Vector3()).toArray()).toEqual([2, expect.closeTo(0.8), 1])
    expect(compiled.manifest.bounds.min[1]).toBe(mount === 'ceiling' ? -0.8 : 0)
    expect(compiled.manifest.bounds.max[1]).toBe(mount === 'ceiling' ? 0 : 0.8)
    expect(bounds.min.y).toBeCloseTo(plane - (mount === 'ceiling' ? 0.8 : 0))
    expect(bounds.max.y).toBeCloseTo(plane + (mount === 'ceiling' ? 0 : 0.8))
    expect(compiled.manifest.bounds.min[2]).toBe(mount === 'wall-side' ? 0 : -0.5)
    expect(compiled.manifest.bounds.max[2]).toBe(mount === 'wall-side' ? 1 : 0.5)
  }
})

test('the owner screen compiles back-anchored, while a reversed back mount crosses its wall', async () => {
  const compiled = await compileGeometryScript({ code: CINEMA_SCREEN_SCRIPT })
  expect(compiled.mount).toBe('wall-side')
  expect(compiled.manifest.bounds).toEqual({
    min: [-3.3, 0, expect.closeTo(0, 6)],
    max: [3.3, 2.5, 0.3325],
  })
  const level = LevelNode.parse({ id: 'level_screen', height: 3.8 })
  const wall = WallNode.parse({
    id: 'wall_screen',
    parentId: level.id,
    start: [-3, 3],
    end: [-12, 3],
    thickness: 0.22,
  })
  const screen = ItemNode.parse({
    id: 'item_screen',
    parentId: wall.id,
    side: 'back',
    position: [4.5, 0.55, 0],
    source: scriptSource(compiled),
    asset: {
      id: 'screen',
      name: 'Cinema projection screen and acoustic surround',
      category: 'media wall',
      thumbnail: '',
      src: 'asset://screen',
      attachTo: 'wall-side',
      dimensions: [6.6, 2.5, 0.3325],
    },
  })
  const artifact = await new GLTFLoader().parseAsync(compiled.glb, '')
  artifact.scene.position.z = -0.11
  const observed = new Box3().setFromObject(artifact.scene)
  expect(observed.min.z).toBeCloseTo(-0.11, 6)
  expect(observed.max.z).toBeCloseTo(0.2225, 6)
  const nodes = Object.fromEntries([level, wall, screen].map((node) => [node.id, node]))
  const issues = verifyScene(nodes, {}, { activeLevelId: level.id }).result.issues
  expect(issues).toContainEqual(
    expect.objectContaining({
      type: 'item_through_wall',
      beyondOppositeFaceMeters: expect.closeTo(0.1125, 6),
    }),
  )
  screen.rotation[1] = Math.PI
  expect(
    (
      verifyScene(nodes, {}, { activeLevelId: level.id }).result.issues as { type: string }[]
    ).filter((issue) => /^item_(wall_|through_wall|faces_wall)/.test(issue.type)),
  ).toEqual([])
  const initial = { [level.id]: level, [wall.id]: wall }
  const added = addObject(
    initial,
    {
      compiled,
      parentId: wall.id,
      side: 'back',
      position: [4.5, 0.55, 0],
      reason: 'Cinema projection screen and acoustic surround.',
    },
    { activeLevelId: level.id },
  )
  const placed = applySceneChanges(initial, added.changes)
  expect(ItemNode.parse(placed[added.result.nodeId as string]).rotation).toEqual([0, Math.PI, 0])
  expect(
    (
      verifyScene(placed, {}, { activeLevelId: level.id }).result.issues as { type: string }[]
    ).filter((issue) => /^item_(wall_|through_wall|faces_wall)/.test(issue.type)),
  ).toEqual([])
})

test('the rebuilt chef lamp hangs down and verification observes its saved upward-built bounds', async () => {
  const compiled = await compileGeometryScript({
    code: CHEF_LAMP_SCRIPT,
    params: { radius: 0.72, drop: 0.85, tiers: 1 },
  })
  expect(compiled.manifest.bounds).toEqual({
    min: [-0.764, -0.8285, -0.764],
    max: [0.764, 0, 0.764],
  })
  const polygon: [number, number][] = [
    [6, -3],
    [10, -3],
    [10, 1],
    [6, 1],
  ]
  const building = BuildingNode.parse({ id: 'building_chef' })
  const ground = LevelNode.parse({
    id: 'level_chef_ground',
    parentId: building.id,
    level: 0,
    height: 3.6,
  })
  const upper = LevelNode.parse({
    id: 'level_chef_upper',
    parentId: building.id,
    level: 1,
    height: 3.3,
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_88zvkao8naaye0gw',
    parentId: ground.id,
    polygon,
  })
  const slab = SlabNode.parse({
    id: 'slab_0000evo624j6qr31',
    parentId: upper.id,
    polygon,
    elevation: 0.05,
    thickness: 0.05,
  })
  building.children = [ground.id, upper.id]
  ground.children = [ceiling.id]
  upper.children = [slab.id]
  const initial = Object.fromEntries(
    [building, ground, upper, ceiling, slab].map((node) => [node.id, node]),
  )
  const context = { activeLevelId: ground.id }
  const added = addObject(
    initial,
    {
      compiled,
      parentId: ceiling.id,
      position: [8, 0, -1],
      name: 'Chef Kitchen alabaster light',
      reason: 'Warm alabaster ring lighting',
    },
    context,
  )
  const correct = applySceneChanges(initial, added.changes)
  const item = ItemNode.parse(correct[added.result.nodeId as string])
  const plane = resolveCeilingHeight(ceiling, correct) - CEILING_DRAW_OFFSET
  expect(plane).toBeCloseTo(3.58)
  const artifact = await new GLTFLoader().parseAsync(compiled.glb, '')
  artifact.scene.position.set(8, plane, -1)
  const worldBounds = new Box3().setFromObject(artifact.scene)
  expect(worldBounds.max.y).toBeCloseTo(plane)
  expect(worldBounds.min.y).toBeCloseTo(plane - 0.8285)
  const observations = (nodes: Record<string, AnyNode>) =>
    (verifyScene(nodes, {}, context).result.issues as { type: string }[]).filter((issue) =>
      ['item_above_ceiling', 'item_covering_slab_overlap'].includes(issue.type),
    )
  expect(observations(correct)).toEqual([])

  // The old compiler translated these same meshes to minY = 0 instead of maxY = 0.
  const saved = ItemNode.parse({
    ...item,
    id: 'item_pq9vb5ybn2em2cr9',
    source: {
      ...item.source,
      manifest: {
        ...compiled.manifest,
        bounds: { min: [-0.764, 0, -0.764], max: [0.764, 0.8285, 0.764] },
      },
    },
  })
  const savedNodes = { ...correct, [saved.id]: saved }
  delete savedNodes[item.id]
  savedNodes[ceiling.id] = { ...ceiling, children: [saved.id] }
  const before = JSON.stringify(savedNodes)
  expect(observations(savedNodes)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'item_above_ceiling',
        itemId: saved.id,
        ceilingId: ceiling.id,
        aboveAttachmentMeters: expect.closeTo(0.8285),
      }),
      expect.objectContaining({
        type: 'item_covering_slab_overlap',
        itemId: saved.id,
        slabId: slab.id,
        overlapHeightMeters: expect.closeTo(0.05),
      }),
    ]),
  )
  expect(JSON.stringify(savedNodes)).toBe(before)
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

// `Box3.isEmpty()` is false for a box with a NaN corner, so a mesh at a position that is not a
// number used to compile into NaN bounds, which reached the item schema as a raw validation dump.
describe('an object that cannot be measured', () => {
  const built = (body: string) => `import * as THREE from 'three'
export default function build() {
  const g = new THREE.Group()
  ${body}
  return g
}`

  test('the cabinet builds at its defaults and with its display branch off', async () => {
    for (const params of [undefined, { width: 7.7, display: false }]) {
      const { manifest } = await compileGeometryScript({ code: FITTED_CABINET_SCRIPT, params })
      const { min, max } = manifest.bounds
      expect([...min, ...max].every(Number.isFinite)).toBe(true)
      expect(max[0] - min[0]).toBeGreaterThan(4)
    }
  })

  test('a mesh whose position holds a material is refused, naming the mesh and its axis', async () => {
    const failure = await compileGeometryScript({
      code: FITTED_CABINET_SCRIPT,
      params: { width: 7.7, display: true },
    }).then(
      () => null,
      (error: Error) => error,
    )
    expect(failure?.message).toContain('cannot be measured')
    expect(failure?.message).toContain('BoxGeometry mesh')
    expect(failure?.message).toContain('position.z = a MeshStandardMaterial')
  })

  test('a named group moved to NaN is named with its axis', async () => {
    const code = built(`const shelf = new THREE.Group()
  shelf.name = 'part:shelf'
  shelf.position.y = Number.NaN
  shelf.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.4), new THREE.MeshStandardMaterial()))
  g.add(shelf)`)
    await expect(compileGeometryScript({ code })).rejects.toThrow(
      '"part:shelf" has position.y = NaN',
    )
  })

  test('vertices that are NaN keep their own message', async () => {
    const code = built(`const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.getAttribute('position').setX(0, Number.NaN)
  const lid = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
  lid.name = 'lid'
  g.add(lid)`)
    await expect(compileGeometryScript({ code })).rejects.toThrow(
      'lid has non-finite vertex positions',
    )
  })

  test('an object with no mesh at all is still refused as empty', async () => {
    await expect(compileGeometryScript({ code: built('') })).rejects.toThrow(
      'build() returned no visible meshes',
    )
  })
})

describe('a sliding door built from a script', () => {
  test('keeps its open clip with every track bound to a leaf that is in the artifact', async () => {
    const { glb, manifest } = await compileGeometryScript({
      code: SLIDING_DOOR_SCRIPT,
      params: { width: 1.2, height: 2.55, glazed: false },
    })
    expect(manifest.animations).toEqual([{ name: 'open', duration: 1.3 }])

    const gltf = await new GLTFLoader().parseAsync(glb, '')
    const clip = gltf.animations.find((candidate) => candidate.name === 'open')!
    expect(clip.tracks.map((track) => track.name).sort()).toEqual([
      'leaf_0.position',
      'leaf_1.position',
    ])

    // played the way the viewer plays it, the leaves slide apart from where they stand closed
    const leaf = (name: string) => gltf.scene.getObjectByName(name)!
    const closed = [leaf('leaf_0').position.x, leaf('leaf_1').position.x]
    const action = new AnimationMixer(gltf.scene).clipAction(clip)
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()
    action.getMixer().setTime(clip.duration)
    expect(leaf('leaf_0').position.x).toBeLessThan(closed[0]! - 0.4)
    expect(leaf('leaf_1').position.x).toBeGreaterThan(closed[1]! + 0.4)
  })
})

// A Blender module is read into the same `finishBuild` a three.js one ends in, so what refuses an
// object there refuses it for both languages: a node at a position that is not a number, or no mesh.
describe('what refuses an object that cannot be measured, for a Blender build too', () => {
  const finish = (built: Group) =>
    finishBuild({
      built,
      mount: 'floor',
      specs: [],
      params: {},
      code: 'import bpy',
      language: 'bpy',
    })

  test('a mesh at a position that is not a number is refused, naming it', async () => {
    const built = new Group()
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
    mesh.position.set(0, 0.5, new MeshStandardMaterial() as unknown as number)
    built.add(mesh)
    await expect(finish(built)).rejects.toThrow('position.z = a MeshStandardMaterial')
  })

  test('a build with no mesh is refused as empty', async () => {
    await expect(finish(new Group())).rejects.toThrow('build() returned no visible meshes')
  })

  test('a build that is measurable carries its language into the artifact', async () => {
    const built = new Group()
    built.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()))
    expect((await finish(built)).language).toBe('bpy')
  })
})
