import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  getGlazedRoofFaces,
  isIndependentRoofSegment,
  loadPlugin,
  nodeRegistry,
  RoofGlazing,
  RoofSegmentNode,
  SkylightNode,
  useLiveNodeOverrides,
  useScene,
  WindowNode,
} from '@pascal-app/core'
import {
  builtinPlugin,
  createGlazedRoofMaterials,
  createRoofGlazingPreview,
  glazedRoofGeometryAdapter,
} from '@pascal-app/nodes'
import {
  createSurfaceRoleMaterial,
  generateRoofSegmentGeometry,
  getRoofOuterSurfaceFrameAtPoint,
} from '@pascal-app/viewer'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const original = useScene.getState()
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(original)
})

function segment(patch: Partial<RoofSegmentNode> = {}) {
  return RoofSegmentNode.parse({
    id: 'rseg_glazing',
    roofType: 'gable',
    roofSystem: 'glazed',
    width: 4,
    depth: 4,
    pitch: 30,
    wallThickness: 0,
    overhang: 0,
    glazing: { across: { layout: 'count', count: 2 }, along: { layout: 'count', count: 1 } },
    ...patch,
  })
}

function rayHits(geometry: ReturnType<typeof generateRoofSegmentGeometry>, x: number, z: number) {
  const mesh = new Mesh(
    geometry,
    geometry.groups.length
      ? Array.from({ length: 4 }, () => new MeshBasicMaterial({ side: DoubleSide }))
      : new MeshBasicMaterial({ side: DoubleSide }),
  )
  const ray = new Raycaster(new Vector3(x, 20, z), new Vector3(0, -1, 0))
  return ray.intersectObject(mesh, false)
}

for (const roofType of ['gable', 'shed'] as const)
  test(`${roofType} uses glass panes with no opaque deck underneath`, () => {
    const node = segment({ roofType })
    const geometry = generateRoofSegmentGeometry(node)
    try {
      const hits = rayHits(geometry, -1, 1)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits.every((hit) => hit.face?.materialIndex === 1)).toBe(true)
      expect(hits[0]!.point.y).toBeCloseTo(getRoofOuterSurfaceFrameAtPoint(node, -1, 1).point.y)
      expect([...geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true)
      expect(geometry.groups.every((group) => (group.materialIndex ?? 0) < 4)).toBe(true)
    } finally {
      geometry.dispose()
    }
  })

test('an individual empty pane removes glass while retaining its frame', () => {
  const node = segment({
    glazing: RoofGlazing.parse({
      across: { layout: 'count', count: 2 },
      along: { layout: 'count', count: 1 },
      panels: [{ face: 'front', column: 0, row: 0, type: 'empty' }],
    }),
  })
  const geometry = generateRoofSegmentGeometry(node)
  try {
    expect(rayHits(geometry, -1, 1)).toHaveLength(0)
    expect(rayHits(geometry, 1, 1).length).toBeGreaterThan(0)
    expect(rayHits(geometry, 0, 1).some((hit) => hit.face?.materialIndex === 0)).toBe(true)
  } finally {
    geometry.dispose()
  }
})

test('trim cuts pane and frame geometry without changing their paint roles', () => {
  const node = segment({ trim: { ...segment().trim, right: 1 } })
  const geometry = generateRoofSegmentGeometry(node)
  try {
    expect(rayHits(geometry, 1.5, 1)).toHaveLength(0)
    expect(rayHits(geometry, -1, 1).every((hit) => hit.face?.materialIndex === 1)).toBe(true)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.max.x).toBeLessThanOrEqual(1.001)
  } finally {
    geometry.dispose()
  }
})

for (const roofType of ['gable', 'barrel'] as const)
  test(`${roofType} skylights cut panes and framing`, async () => {
    await loadPlugin(builtinPlugin)
    const node = segment({ roofType })
    const skylight = SkylightNode.parse({
      roofSegmentId: node.id,
      parentId: node.id,
      position: [-1, 0, 1],
      width: 0.6,
      height: 0.6,
    })
    const host = { ...node, children: [skylight.id] }
    const geometry = generateRoofSegmentGeometry(host, { [host.id]: host, [skylight.id]: skylight })
    try {
      expect(rayHits(geometry, -1, 1)).toHaveLength(0)
      expect(rayHits(geometry, 1, 1).length).toBeGreaterThan(0)
    } finally {
      geometry.dispose()
    }
  })

test('glass and frame paint are independent and only opaque members cast shadows', async () => {
  await loadPlugin(builtinPlugin)
  const node = segment({ slots: { 'glazing-frame': '#ff0000' } })
  const materials = createGlazedRoofMaterials(node, 'rendered')
  const mesh = new Mesh(generateRoofSegmentGeometry(node), materials.visible)
  const shadow = new Mesh()
  shadow.name = 'glazed-roof-shadow'
  mesh.add(shadow)
  try {
    expect(materials.visible[1]!.transparent).toBe(true)
    const paint = nodeRegistry.get('roof-segment')!.capabilities.paint!
    expect(paint.resolveRole({ node, materialIndex: 1 })).toBe('glazing-glass')
    const patch = paint.buildPatch({
      node,
      role: 'glazing-glass',
      material: undefined,
      materialPreset: '#00ff00',
    })
    expect(patch).toMatchObject({
      slots: { 'glazing-frame': '#ff0000', 'glazing-glass': '#00ff00' },
    })
    glazedRoofGeometryAdapter.syncGeometry(node, mesh)
    expect(rayHits(shadow.geometry, -1, 1)).toHaveLength(0)
    expect(rayHits(shadow.geometry, 0, 1).length).toBeGreaterThan(0)
  } finally {
    mesh.geometry.dispose()
    shadow.geometry.dispose()
    for (const material of materials.owned) material.dispose()
  }
})

test('a multi-segment glazing preview cancels cleanly and commits one undo step', () => {
  const first = segment(),
    second = segment({ id: 'rseg_glazing-second' })
  useScene.setState({
    nodes: { [first.id]: first, [second.id]: second } as Record<AnyNode['id'], AnyNode>,
  })
  useScene.temporal.getState().clear()
  const preview = createRoofGlazingPreview([first.id, second.id])
  preview.previewGlazing((config) => ({ ...config, frameWidth: 0.09 }))
  expect(useScene.getState().nodes[first.id]).toEqual(first)
  expect(useLiveNodeOverrides.getState().get(first.id)?.glazing).toMatchObject({ frameWidth: 0.09 })
  preview.cancel()
  expect(useLiveNodeOverrides.getState().get(first.id)).toBeUndefined()
  preview.previewGlazing((config) => ({ ...config, frameWidth: 0.1 }))
  preview.finish()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[first.id]).toEqual(first)
  expect(useScene.getState().nodes[second.id]).toEqual(second)
})

test('barrel panes follow the arch and standard barrel construction provides a solid covering', () => {
  const node = segment({ roofType: 'barrel', barrelRise: 1, barrelSegments: 12 })
  const geometry = generateRoofSegmentGeometry(node)
  const solid = generateRoofSegmentGeometry({ ...node, roofSystem: 'standard', wallThickness: 0.1 })
  try {
    const x = -1,
      z = 0.6
    const hits = rayHits(geometry, x, z)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.face?.materialIndex === 1)).toBe(true)
    const frame = getRoofOuterSurfaceFrameAtPoint(node, x, z)
    expect(hits[0]!.point.y).toBeCloseTo(frame.point.y)
    expect(frame.normal.y).toBeGreaterThan(0)
    expect(frame.normal.z).toBeGreaterThan(0)
    expect(rayHits(solid, x, z).some((hit) => hit.face?.materialIndex === 3)).toBe(true)
    expect([...geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true)
    expect(isIndependentRoofSegment({ ...node, roofSystem: 'standard' })).toBe(true)
  } finally {
    geometry.dispose()
    solid.dispose()
  }
})

test('barrel rise previews commit as one undo step and cancel restores the authored rise', () => {
  const node = segment({ roofType: 'barrel', barrelRise: 0.5 })
  useScene.setState({ nodes: { [node.id]: node }, rootNodeIds: [node.id] })
  useScene.temporal.getState().clear()
  const preview = createRoofGlazingPreview([node.id])
  preview.previewFields({ barrelRise: 0.8 })
  preview.previewFields({ barrelRise: 1 })
  expect((useScene.getState().nodes[node.id] as RoofSegmentNode).barrelRise).toBe(0.5)
  preview.finish()
  expect((useScene.getState().nodes[node.id] as RoofSegmentNode).barrelRise).toBe(1)
  useScene.temporal.getState().undo()
  expect((useScene.getState().nodes[node.id] as RoofSegmentNode).barrelRise).toBe(0.5)
  preview.previewFields({ barrelRise: 1.5 })
  preview.cancel()
  expect(useLiveNodeOverrides.getState().overrides.has(node.id)).toBe(false)
})

for (const roofSystem of ['standard', 'glazed'] as const)
  for (const overhang of [0, 0.3])
    for (const barrelRise of [1, 2])
      for (const wallHeight of [0, 0.5])
        test(`barrel ${roofSystem} corners stay distinct with ${overhang}m overhang, ${barrelRise}m rise and ${wallHeight}m walls`, () => {
          const node = segment({
            roofType: 'barrel',
            roofSystem,
            wallThickness: 0.1,
            overhang,
            barrelRise,
            wallHeight,
          })
          const geometry = generateRoofSegmentGeometry(node)
          try {
            let hits
            if (roofSystem === 'standard' && wallHeight > 0) {
              const mesh = new Mesh(
                geometry,
                Array.from({ length: 4 }, () => new MeshBasicMaterial({ side: DoubleSide })),
              )
              hits = new Raycaster(
                new Vector3(10, 0.23, 1.97),
                new Vector3(-1, 0, 0),
              ).intersectObject(mesh)
            } else {
              hits = rayHits(geometry, 1.97, 1.83)
            }
            expect(hits.length).toBeGreaterThan(0)
            const first = hits[0]!
            const coincident = hits.filter((hit) => Math.abs(hit.distance - first.distance) < 1e-6)
            expect(coincident).toHaveLength(1)
          } finally {
            geometry.dispose()
          }
        })

test('barrel end frame corners expose one face instead of overlapping border strips', () => {
  const node = segment({ roofType: 'barrel', wallThickness: 0.1, overhang: 0.3 })
  const face = getGlazedRoofFaces(node).find((face) => face.id === 'end-right')!
  const geometry = generateRoofSegmentGeometry(node)
  const mesh = new Mesh(
    geometry,
    Array.from({ length: 4 }, () => new MeshBasicMaterial({ side: DoubleSide })),
  )
  try {
    for (const corner of face.polygon) {
      const u = corner[0] + (face.width / 2 - corner[0]) * 0.001 + 0.00017
      const v = corner[1] + (face.length / 3 - corner[1]) * 0.001
      const hits = new Raycaster(
        new Vector3(10, face.origin[1] + v, face.origin[2] + u),
        new Vector3(-1, 0, 0),
      ).intersectObject(mesh)
      const endHits = hits.filter((hit) => Math.abs(hit.point.x - node.width / 2) < 1e-6)
      expect(endHits).toHaveLength(1)
    }
  } finally {
    geometry.dispose()
  }
})

for (const roofSystem of ['standard', 'glazed'] as const)
  test(`${roofSystem} barrel wall openings leave the covering intact`, async () => {
    await loadPlugin(builtinPlugin)
    const node = segment({ roofType: 'barrel', roofSystem, wallThickness: 0.1, wallHeight: 0.5 })
    const opening = WindowNode.parse({
      roofSegmentId: node.id,
      roofFace: 'right',
      parentId: node.id,
      position: [1.69, 1, 0],
      width: 1,
      height: 3,
    })
    const host = { ...node, children: [opening.id] }
    const geometry = generateRoofSegmentGeometry(host, { [host.id]: host, [opening.id]: opening })
    try {
      const hits = rayHits(geometry, 1.97, 0.31)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]!.face?.materialIndex).toBe(roofSystem === 'glazed' ? 1 : 3)
      const mesh = new Mesh(
        geometry,
        Array.from({ length: 4 }, () => new MeshBasicMaterial({ side: DoubleSide })),
      )
      const wallHits = new Raycaster(
        new Vector3(10, 0.6, 0.31),
        new Vector3(-1, 0, 0),
      ).intersectObject(mesh)
      expect(wallHits.some((hit) => hit.point.x > 1.8)).toBe(false)
    } finally {
      geometry.dispose()
    }
  })

test('glazed appearance follows palettes and debug mode without mutating shared materials', () => {
  const node = segment({ slots: { 'glazing-frame': '#ff0000' } })
  const palette = createGlazedRoofMaterials(
    node,
    'solid',
    {},
    { textures: false, colorPreset: 'blueprint', sceneTheme: 'dark' },
  )
  const cached = createSurfaceRoleMaterial('roof', 'blueprint', undefined, 'dark')
  const debug = createGlazedRoofMaterials(node, 'rendered', {}, { debugColors: true })
  try {
    expect((palette.visible[0] as MeshBasicMaterial).color.getHex()).toBe(
      (cached as MeshBasicMaterial).color.getHex(),
    )
    expect(palette.visible[0]).not.toBe(cached)
    expect(palette.visible[1]!.transparent).toBe(true)
    expect(palette.visible[1]!.opacity).toBe(node.glazing!.glassOpacity)
    expect(debug.visible[1]!.transparent).toBe(false)
    expect(debug.visible[1]!.opacity).toBe(1)
  } finally {
    for (const material of [...palette.owned, ...debug.owned]) material.dispose()
  }
})
