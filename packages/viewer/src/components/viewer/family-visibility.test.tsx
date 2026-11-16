import { expect, test } from 'bun:test'
import { nodeRegistry, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { useViewer } from '../../index'
import { SceneRenderer } from '../renderers/scene-renderer'

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
