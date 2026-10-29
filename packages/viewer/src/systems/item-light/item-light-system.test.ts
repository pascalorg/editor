import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import {
  Frustum,
  Group,
  Matrix4,
  PerspectiveCamera,
  type PointLight,
  type SpotLight,
  Vector3,
} from 'three'
import type { SpriteNodeMaterial } from 'three/webgpu'
import { useItemLightPool } from '../../store/use-item-light-pool'
import useViewer from '../../store/use-viewer'
import { ItemLightSystem } from './item-light-system'
import { glowDarkness, itemLightsForCapture, lightContribution } from './pooled-lights'

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

test('batched ceiling lamps stay eligible; all sixteen point lights remain visible across toggles and removal', async () => {
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
    expect(lights).toHaveLength(16)
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
        out.set(4, 5, 0)
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
    expect(renderer.scene.findAllByType('PointLight')).toHaveLength(16)
    await act(async () => useItemLightPool.getState().setBakedCanvas(canvas!, true))
    expect(renderer.scene.findAllByType('PointLight')).toHaveLength(0)
    await act(async () => useItemLightPool.getState().setBakedCanvas(canvas!, false))
    expect(renderer.scene.findAllByType('PointLight')).toHaveLength(16)
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
  // As a saved scene stores it: no strength, which is 1.
  useItemLightPool.getState().registrations.get('accent')!.glow = { size: 0.2 }
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
    const sprite = glows[0]!.instance as unknown as {
      count: number
      material: { colorNode: { value: { array: Float32Array } } }
    }
    expect(sprite.count).toBe(2)
    expect([...sprite.material.colorNode.value.array.slice(0, 6)].every(Number.isFinite)).toBe(true)
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

const lit = (renderer: Awaited<ReturnType<typeof create>>, type: 'SpotLight' | 'PointLight') =>
  renderer.scene
    .findAllByType(type)
    .map((entry) => entry.instance as PointLight | SpotLight)
    .filter((light) => light.intensity > 0)

function registerLamp(
  key: string,
  at: [number, number, number],
  options: { spot?: boolean; intensity?: number; distance?: number; on?: () => boolean } = {},
) {
  const id = `item_${key}` as AnyNodeId
  if (!sceneRegistry.nodes.has(id)) sceneRegistry.nodes.set(id, new Group())
  useItemLightPool.getState().register({
    key,
    nodeId: id,
    color: '#ffffff',
    distance: options.distance ?? 0,
    ...(options.spot ? { spot: { direction: [0, -1, 0], angle: 60, softness: 0.4 } } : {}),
    getWorldPosition: (out) => {
      out.set(...at)
      return true
    },
    getIntensity: () => options.intensity ?? 3,
    isEligible: options.on ?? (() => true),
  })
}

test('a house seen from the street: every exterior beam facing the camera gets a slot', async () => {
  // The default camera stands at z = 5 looking down -z; the facade is 12 m away.
  const exterior: [number, number, number][] = []
  for (const x of [-6, -3, 0, 3, 6]) exterior.push([x, 2.5, -7])
  for (const x of [-4.5, -1.5, 1.5, 4.5]) exterior.push([x, 0.3, -7.5])
  exterior.forEach((at, i) => {
    registerLamp(`outside_${i}`, at, { spot: true, distance: 6 })
  })
  // Fifty lights inside, behind the facade, half of them downlights.
  for (let i = 0; i < 50; i++)
    registerLamp(`inside_${i}`, [-8 + (i % 10) * 1.8, 2.6, -9 - Math.floor(i / 10) * 2.5], {
      spot: i % 2 === 0,
    })
  const renderer = await create(createElement(ItemLightSystem))
  try {
    await act(async () => renderer.advanceFrames(1, 1 / 30))
    await renderer.advanceFrames(30, 1 / 30)
    const spots = lit(renderer, 'SpotLight').map((light) => light.position.toArray().join(','))
    for (const at of exterior) expect(spots).toContain(at.join(','))
  } finally {
    await renderer.unmount()
  }
})

test('a light counts by what it adds to the view, and not at all when its reach misses it', () => {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 1.6, 0)
  camera.lookAt(0, 1.6, -1)
  camera.updateMatrixWorld()
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  )
  const eye = camera.position
  const can = lightContribution(new Vector3(0, 2.6, -15), 2, 0, eye, frustum)
  const sconce = lightContribution(new Vector3(1.5, 1.8, -2.5), 2, 0, eye, frustum)
  expect(sconce).toBeGreaterThan(can)
  // Behind the eye, its 3 m reach never meets the view.
  expect(lightContribution(new Vector3(0, 1.6, 4), 5, 3, eye, frustum)).toBe(0)
  // Off, it adds nothing.
  expect(lightContribution(new Vector3(0, 1.6, -2), 0, 0, eye, frustum)).toBe(0)
})

test('a capture re-ranks for its own camera, at full strength at once, and gives the live view back', async () => {
  let scene: Group | undefined
  function Fixture() {
    scene = useThree((state) => state.scene) as Group
    return createElement(ItemLightSystem)
  }
  // Behind the live camera (z = 5, looking down -z), with a reach that misses its view.
  registerLamp('sconce', [0, 1.5, 9], { distance: 2 })
  const renderer = await create(createElement(Fixture))
  try {
    await renderer.advanceFrames(10, 1 / 30)
    expect(lit(renderer, 'PointLight')).toHaveLength(0)
    const capture = new PerspectiveCamera(60, 1, 0.1, 100)
    capture.position.set(0, 1.5, 12)
    capture.lookAt(0, 1.5, 9)
    capture.updateProjectionMatrix()
    const restore = itemLightsForCapture(scene!, capture)
    const [light] = lit(renderer, 'PointLight')
    expect(light?.intensity).toBe(3)
    expect(light?.position.toArray()).toEqual([0, 1.5, 9])
    restore()
    expect(lit(renderer, 'PointLight')).toHaveLength(0)
  } finally {
    await renderer.unmount()
  }
})

test('the glows write nothing into the normals and diffuse colour the ink reads', async () => {
  registerLamp('lamp', [0, 1, 0])
  useItemLightPool.getState().registrations.get('lamp')!.glow = { size: 0.2 }
  const renderer = await create(createElement(ItemLightSystem))
  try {
    await act(async () => renderer.advanceFrames(1, 1 / 30))
    const [sprite] = renderer.scene.findAll((entry) => entry.instance.name === 'light-glows')
    const material = (sprite!.instance as unknown as { material: SpriteNodeMaterial }).material
    expect(Object.keys(material.mrtNode?.outputNodes ?? {}).sort()).toEqual([
      'diffuseColor',
      'normal',
      'output',
    ])
  } finally {
    await renderer.unmount()
  }
})
