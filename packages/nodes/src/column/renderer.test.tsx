import { expect, test } from 'bun:test'
import { COLUMN_PRESETS, ColumnNode, sceneRegistry, useScene } from '@pascal-app/core'
import { OVERLAY_LAYER, useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import { Box3, type Mesh, Raycaster, Vector3 } from 'three'
import { installMountedScene, mount } from '../__tests__/harness'
import { columnFootprintHalf } from './bounds'
import { createColumnSpiralGeometry } from './geometry'
import { clearColumnInspectorHighlight, setColumnInspectorHighlight } from './inspector-highlight'
import { ColumnRenderer } from './renderer'

installMountedScene()
const frames = [
  'a-frame',
  'y-frame',
  'v-frame',
  'x-brace',
  'k-brace',
  'single-strut',
  'tripod',
  'trestle',
  'portal-frame',
  'box-frame',
] as const
const examples = [
  ...Object.entries(COLUMN_PRESETS).map(([name, preset]) => ({
    name,
    node: ColumnNode.parse(preset),
  })),
  {
    name: 'twisted decorated rectangular',
    node: ColumnNode.parse({
      crossSection: 'rectangular',
      shaftProfile: 'bulged',
      shaftBulge: 0.4,
      shaftTwistStep: 12,
      shaftStartScale: 1.6,
      shaftEndScale: 1.2,
      ringCount: 6,
      latheRingCount: 8,
      lowerBandEnabled: true,
      carvingPlacement: 'all',
      panelCount: 4,
      spiralRibCount: 2,
      spiralTwist: 1,
    }),
  },
  ...frames.map((supportStyle) => ({
    name: supportStyle,
    node: ColumnNode.parse({
      supportStyle,
      braceBottomSpread: 4,
      braceTopSpread: 3,
      braceWidth: 0.7,
      braceDepth: 0.6,
    }),
  })),
]
for (const { name, node } of examples) {
  test(`${name} collision envelope contains its rendered geometry`, async () => {
    useScene.setState({ nodes: { [node.id]: node } })
    await mount(<ColumnRenderer node={node} />)
    const root = sceneRegistry.nodes.get(node.id)!
    root.updateMatrixWorld(true)
    const actual = new Box3().setFromObject(root, true)
    const bounds = columnFootprintHalf(node)
    expect(actual.min.x).toBeGreaterThanOrEqual(-bounds.halfX - 1e-6)
    expect(actual.max.x).toBeLessThanOrEqual(bounds.halfX + 1e-6)
    expect(actual.min.z).toBeGreaterThanOrEqual(-bounds.halfZ - 1e-6)
    expect(actual.max.z).toBeLessThanOrEqual(bounds.halfZ + 1e-6)
  })
}
test('resizing and unmounting releases owned geometry without disposing shared materials', async () => {
  const node = ColumnNode.parse({ crossSection: 'rectangular', shaftProfile: 'tapered' })
  useScene.setState({ nodes: { [node.id]: node } })
  const renderer = await mount(<ColumnRenderer node={node} />)
  const geometries = new Set<Mesh['geometry']>()
  const materials = new Set<Mesh['material']>()
  sceneRegistry.nodes.get(node.id)!.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh) {
      geometries.add(mesh.geometry)
      materials.add(mesh.material)
    }
  })
  const disposed = new Set<Mesh['geometry']>()
  let disposedMaterials = 0
  for (const geometry of geometries)
    geometry.addEventListener('dispose', () => disposed.add(geometry))
  for (const material of materials)
    for (const entry of Array.isArray(material) ? material : [material])
      entry.addEventListener('dispose', () => disposedMaterials++)
  await renderer.update(<ColumnRenderer node={{ ...node, height: 4, width: 0.8, depth: 0.7 }} />)
  expect(disposed.size).toBeGreaterThan(0)
  await renderer.unmount()
  expect(disposed.size).toBe(geometries.size)
  expect(disposedMaterials).toBe(0)
})

for (const crossSection of ['round', 'rectangular', 'octagonal'] as const) {
  test(`${crossSection} tapered shaft is continuous and ends at the declared top`, async () => {
    const node = ColumnNode.parse({
      crossSection,
      baseStyle: 'none',
      capitalStyle: 'none',
      shaftProfile: 'tapered',
      shaftStartScale: 1,
      shaftEndScale: 0.5,
      shaftTaper: 0,
      shaftSegmentCount: 8,
      shaftCornerRadius: 0,
      shaftDetail: 'none',
      ringCount: 0,
      height: 4,
      radius: 0.5,
      width: 1,
      depth: 1,
    })
    useScene.setState({ nodes: { [node.id]: node } })
    await mount(<ColumnRenderer node={node} />)
    const root = sceneRegistry.nodes.get(node.id)!
    root.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(root, true)
    expect(bounds.max.y).toBeCloseTo(4, 6)
    const top = new Raycaster(new Vector3(0.1, 5, 0), new Vector3(0, -1, 0)).intersectObject(
      root,
      true,
    )
    expect(top[0]!.point.y).toBeCloseTo(4, 6)
    // Adjacent samples must follow the same slope through a former section boundary.
    const hits = [1.999, 2, 2.001].map(
      (y) =>
        new Raycaster(new Vector3(2, y, 0), new Vector3(-1, 0, 0)).intersectObject(root, true)[0]!
          .point.x,
    )
    expect(hits[0]! - hits[2]!).toBeCloseTo(0.000125, 5)
    expect(hits[1]).toBeCloseTo(0.375, 5)
  })
}

test('flutes recess into a tapered shaft rather than adding rods', async () => {
  const node = ColumnNode.parse({
    baseStyle: 'none',
    capitalStyle: 'none',
    radius: 0.5,
    shaftProfile: 'tapered',
    shaftStartScale: 1,
    shaftEndScale: 0.5,
    shaftTaper: 0,
    shaftDetail: 'fluted',
    fluteCount: 16,
    fluteDepth: 0.04,
    fluteWidth: 0.08,
    ringCount: 0,
    height: 4,
  })
  useScene.setState({ nodes: { [node.id]: node } })
  await mount(<ColumnRenderer node={node} />)
  const root = sceneRegistry.nodes.get(node.id)!
  root.updateMatrixWorld(true)
  const groove = new Raycaster(new Vector3(2, 2, 0), new Vector3(-1, 0, 0)).intersectObject(
    root,
    true,
  )[0]!
  expect(groove.point.x).toBeCloseTo(0.375 - 0.04, 5)
  const angle = Math.PI / 16
  const direction = new Vector3(Math.cos(angle), 0, Math.sin(angle))
  const crest = new Raycaster(
    direction.clone().multiplyScalar(2).setY(2),
    direction.clone().negate(),
  ).intersectObject(root, true)[0]!
  expect(Math.hypot(crest.point.x, crest.point.z)).toBeCloseTo(0.375, 5)
})

test('spiral rib centers follow the bulged and twisted shaft surface', () => {
  const node = ColumnNode.parse({
    radius: 0.5,
    shaftProfile: 'bulged',
    shaftBulge: 0.2,
    shaftStartScale: 0.8,
    shaftEndScale: 0.4,
    shaftTaper: 0,
    shaftTwistStep: 10,
    shaftSegmentCount: 24,
    spiralRibCount: 1,
    spiralTwist: 1,
    shaftDetail: 'none',
    fluteCount: 0,
  })
  const geometry = createColumnSpiralGeometry(node, 4)!
  const positions = geometry.getAttribute('position')
  // Six tube vertices surround each center; the seventh duplicates its UV seam.
  const row = 24,
    center = new Vector3()
  for (let j = 0; j < 6; j++) center.add(new Vector3().fromBufferAttribute(positions, row * 7 + j))
  center.multiplyScalar(1 / 6)
  const t = center.y / 4
  expect(t).toBeGreaterThan(0.45)
  expect(t).toBeLessThan(0.55)
  expect(Math.hypot(center.x, center.z)).toBeCloseTo(
    0.5 * (0.8 - 0.4 * t + 0.2 * Math.sin(Math.PI * t)),
    3,
  )
  expect(Math.atan2(center.z, center.x)).toBeCloseTo(
    ((t - 0.02) / 0.96) * Math.PI * 2 - (t * 230 * Math.PI) / 180,
    3,
  )
  geometry.dispose()
})

for (const edgeSoftness of [0, 0.04]) {
  test(`shaft end softness ${edgeSoftness} preserves its envelope and planar top`, async () => {
    const node = ColumnNode.parse({
      baseStyle: 'none',
      capitalStyle: 'none',
      radius: 0.5,
      shaftProfile: 'straight',
      shaftStartScale: 1,
      shaftEndScale: 1,
      shaftTaper: 0,
      fluteCount: 0,
      ringCount: 0,
      edgeSoftness,
      height: 3,
    })
    useScene.setState({ nodes: { [node.id]: node } })
    await mount(<ColumnRenderer node={node} />)
    const root = sceneRegistry.nodes.get(node.id)!
    root.updateMatrixWorld(true)
    const box = new Box3().setFromObject(root, true)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(3, 6)
    expect(box.max.x).toBeCloseTo(0.5, 6)
    const ray = (x: number) =>
      new Raycaster(new Vector3(x, 4, 0), new Vector3(0, -1, 0)).intersectObject(root, true)[0]!
    expect(ray(0.1).point.y).toBeCloseTo(3, 6)
    if (edgeSoftness) expect(ray(0.49).point.y).toBeLessThan(2.999)
    else expect(ray(0.49).point.y).toBeCloseTo(3, 6)
  })
}

test('lotus neck reaches the shaft without an air gap', async () => {
  const node = ColumnNode.parse({
    baseStyle: 'lotus',
    baseHeight: 0.5,
    baseRibCount: 0,
    capitalStyle: 'none',
    edgeSoftness: 0,
    ringCount: 0,
  })
  useScene.setState({ nodes: { [node.id]: node } })
  await mount(<ColumnRenderer node={node} />)
  const root = sceneRegistry.nodes.get(node.id)!
  root.updateMatrixWorld(true)
  for (const y of [0.495, 0.505]) {
    expect(
      new Raycaster(new Vector3(2, y, 0), new Vector3(-1, 0, 0)).intersectObject(root, true).length,
    ).toBeGreaterThan(0)
  }
})

test('inspector hover isolates the named part without changing materials, picking, or scene data', async () => {
  const node = ColumnNode.parse({ baseStyle: 'simple-square', capitalStyle: 'simple' })
  useScene.setState({ nodes: { [node.id]: node } })
  const renderer = await mount(<ColumnRenderer node={node} />)
  const root = sceneRegistry.nodes.get(node.id)!
  const originals: Mesh[] = []
  root.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh) originals.push(mesh)
  })
  const materials = originals.map((mesh) => mesh.material)
  const nodes = useScene.getState().nodes
  const boundsBefore = new Box3().setFromObject(root, true)
  const owner = Symbol('inspector test')
  try {
    await act(async () => setColumnInspectorHighlight(owner, node.id, { part: 'base', axis: 'y' }))
    const highlights: Mesh[] = []
    root.parent!.getObjectByName('column-inspector-highlight')!.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.isMesh && mesh.layers.isEnabled(OVERLAY_LAYER)) highlights.push(mesh)
    })
    expect(highlights.length).toBeGreaterThan(0)
    for (const mesh of highlights) {
      expect(
        originals.some(
          (original) => original.userData.slotId === 'base' && original.geometry === mesh.geometry,
        ),
      ).toBe(true)
      expect(mesh.userData.pascalExport).toBe('strip')
      const hits: ReturnType<Raycaster['intersectObject']> = []
      mesh.raycast(new Raycaster(), hits)
      expect(hits).toHaveLength(0)
    }
    expect(originals.map((mesh) => mesh.material)).toEqual(materials)
    expect(useScene.getState().nodes).toBe(nodes)
    expect(new Box3().setFromObject(root, true)).toEqual(boundsBefore)
    expect(useViewer.getState().hoveredId).toBe(node.id)
    await act(async () => clearColumnInspectorHighlight(Symbol('another inspector')))
    expect(
      root.parent!.getObjectByName('column-inspector-highlight')!.children.length,
    ).toBeGreaterThan(0)
    let disposed = 0
    for (const mesh of originals) mesh.geometry.addEventListener('dispose', () => disposed++)
    await act(async () => clearColumnInspectorHighlight(owner))
    expect(root.parent!.getObjectByName('column-inspector-highlight')!.children).toHaveLength(0)
    expect(useViewer.getState().hoveredId).toBeNull()
    expect(disposed).toBe(0)
  } finally {
    clearColumnInspectorHighlight(owner)
    await renderer.unmount()
  }
})
