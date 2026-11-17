import { expect, test } from 'bun:test'
import {
  type AnyNode,
  DormerNode,
  DownspoutNode,
  GutterNode,
  LevelNode,
  RoofCovering,
  RoofNode,
  RoofSegmentNode,
  SkylightNode,
} from '@pascal-app/core'
import {
  BoxGeometry,
  type BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from 'three'
import { createRoofCoveringCapGeometry, getRoofCoveringCapSegment } from './covering-caps'
import { RoofCoveringDetail } from './covering-detail'

// Analytical 45° roof, without layer/overhang offsets: eaves at y=0,
// z=±2 and x=±4; gable ridge y=2, z=0, x∈[-4,4].
// The hip ridge ends at x=±2 and meets all four footprint corners.
// These coordinates do not call the producer's roof-face/edge helpers.
const segment = (roofType: 'gable' | 'hip' = 'gable') =>
  RoofSegmentNode.parse({
    id: 'rseg_caps',
    parentId: 'roof_caps',
    roofType,
    width: 8,
    depth: 4,
    wallHeight: 0,
    pitch: 45,
    wallThickness: 0,
    deckThickness: 0,
    shingleThickness: 0,
    overhang: 0,
    gableOverhang: 0,
  })
const covering = () =>
  RoofCovering.parse({ profile: 'tile', caps: true, course: 0.31, distance: 5, relief: 0 })

function drainageScene() {
  const s = segment()
  const gutter = GutterNode.parse({
    id: 'gutter_caps',
    parentId: s.id,
    roofSegmentId: s.id,
    position: [0, 0, 2],
    length: 8,
  })
  const downspout = DownspoutNode.parse({
    id: 'downspout_caps',
    parentId: s.id,
    gutterId: gutter.id,
  })
  const drained = { ...s, children: [gutter.id, downspout.id] }
  const roof = RoofNode.parse({ id: s.parentId, parentId: 'level_caps', children: [s.id] })
  const level = LevelNode.parse({ id: 'level_caps', children: [roof.id] })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [roof, level, drained, gutter, downspout].map((node) => [node.id, node]),
  )
  return { segment: drained, roof, nodes }
}

function capAt(geometry: BufferGeometry, x: number, z: number) {
  const material = new MeshBasicMaterial({ side: DoubleSide })
  try {
    return new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0)).intersectObject(
      new Mesh(geometry, material),
    )[0]?.point.y
  } finally {
    material.dispose()
  }
}

type Edge = readonly [Vector3, Vector3]
const gableEdges: Edge[] = [[new Vector3(-4, 2, 0), new Vector3(4, 2, 0)]]
const hipEdges: Edge[] = [
  [new Vector3(-2, 2, 0), new Vector3(2, 2, 0)],
  ...[-1, 1].flatMap((x) =>
    [-1, 1].map((z) => [new Vector3(x * 2, 2, 0), new Vector3(x * 4, 0, z * 2)] as const),
  ),
]

// Each real triangle must belong to ONE finite allowed edge, not merely have
// vertices near unrelated ridges. 0.3 m is a conservative envelope for this
// 0.3 m-wide finish, not an oracle for its arch tessellation or vertex order.
// Endpoint tolerance is only Float32 rounding (0.01 mm at this fixture scale).
function expectFiniteEdgeTriangles(geometry: BufferGeometry, edges: Edge[]) {
  const position = geometry.getAttribute('position')
  const count = geometry.index?.count ?? position.count
  expect(count).toBeGreaterThan(0)
  expect(count % 3).toBe(0)
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map((offset) =>
      new Vector3().fromBufferAttribute(position, geometry.index?.getX(i + offset) ?? i + offset),
    )
    expect(triangle.every((p) => p.toArray().every(Number.isFinite))).toBe(true)
    expect(
      edges.some(([a, b]) => {
        const axis = b.clone().sub(a).normalize()
        const length = a.distanceTo(b)
        return triangle.every((p) => {
          const along = p.clone().sub(a).dot(axis)
          return (
            along >= -1e-5 &&
            along <= length + 1e-5 &&
            p.distanceTo(a.clone().addScaledVector(axis, along)) <= 0.3
          )
        })
      }),
    ).toBe(true)
  }
}

function expectContinuousCover(geometry: BufferGeometry, edges: Edge[]) {
  for (const [a, b] of edges) {
    // Dense interior witnesses cross course joints, including the short final
    // course. Finite-triangle bounds above separately reject endpoint overruns.
    for (let sample = 1; sample < 256; sample++) {
      const p = a.clone().lerp(b, sample / 256)
      expect(capAt(geometry, p.x, p.z)).toBeGreaterThan(p.y)
    }
  }
}

test('caps are opt-in and gable caps occupy the finite ridge, not the perimeter', () => {
  const roof = segment()
  expect(RoofCovering.parse({ profile: 'tile' }).caps).toBeUndefined()
  expect(createRoofCoveringCapGeometry(roof, RoofCovering.parse({ profile: 'tile' }))).toBeNull()
  expect(createRoofCoveringCapGeometry(roof, { ...covering(), caps: false })).toBeNull()
  const before = JSON.stringify(roof)
  const geometry = createRoofCoveringCapGeometry(roof, covering())!
  try {
    expect(geometry).not.toBeNull()
    expectFiniteEdgeTriangles(geometry, gableEdges)
    expectContinuousCover(geometry, gableEdges)
    expect(capAt(geometry, 0, 2)).toBeUndefined()
    expect(capAt(geometry, 4, 1)).toBeUndefined()
    expect(capAt(geometry, 4.001, 0)).toBeUndefined()
    expect(capAt(geometry, -4.001, 0)).toBeUndefined()
    expect(JSON.stringify(roof)).toBe(before)
  } finally {
    geometry.dispose()
  }
})

test.each(['tile', 'slate'] as const)(
  '%s hip covers all five finite convex edges but no perimeter or face interior',
  (profile) => {
    const geometry = createRoofCoveringCapGeometry(segment('hip'), { ...covering(), profile })!
    try {
      expect(geometry).not.toBeNull()
      expectFiniteEdgeTriangles(geometry, hipEdges)
      expectContinuousCover(geometry, hipEdges)
      for (const [x, z] of [
        [0, 2],
        [0, -2],
        [4, 0],
        [-4, 0],
        [0, 1],
        [3, 0],
      ])
        expect(capAt(geometry, x!, z!)).toBeUndefined()
    } finally {
      geometry.dispose()
    }
  },
)

test('identical input produces identical portable buffers without sharing disposable geometry', () => {
  const a = createRoofCoveringCapGeometry(segment('hip'), covering())!
  const b = createRoofCoveringCapGeometry(segment('hip'), covering())!
  let otherDisposals = 0
  b.addEventListener('dispose', () => otherDisposals++)
  try {
    expect(a).not.toBe(b)
    for (const attribute of ['position', 'normal', 'uv']) {
      expect(Array.from(a.getAttribute(attribute).array)).toEqual(
        Array.from(b.getAttribute(attribute).array),
      )
      expect(Array.from(a.getAttribute(attribute).array).every(Number.isFinite)).toBe(true)
    }
    expect(a.index ? Array.from(a.index.array) : null).toEqual(
      b.index ? Array.from(b.index.array) : null,
    )
    a.dispose()
    expect(otherDisposals).toBe(0)
    expect(capAt(b, 0, 0)).toBeGreaterThan(2)
  } finally {
    b.dispose()
  }
})

test('512 courses are allowed, while the 513th and a combined hip budget overflow omit caps', () => {
  // Exactly 128 m / .25 m = 512 gable courses. Hip ridge alone is
  // 124 m / .25 m = 496, but its four sqrt(12) m hips exceed the budget.
  const finish = { ...covering(), course: 0.25 }
  const boundary = createRoofCoveringCapGeometry({ ...segment(), width: 128 }, finish)
  try {
    expect(boundary).not.toBeNull()
  } finally {
    boundary?.dispose()
  }
  expect(createRoofCoveringCapGeometry({ ...segment(), width: 128.25 }, finish)).toBeNull()
  expect(createRoofCoveringCapGeometry({ ...segment('hip'), width: 128 }, finish)).toBeNull()
})

test('trimmed, hosted, multi-segment and sibling contexts are explicitly unsupported, not bridged', () => {
  const roof = RoofNode.parse({ id: 'roof_caps', parentId: 'level_caps', children: ['rseg_caps'] })
  const level = LevelNode.parse({ id: 'level_caps', children: [roof.id] })
  const s = segment()
  const nodes = { [roof.id]: roof, [level.id]: level, [s.id]: s }
  expect(getRoofCoveringCapSegment(roof, nodes)).toBe(s)
  expect(
    getRoofCoveringCapSegment(roof, { ...nodes, [s.id]: { ...s, children: ['dormer_existing'] } }),
  ).toBeNull()
  expect(
    getRoofCoveringCapSegment(roof, {
      ...nodes,
      [s.id]: { ...s, trim: { ...s.trim, front: 0.2 } },
    }),
  ).toBeNull()
  // Intersecting segments can form valleys; disjoint collinear segments can
  // leave gaps. Neither assembly is permission to bridge an infinite plane.
  expect(getRoofCoveringCapSegment({ ...roof, children: [s.id, 'rseg_wing'] }, nodes)).toBeNull()
  const other = RoofNode.parse({ id: 'roof_other', parentId: level.id })
  expect(getRoofCoveringCapSegment(roof, { ...nodes, [other.id]: other })).toBeNull()
  for (const roofType of [
    'flat',
    'shed',
    'barrel',
    'conical',
    'gambrel',
    'mansard',
    'dutch',
  ] as const)
    expect(createRoofCoveringCapGeometry({ ...s, roofType }, covering())).toBeNull()
  expect(createRoofCoveringCapGeometry({ ...s, roofSystem: 'glazed' }, covering())).toBeNull()
  expect(
    createRoofCoveringCapGeometry({ ...s, arc: { centerX: 0, centerZ: 0, radius: 5 } }, covering()),
  ).toBeNull()
  expect(
    createRoofCoveringCapGeometry({ ...s, trim: { ...s.trim, front: 0.2 } }, covering()),
  ).toBeNull()
  for (const pitch of [0, Number.NaN, Number.POSITIVE_INFINITY])
    expect(createRoofCoveringCapGeometry({ ...s, pitch }, covering())).toBeNull()
})

test('resolved native gutter and downspout leave the same bounded ridge finish intact', () => {
  // Native drainage is outside the shell; it neither cuts faces nor creates
  // ridges. Adding it must preserve the analytical finite-ridge geometry.
  const scene = drainageScene()
  expect(getRoofCoveringCapSegment(scene.roof, scene.nodes)).toBe(scene.segment)
  expect(createRoofCoveringCapGeometry(scene.segment, covering())).toBeNull()
  const bare = createRoofCoveringCapGeometry(segment(), covering())!
  const drained = createRoofCoveringCapGeometry(scene.segment, covering(), scene.nodes)!
  try {
    expect(drained).not.toBeNull()
    expectFiniteEdgeTriangles(drained, gableEdges)
    expectContinuousCover(drained, gableEdges)
    for (const attribute of ['position', 'normal', 'uv'])
      expect(Array.from(drained.getAttribute(attribute).array)).toEqual(
        Array.from(bare.getAttribute(attribute).array),
      )
    expect(drained.index ? Array.from(drained.index.array) : null).toEqual(
      bare.index ? Array.from(bare.index.array) : null,
    )
    expect(
      createRoofCoveringCapGeometry(
        { ...scene.segment, width: 128.25 },
        { ...covering(), course: 0.25 },
        scene.nodes,
      ),
    ).toBeNull()
    expect(
      createRoofCoveringCapGeometry(
        { ...scene.segment, trim: { ...scene.segment.trim, front: 0.2 } },
        covering(),
        scene.nodes,
      ),
    ).toBeNull()
  } finally {
    bare?.dispose()
    drained?.dispose()
  }
})

test.each(['dormer', 'skylight', 'unknown', 'missing'] as const)(
  'native drainage does not authorize a %s child or bridge its possible shell cut',
  (kind) => {
    const scene = drainageScene()
    const childId = `${kind}_caps`
    const common = { id: childId, parentId: scene.segment.id, roofSegmentId: scene.segment.id }
    if (kind === 'dormer') scene.nodes[childId] = DormerNode.parse(common)
    if (kind === 'skylight') scene.nodes[childId] = SkylightNode.parse(common)
    if (kind === 'unknown') {
      // A future/plugin node has no established noncutting guarantee.
      scene.nodes[childId] = {
        ...common,
        type: 'plugin:roof-accessory',
        children: [],
      } as unknown as AnyNode
    }
    const s = { ...scene.segment, children: [...scene.segment.children, childId] }
    scene.nodes[s.id] = s
    expect(getRoofCoveringCapSegment(scene.roof, scene.nodes)).toBeNull()
    expect(createRoofCoveringCapGeometry(s, covering(), scene.nodes)).toBeNull()
  },
)

test('cap-only detail is one owned mesh, hidden far/veiled, forceable for export without changing source materials', () => {
  const geometry = new BoxGeometry(8, 1, 6)
  const materials = Array.from({ length: 7 }, () => new MeshStandardMaterial())
  for (const material of materials) material.userData.__pascalCachedMaterial = true
  const mesh = new Mesh(geometry, materials)
  const scene = drainageScene()
  const controller = new RoofCoveringDetail(mesh, materials, covering(), {
    segment: scene.segment,
    nodes: scene.nodes,
    roofSpace: true,
  })
  const camera = new PerspectiveCamera()
  let borrowedDisposals = 0
  geometry.addEventListener('dispose', () => borrowedDisposals++)
  for (const material of materials) material.addEventListener('dispose', () => borrowedDisposals++)
  try {
    camera.position.set(0, 2, 0)
    controller.update(camera)
    expect(mesh.children).toHaveLength(1)
    const cap = mesh.children[0] as Mesh
    let capDisposals = 0
    cap.geometry.addEventListener('dispose', () => capDisposals++)
    expect(cap.visible).toBe(true)
    expect(cap.material).toBe(materials[3]!)
    expect(mesh.geometry).toBe(geometry)
    expect(mesh.material).toBe(materials)
    controller.suspend()
    expect(cap.visible).toBe(false)
    camera.position.set(0, 100, 0)
    controller.update(camera)
    expect(cap.visible).toBe(false)
    controller.update(camera, true, true)
    expect(cap.visible).toBe(true)
    controller.update(camera, false, true)
    expect(cap.visible).toBe(false)
    camera.position.set(0, 2, 0)
    for (let cycle = 0; cycle < 3; cycle++) {
      controller.update(camera)
      expect(mesh.children).toEqual([cap])
      expect(cap.visible).toBe(true)
      controller.suspend()
      expect(cap.visible).toBe(false)
    }
    expect(capDisposals).toBe(0)
    controller.dispose()
    expect(mesh.children).toHaveLength(0)
    expect(capDisposals).toBe(1)
    expect(borrowedDisposals).toBe(0)
    expect(mesh.geometry).toBe(geometry)
    expect(mesh.material).toBe(materials)
    expect(materials.every((material) => material.userData.__pascalCachedMaterial)).toBe(true)
    controller.dispose()
    expect(capDisposals).toBe(1)
  } finally {
    controller.dispose()
    geometry.dispose()
    materials.forEach((m) => {
      m.dispose()
    })
  }
})

test('rebuilding the shell releases old caps, while veil and legacy detail never acquire extra caps', () => {
  const original = new BoxGeometry(8, 1, 4)
  const replacement = new BoxGeometry(8, 1, 4)
  const materials = Array.from({ length: 7 }, () => new MeshStandardMaterial())
  const veil = materials.map((material) => material.clone())
  const mesh = new Mesh(original, materials)
  const camera = new PerspectiveCamera()
  camera.position.set(0, 2, 0)
  const controller = new RoofCoveringDetail(mesh, materials, covering(), { segment: segment() })
  let sharedDisposals = 0
  let replacementDisposals = 0
  for (const material of materials) material.addEventListener('dispose', () => sharedDisposals++)
  replacement.addEventListener('dispose', () => replacementDisposals++)
  try {
    controller.update(camera)
    const first = mesh.children[0] as Mesh
    let firstDisposals = 0
    first.geometry.addEventListener('dispose', () => firstDisposals++)
    mesh.geometry = replacement
    controller.update(camera)
    expect(firstDisposals).toBe(1)
    expect(first.parent).toBeNull()
    expect(mesh.children).toHaveLength(1)
    const second = mesh.children[0] as Mesh
    expect(second).not.toBe(first)
    expect(second.visible).toBe(true)
    expectFiniteEdgeTriangles(second.geometry, gableEdges)
    let secondDisposals = 0
    second.geometry.addEventListener('dispose', () => secondDisposals++)
    controller.suspend()
    mesh.material = veil
    controller.update(camera)
    expect(second.visible).toBe(false)
    expect(mesh.material).toBe(veil)
    mesh.material = materials
    controller.update(camera)
    expect(second.visible).toBe(true)
    controller.dispose()
    expect(secondDisposals).toBe(1)
    expect(firstDisposals).toBe(1)
    expect(sharedDisposals).toBe(0)
    expect(replacementDisposals).toBe(0)
    expect(mesh.geometry).toBe(replacement)
    expect(mesh.children).toHaveLength(0)
    const legacy = new RoofCoveringDetail(
      mesh,
      materials,
      { ...covering(), caps: undefined },
      { segment: segment() },
    )
    try {
      legacy.update(camera, true, true)
      expect(mesh.children).toHaveLength(0)
      expect(mesh.geometry).toBe(replacement)
      expect(mesh.material).toBe(materials)
    } finally {
      legacy.dispose()
    }
  } finally {
    controller.dispose()
    replacement.dispose()
    for (const material of [...materials, ...veil]) material.dispose()
  }
})

test.each([false, true])(
  'caps use segment-local geometry and apply the merged-roof transform only for roofSpace=%s',
  (roofSpace) => {
    const s = {
      ...segment(),
      position: [10, 5, 30] as [number, number, number],
      rotation: Math.PI / 2,
    }
    const geometry = new BoxGeometry(8, 1, 4)
    const materials = Array.from({ length: 7 }, () => new MeshStandardMaterial())
    const mesh = new Mesh(geometry, materials)
    const controller = new RoofCoveringDetail(mesh, materials, covering(), {
      segment: s,
      roofSpace,
    })
    const camera = new PerspectiveCamera()
    try {
      controller.update(camera, true, true)
      expect(mesh.children).toHaveLength(1)
      const cap = mesh.children[0] as Mesh
      // R_y(π/2)(x,y,z)+(10,5,30) = (z+10,y+5,30-x).
      const edges: Edge[] = roofSpace
        ? [[new Vector3(10, 7, 34), new Vector3(10, 7, 26)]]
        : gableEdges
      expectFiniteEdgeTriangles(cap.geometry, edges)
      expectContinuousCover(cap.geometry, edges)
      expect(capAt(cap.geometry, roofSpace ? 0 : 10, roofSpace ? 0 : 30)).toBeUndefined()
    } finally {
      controller.dispose()
      geometry.dispose()
      materials.forEach((material) => {
        material.dispose()
      })
    }
  },
)
