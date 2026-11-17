import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  LevelNode,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { RoofSystem, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import type { Mesh } from 'three'
import { builtinPlugin } from '../index'
import { RoofRenderer } from './renderer'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}
let renderer: Awaited<ReturnType<typeof create>> | undefined
let restoreRegistry: () => void
let oldScene: ReturnType<typeof useScene.getState>
let oldViewer: ReturnType<typeof useViewer.getState>
beforeEach(() => {
  oldScene = useScene.getState()
  oldViewer = useViewer.getState()
  restoreRegistry = nodeRegistry._snapshot()
  for (const definition of builtinPlugin.nodes ?? []) registerNode(definition)
})
afterEach(async () => {
  emitter.emit('thumbnail:after-capture')
  await renderer?.unmount()
  renderer = undefined
  restoreRegistry()
  useScene.setState(oldScene)
  useViewer.setState(oldViewer)
  sceneRegistry.clear()
})
const top = (mesh: Mesh) => (mesh.material as any[])[3]
async function frames(count = 2) {
  await act(async () => {
    await renderer!.advanceFrames(count, 1 / 60)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
async function setup() {
  const level = LevelNode.parse({
    id: 'level_covercapture',
    height: 3,
    children: ['roof_covercapture'],
  })
  const roof = RoofNode.parse({
    id: 'roof_covercapture',
    parentId: level.id,
    children: ['rseg_covercapture'],
    topMaterial: { properties: { color: '#8c5140', roughness: 0.9 } },
    covering: {
      profile: 'tile',
      width: 0.3,
      course: 0.32,
      relief: 0.008,
      distance: 20,
      caps: true,
    },
  })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_covercapture',
    parentId: roof.id,
    roofType: 'hip',
    width: 8,
    depth: 6,
    pitch: 35,
    wallHeight: 1,
  })
  useScene
    .getState()
    .setScene(
      Object.fromEntries([level, roof, segment].map((n) => [n.id, n])) as Record<
        AnyNodeId,
        AnyNode
      >,
      [level.id],
      { installedPlugins: [], hasExplicitPluginInstallState: false },
    )
  useViewer.setState({
    wallMode: 'up',
    isExporting: false,
    hideLevelsAboveSelection: true,
    levelMode: 'stacked',
    nodesRevealing: [],
    selection: { ...useViewer.getState().selection, levelId: level.id, selectedIds: [] },
  })
  renderer = await create(
    <>
      <RoofRenderer node={roof} />
      <RoofSystem />
    </>,
    { camera: { position: [80, 50, 80] } },
  )
  let mesh: Mesh | undefined
  for (let i = 0; i < 20; i++) {
    await frames()
    mesh = sceneRegistry.nodes.get(roof.id)?.getObjectByName('merged-roof') as Mesh | undefined
    if ((mesh?.geometry.getAttribute('position')?.count ?? 0) > 3) break
  }
  expect(mesh?.geometry.getAttribute('position').count).toBeGreaterThan(3)
  await frames()
  expect(top(mesh!).normalMap).toBeNull()
  return { level, roof, mesh: mesh! }
}
function expectForced(mesh: Mesh) {
  expect(top(mesh).normalMap).not.toBeNull()
  expect(top(mesh).maskNode).toBeNull()
  expect(top(mesh).opacity).toBe(1)
  expect(mesh.geometry.getAttribute('uv3').count).toBeGreaterThan(3)
  expect(mesh.getObjectByName('roof-covering-caps')?.visible).toBe(true)
}
describe('real RoofRenderer capture events and covering hook', () => {
  test('an export capture from a far viewport holds the near detail and restores it after', async () => {
    const { roof, mesh } = await setup()
    const geometry = mesh.geometry,
      materials = mesh.material
    // Export's documented sequence sets the store, then emits the capture event.
    useViewer.setState({ isExporting: true })
    emitter.emit('thumbnail:before-capture', undefined)
    expectForced(mesh) // No intervening frame: screenshot/clone consumers act in this tick.
    const cloned = sceneRegistry.nodes
      .get(roof.id)!
      .clone(true)
      .getObjectByName('merged-roof') as Mesh
    expectForced(cloned)
    await frames(3)
    expectForced(mesh)
    emitter.emit('thumbnail:after-capture')
    useViewer.setState({ isExporting: false })
    expect(mesh.geometry).toBe(geometry)
    expect(mesh.material).toBe(materials)
    expect(top(mesh).normalMap).toBeNull()
    expect(mesh.getObjectByName('roof-covering-caps')?.visible ?? false).toBe(false)
    await frames()
    expect(top(mesh).normalMap).toBeNull()
  })

  test('an ordinary thumbnail keeps the far viewport finish', async () => {
    const { mesh } = await setup()
    const geometry = mesh.geometry,
      materials = mesh.material
    emitter.emit('thumbnail:before-capture', { wholeWalls: true })
    expect(mesh.geometry).toBe(geometry)
    expect(mesh.material).toBe(materials)
    expect(top(mesh).normalMap).toBeNull()
    emitter.emit('thumbnail:after-capture')
  })
})
