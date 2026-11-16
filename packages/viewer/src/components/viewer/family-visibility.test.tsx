import { expect, test } from 'bun:test'
import { nodeRegistry, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { useViewer } from '../../index'
import { SceneRenderer } from '../renderers/scene-renderer'
import { LiveFamilyVisibility } from './family-visibility'

test('live family isolation follows newly mounted semantic roots and preserves hosted children', async () => {
  const previousViewer = useViewer.getState()
  const previousScene = useScene.getState()
  const restoreRegistry = nodeRegistry._snapshot()
  for (const [kind, family] of [
    ['wall', 'walls'],
    ['item', 'items'],
  ] as const)
    nodeRegistry._register({
      kind,
      schemaVersion: 1,
      extensions: { 'pascal:viewer': { family } },
    } as never)
  const root = new Group()
  const wall = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  const item = new Mesh(new BoxGeometry(), wall.material)
  wall.name = 'wall'
  item.name = 'item'
  root.add(wall)
  wall.add(item)
  sceneRegistry.nodes.set('wall_xray', wall)
  sceneRegistry.nodes.set('item_xray', item)
  useScene.setState({
    nodes: {
      wall_xray: { id: 'wall_xray', type: 'wall' },
      item_xray: { id: 'item_xray', type: 'item' },
    },
    rootNodeIds: [],
  } as never)
  useViewer.setState({ xrayFamily: null, walkthroughMode: false })
  const draws: string[][] = []
  function Draw() {
    useFrame(() => {
      const visible: string[] = []
      root.traverse((object) => {
        if (object instanceof Mesh && object.layers.isEnabled(0)) visible.push(object.name)
      })
      draws.push(visible)
    }, 1)
    return null
  }
  const renderer = await create(
    <>
      <Draw />
      <SceneRenderer />
      <primitive object={root} />
    </>,
  )
  try {
    const original = wall.layers.mask
    await renderer.advanceFrames(1, 1 / 60)
    expect(wall.layers.mask).toBe(original)
    await act(async () => useViewer.getState().setXrayFamily('items'))
    expect(wall.layers.isEnabled(0)).toBe(false)
    expect(wall.visible).toBe(true)
    expect(item.layers.isEnabled(0)).toBe(true)
    // Accessing children measures the family walker without depending on its implementation.
    const children = wall.children
    let visits = 0
    Object.defineProperty(wall, 'children', {
      configurable: true,
      get: () => {
        visits++
        return children
      },
    })
    await renderer.advanceFrames(1, 1 / 60)
    const first = visits
    await renderer.advanceFrames(1, 1 / 60)
    expect(visits - first).toBe(1) // Draw's traversal only.
    Object.defineProperty(wall, 'children', { configurable: true, value: children })
    const late = new Mesh(new BoxGeometry(), wall.material)
    late.name = 'late'
    root.add(late)
    sceneRegistry.nodes.set('wall_late', late)
    useScene.setState({
      nodes: { ...useScene.getState().nodes, wall_late: { id: 'wall_late', type: 'wall' } },
    } as never)
    await renderer.advanceFrames(1, 1 / 60)
    expect(late.layers.isEnabled(0)).toBe(false)
    expect(draws.at(-1)).toEqual(['item'])
    await act(async () => useViewer.getState().setWalkthroughMode(true))
    expect(wall.layers.mask).toBe(original)
    await act(async () => useViewer.getState().setWalkthroughMode(false))
    expect(wall.layers.isEnabled(0)).toBe(false)
    await act(async () => useViewer.getState().setXrayFamily(null))
    expect(wall.layers.mask).toBe(original)
    expect(late.layers.mask).toBe(original)
  } finally {
    await renderer.unmount()
    useViewer.setState(previousViewer, true)
    useScene.setState(previousScene)
    sceneRegistry.clear()
    restoreRegistry()
  }
})

test('section portals keep live and baked site family ownership', async () => {
  const { SiteSurfaceScope, BakedSiteSurfaces, bakedSiteSurfaceScopes } = await import(
    './site-surface-scope'
  )
  const { LiveFamilyVisibility } = await import('./family-visibility')
  const { SectionGroup } = await import('./section-group')
  const { createFamilyVisibility } = await import('../../lib/xray')
  const previousViewer = useViewer.getState()
  const previousScene = useScene.getState()
  const restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._register({
    kind: 'site',
    schemaVersion: 1,
    extensions: { 'pascal:viewer': { family: 'site' } },
  } as never)
  const node = { id: 'site_family_cut', type: 'site' } as never
  useScene.setState({ nodes: { site_family_cut: node } })
  useViewer.setState({ sectionEnabled: false, walkthroughMode: false, xrayFamily: 'walls' })
  const site = new Group()
  site.userData = { kind: 'site', pascalId: 'site_family_cut' }
  const ground = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  site.add(ground)
  sceneRegistry.nodes.set('site_family_cut', site)
  const renderer = await create(
    <>
      <LiveFamilyVisibility />
      <SectionGroup>
        <primitive object={site} />
        <BakedSiteSurfaces scopes={bakedSiteSurfaceScopes(site)} />
        <SiteSurfaceScope siteId="site_family_cut" object={() => site}>
          <mesh name="live-lot" />
        </SiteSurfaceScope>
      </SectionGroup>
    </>,
  )
  const visibility = createFamilyVisibility()
  try {
    await renderer.advanceFrames(1, 0.01)
    expect(ground.layers.isEnabled(0)).toBe(false)
    await act(async () => useViewer.getState().setSectionEnabled(true))
    await renderer.advanceFrames(1, 0.01)
    expect(renderer.scene.findByProps({ name: 'live-lot' }).instance.layers.isEnabled(0)).toBe(
      false,
    )
    expect(ground.layers.isEnabled(0)).toBe(false)
    // The baked resolver reads semantic IDs, without hydrating the live store.
    visibility.update(
      renderer.scene.instance,
      (object) => (object.userData.pascalId === 'site_family_cut' ? node : undefined),
      useViewer.getState(),
    )
    expect(ground.layers.isEnabled(0)).toBe(false)
    expect(renderer.scene.findByProps({ name: 'live-lot' }).instance.layers.isEnabled(0)).toBe(
      false,
    )
  } finally {
    visibility.clear()
    await renderer.unmount()
    sceneRegistry.nodes.delete('site_family_cut')
    restoreRegistry()
    useViewer.setState(previousViewer, true)
    useScene.setState(previousScene)
  }
})

test('the internal site ownership hook is absent from the public entry', async () => {
  const entry = await import('../../index')
  expect('useSiteSurfaceOwner' in entry).toBe(false)
})

test('live registered geometry without a family is other while excluded annotations remain visible', async () => {
  const restore = nodeRegistry._snapshot()
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  const root = new Group()
  const meshes = ['trees:tree', 'test:plugin', 'measurement', 'level'].map((type, index) => {
    const object = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    const id = `family_${index}` as never
    root.add(object)
    sceneRegistry.nodes.set(id, object)
    return { object, node: { id, type } }
  })
  nodeRegistry._register({ kind: 'test:plugin', schemaVersion: 1 } as never)
  for (const kind of ['measurement', 'level'])
    nodeRegistry._register({
      kind,
      schemaVersion: 1,
      renderer: () => null,
      extensions: { 'pascal:viewer': { family: null } },
    } as never)
  useScene.setState({
    nodes: Object.fromEntries(meshes.map(({ node }) => [node.id, node])),
    rootNodeIds: [],
  } as never)
  useViewer.setState({ xrayFamily: 'walls', walkthroughMode: false })
  const renderer = await create(
    <>
      <LiveFamilyVisibility />
      <primitive object={root} />
    </>,
  )
  try {
    await renderer.advanceFrames(1, 0.01)
    expect(meshes.map(({ object }) => object.layers.isEnabled(0))).toEqual([
      false,
      false,
      true,
      true,
    ])
    await act(async () => useViewer.getState().setXrayFamily('other'))
    expect(meshes.every(({ object }) => object.layers.isEnabled(0))).toBe(true)
    const empty = new Group()
    root.add(empty)
    sceneRegistry.nodes.set('family_empty' as never, empty)
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        family_empty: { id: 'family_empty', type: 'trees:empty' },
      },
    } as never)
    await act(async () => useViewer.getState().setXrayFamily('walls'))
    await renderer.advanceFrames(1, 0.01)
    expect(empty.layers.isEnabled(0)).toBe(true)
  } finally {
    await renderer.unmount()
    for (const { node } of meshes) sceneRegistry.nodes.delete(node.id)
    sceneRegistry.nodes.delete('family_empty' as never)
    restore()
    useScene.setState(previousScene, true)
    useViewer.setState(previousViewer, true)
  }
})
