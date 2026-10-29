import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { Group, type PointLight, type SpotLight, Vector3 } from 'three'
import { useItemLightPool } from '../../store/use-item-light-pool'
import useViewer from '../../store/use-viewer'
import { ItemLightSystem } from './item-light-system'
import { glowDarkness } from './pooled-lights'

let previousViewerState = useViewer.getState()

beforeEach(() => {
  previousViewerState = useViewer.getState()
})

afterEach(() => {
  sceneRegistry.clear()
  useItemLightPool.setState({ registrations: new Map(), bakedCanvases: new Set() })
  useScene.setState({ nodes: {} as Record<AnyNodeId, AnyNode> })
  useViewer.setState({
    levelMode: previousViewerState.levelMode,
    selection: previousViewerState.selection,
  })
})

test('batched ceiling lamps stay eligible; all twelve light objects remain visible across toggles and removal', async () => {
  const id = 'item_lamp' as AnyNodeId
  const ceiling = new Group()
  ceiling.layers.set(5)
  const item = new Group()
  ceiling.add(item)
  sceneRegistry.nodes.set(id, item)
  const nodes = {
    site: { id: 'site', type: 'site', visible: false, parentId: null },
    building: { id: 'building', type: 'building', visible: true, parentId: 'site' },
    level: { id: 'level', type: 'level', visible: true, parentId: 'building' },
    ceiling: { id: 'ceiling', type: 'ceiling', visible: true, parentId: 'level' },
    [id]: { id, type: 'item', visible: true, parentId: 'ceiling' },
  } as unknown as Record<AnyNodeId, AnyNode>
  useScene.setState({ nodes })
  useViewer.setState({
    levelMode: 'stacked',
    selection: { ...useViewer.getState().selection, levelId: null },
  })
  let on = true
  const pool = useItemLightPool.getState()
  pool.register({
    key: 'lamp',
    nodeId: id,
    color: '#ffffff',
    distance: 6,
    getWorldPosition: (out) => {
      out.set(1, 2, 3)
      return true
    },
    getIntensity: () => 2,
    isEligible: () => on,
  })
  const renderer = await create(createElement(ItemLightSystem))
  try {
    const lights = renderer.scene
      .findAllByType('PointLight')
      .map((entry) => entry.instance as PointLight)
    expect(lights).toHaveLength(12)
    expect(lights.every((light) => light.visible)).toBe(true)
    await renderer.advanceFrames(5, 1 / 30)
    expect(lights.some((light) => light.intensity > 0)).toBe(true)

    on = false
    await renderer.advanceFrames(30, 1 / 30)
    expect(lights.every((light) => light.intensity === 0 && light.visible)).toBe(true)
    on = true
    await renderer.advanceFrames(5, 1 / 30)
    expect(lights.some((light) => light.intensity > 0)).toBe(true)

    nodes.level!.visible = false
    await renderer.advanceFrames(30, 1 / 30)
    expect(lights.every((light) => light.intensity === 0)).toBe(true)
    nodes.level!.visible = true
    await renderer.advanceFrames(5, 1 / 30)
    expect(lights.some((light) => light.intensity > 0)).toBe(true)

    nodes[id]!.visible = false
    await renderer.advanceFrames(30, 1 / 30)
    expect(lights.every((light) => light.intensity === 0)).toBe(true)
    nodes[id]!.visible = true
    item.layers.set(5)
    await renderer.advanceFrames(30, 1 / 30)
    expect(lights.every((light) => light.intensity === 0)).toBe(true)
    item.layers.set(0)
    ceiling.visible = false
    await renderer.advanceFrames(30, 1 / 30)
    expect(lights.every((light) => light.intensity === 0)).toBe(true)
    ceiling.visible = true
    useViewer.setState({
      levelMode: 'solo',
      selection: { ...useViewer.getState().selection, levelId: 'level_other' },
    })
    await renderer.advanceFrames(30, 1 / 30)
    expect(lights.every((light) => light.intensity === 0)).toBe(true)
    useViewer.setState({
      levelMode: 'stacked',
      selection: { ...useViewer.getState().selection, levelId: null },
    })
    await renderer.advanceFrames(5, 1 / 30)

    pool.register({
      key: 'lamp-next',
      nodeId: id,
      color: '#ff0000',
      distance: 4,
      getWorldPosition: (out) => {
        out.set(4, 5, 6)
        return true
      },
      getIntensity: () => 1,
      isEligible: () => true,
    })
    pool.unregister('lamp')
    await renderer.advanceFrames(30, 1 / 30)
    expect(lights.some((light) => light.intensity > 0)).toBe(true)
    pool.unregister('lamp-next')
    await renderer.advanceFrames(30, 1 / 30)
    expect(lights.every((light) => light.intensity === 0 && light.visible)).toBe(true)
    expect(renderer.scene.findAllByType('PointLight').map((entry) => entry.instance)).toEqual(
      lights,
    )
  } finally {
    await renderer.unmount()
  }
})

test('a baked owner suppresses the native pool on its canvas', async () => {
  let canvas: Group | undefined
  function Fixture() {
    canvas = useThree((state) => state.scene) as Group
    return createElement(ItemLightSystem)
  }
  const renderer = await create(createElement(Fixture))
  try {
    expect(renderer.scene.findAllByType('PointLight')).toHaveLength(12)
    await act(async () => useItemLightPool.getState().setBakedCanvas(canvas!, true))
    expect(renderer.scene.findAllByType('PointLight')).toHaveLength(0)
    await act(async () => useItemLightPool.getState().setBakedCanvas(canvas!, false))
    expect(renderer.scene.findAllByType('PointLight')).toHaveLength(12)
  } finally {
    await renderer.unmount()
  }
})

test('a spot with shadows takes a shadow slot, aimed; one without shines from the spot pool; both glow', async () => {
  const id = 'item_sconce' as AnyNodeId
  const item = new Group()
  sceneRegistry.nodes.set(id, item)
  useScene.setState({
    nodes: { [id]: { id, type: 'item', visible: true, parentId: null } } as unknown as Record<
      AnyNodeId,
      AnyNode
    >,
  })
  const pool = useItemLightPool.getState()
  const spot = (key: string, shadows: boolean) =>
    pool.register({
      key,
      nodeId: id,
      color: '#ffd9a0',
      distance: 4,
      spot: { direction: [0, 1, 0], angle: 60, softness: 0.5 },
      shadows,
      glow: { size: 0.2, strength: 1 },
      peak: 2,
      getWorldPosition: (out) => {
        out.set(1, 2, 3)
        return true
      },
      getWorldDirection: (out) => {
        out.set(0, 1, 0)
      },
      getIntensity: () => 2,
      isEligible: () => true,
    })
  spot('wash', true)
  spot('accent', false)
  const renderer = await create(createElement(ItemLightSystem))
  try {
    // The first tick asks for the spot, shadow and glow pools; they mount on the next render.
    await act(async () => renderer.advanceFrames(1, 1 / 30))
    await renderer.advanceFrames(20, 1 / 30)
    const spots = renderer.scene
      .findAllByType('SpotLight')
      .map((entry) => entry.instance as SpotLight)
    const lit = spots.filter((light) => light.intensity > 0)
    expect(lit.map((light) => light.castShadow).sort()).toEqual([false, true])
    for (const light of lit) {
      expect(light.angle).toBeCloseTo(Math.PI / 6)
      expect(light.penumbra).toBe(0.5)
      expect(light.target.position.toArray()).toEqual([1, 3, 3])
    }
    const glows = renderer.scene.findAll((entry) => entry.instance.name === 'light-glows')
    expect((glows[0]!.instance as unknown as { count: number }).count).toBe(2)
  } finally {
    await renderer.unmount()
  }
})

test('a glow shows at night and nearly vanishes under a high sun', () => {
  expect(glowDarkness(null, 'dark')).toBe(1)
  expect(glowDarkness(null, 'light')).toBeLessThan(0.1)
  expect(glowDarkness(new Vector3(0, -1, 0), 'light')).toBe(1)
  expect(glowDarkness(new Vector3(1, 1, 0), 'dark')).toBeLessThan(0.1)
})
