import { expect, test } from 'bun:test'
import {
  COLUMN_PRESETS,
  ColumnNode,
  clearSceneHistory,
  columnSlots,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Mesh, MeshBasicMaterial } from 'three'
import { installMountedScene, mount } from '../__tests__/harness'
import { columnPaint } from './paint'
import { columnPresetUpdates } from './presets'
import { ColumnRenderer } from './renderer'

installMountedScene()
const paint = {
  preset: 'custom' as const,
  properties: {
    color: '#da3210',
    roughness: 0.5,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front' as const,
  },
}
const cases = [
  ...Object.entries(COLUMN_PRESETS).map(([name, preset]) => ({
    name,
    node: ColumnNode.parse(preset),
  })),
  ...['fluted', 'spiral', 'panelled', 'lathe-turned'].map((shaftDetail) => ({
    name: shaftDetail,
    node: ColumnNode.parse({
      shaftDetail,
      shaftProfile: 'bulged',
      fluteCount: shaftDetail === 'fluted' ? 16 : 0,
      spiralTwist: 1,
      ringCount: 4,
      lowerBandEnabled: true,
      baseStyle: 'ribbed-lotus',
      capitalStyle: 'corinthian-leaf',
    }),
  })),
]
for (const { name, node } of cases) {
  test(`${name}: every rendered surface has UVs and an isolated, reversible paint slot`, async () => {
    useViewer.setState({ textures: true })
    useScene.setState({ nodes: { [node.id]: node }, materials: {} })
    await mount(<ColumnRenderer node={node} />)
    const root = sceneRegistry.nodes.get(node.id)!
    const meshes: Mesh[] = []
    root.traverse((object) => {
      if (object instanceof Mesh) meshes.push(object)
    })
    expect(meshes.length).toBeGreaterThan(0)
    const slots = columnSlots(node).map((slot) => slot.slotId)
    for (const mesh of meshes) {
      expect(slots).toContain(mesh.userData.slotId)
      expect(mesh.geometry.getAttribute('uv').count).toBe(
        mesh.geometry.getAttribute('position').count,
      )
    }
    const baseline = meshes.map((mesh) => mesh.material)
    const child = new Mesh(undefined, new MeshBasicMaterial())
    child.userData.slotId = meshes[0]!.userData.slotId
    root.add(child)
    const childMaterial = child.material
    for (const role of new Set(meshes.map((mesh) => mesh.userData.slotId))) {
      const restore = columnPaint.applyPreview({
        node,
        role,
        root,
        material: paint,
        materialPreset: undefined,
      })
      expect(restore).not.toBeNull()
      meshes.forEach((mesh, i) => {
        if (mesh.userData.slotId === role) expect(mesh.material).not.toBe(baseline[i])
        else expect(mesh.material).toBe(baseline[i])
      })
      expect(child.material).toBe(childMaterial)
      restore?.()
      meshes.forEach((mesh, i) => {
        expect(mesh.material).toBe(baseline[i])
      })
    }
    root.remove(child)
    child.geometry.dispose()
    childMaterial.dispose()
  })
}

test('eraser preview restores a legacy whole-pillar finish and can be cancelled', async () => {
  const node = ColumnNode.parse({ material: paint, slots: { shaft: 'library:metal-steel' } })
  useViewer.setState({ textures: true })
  useScene.setState({ nodes: { [node.id]: node }, materials: {} })
  await mount(<ColumnRenderer node={node} />)
  const root = sceneRegistry.nodes.get(node.id)!
  let shaft: Mesh | undefined
  root.traverse((object) => {
    if (object instanceof Mesh && object.userData.slotId === 'shaft') shaft = object
  })
  const original = shaft!.material
  const restore = columnPaint.applyPreview({
    node,
    role: 'shaft',
    root,
    material: undefined,
    materialPreset: undefined,
  })
  expect((shaft!.material as MeshBasicMaterial).color.getHexString()).toBe('da3210')
  restore?.()
  expect(shaft!.material).toBe(original)
})

test('committed paint survives preset changes and scene serialization, with one-step undo', async () => {
  const node = ColumnNode.parse({})
  useViewer.setState({ textures: true })
  useScene.setState({ nodes: { [node.id]: node }, materials: {}, readOnly: false })
  clearSceneHistory()
  columnPaint.commit?.({ node, role: 'shaft', material: paint, materialPreset: undefined })
  const painted = useScene.getState().nodes[node.id] as ColumnNode
  expect(painted.slots?.shaft).toStartWith('scene:')
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const restored = ColumnNode.parse(
    JSON.parse(
      JSON.stringify({
        ...painted,
        ...columnPresetUpdates('basicPillar'),
        shaftDetail: 'fluted',
        fluteCount: 16,
      }),
    ),
  )
  useScene.setState({ nodes: { [node.id]: restored } })
  await mount(<ColumnRenderer node={restored} />)
  const root = sceneRegistry.nodes.get(node.id)!
  let count = 0
  root.traverse((object) => {
    if (object instanceof Mesh && object.userData.slotId === 'shaft') {
      expect((object.material as MeshBasicMaterial).color.getHexString()).toBe('da3210')
      count++
    }
  })
  expect(count).toBeGreaterThan(0)
  useScene.temporal.getState().undo()
  useScene.temporal.getState().undo()
  expect((useScene.getState().nodes[node.id] as ColumnNode).slots).toBeUndefined()
})
