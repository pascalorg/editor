import { describe, expect, test } from 'bun:test'
import {
  DirectionalLight,
  Group,
  Layers,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
} from 'three'
import PassNode from 'three/src/nodes/display/PassNode.js'
import { NodeFrame } from 'three/webgpu'
import { LayerPassIndex, LayerPassNode } from './layer-pass'
import { OVERLAY_LAYER, SCENE_LAYER, ZONE_LAYER } from './layers'

function fixture() {
  const scene = new Scene()
  const parent = new Group()
  const mesh = new Mesh()
  parent.add(mesh)
  scene.add(parent)
  const index = new LayerPassIndex(scene, [OVERLAY_LAYER, ZONE_LAYER])
  const roots: Mesh[] = []
  return { scene, parent, mesh, index, roots }
}

describe('layer pass membership', () => {
  test('tracks preexisting, late, direct and disabled layer assignments; releases detached trees', () => {
    const { scene, parent, mesh, index, roots } = fixture()
    expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(false)
    mesh.layers.set(OVERLAY_LAYER)
    expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
    expect(roots).toEqual([mesh])
    mesh.layers.mask = 1 << ZONE_LAYER
    expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(false)
    expect(index.prepare(ZONE_LAYER, roots).drawable).toBe(true)
    scene.remove(parent)
    expect(index.prepare(ZONE_LAYER, roots).drawable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(mesh.layers, 'mask')?.get).toBeUndefined()
    scene.add(parent)
    expect(index.prepare(ZONE_LAYER, roots).drawable).toBe(true)
    mesh.layers.disableAll()
    expect(index.prepare(ZONE_LAYER, roots).drawable).toBe(false)
    const late = new Mesh()
    late.layers.enable(OVERLAY_LAYER)
    parent.add(late)
    expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
    expect(roots).toEqual([late])
    index.dispose()
    expect(Object.getOwnPropertyDescriptor(late.layers, 'mask')?.value).toBe(3)
  })

  test('retains original transforms, inherited visibility and material visibility', () => {
    const { parent, mesh, index, roots, scene } = fixture()
    parent.position.set(2, 3, 4)
    mesh.position.set(5, 6, 7)
    mesh.layers.set(OVERLAY_LAYER)
    scene.updateMatrixWorld()
    index.prepare(OVERLAY_LAYER, roots)
    expect(roots[0]).toBe(mesh)
    expect(mesh.matrixWorld.elements.slice(12, 15)).toEqual([7, 9, 11])
    expect(mesh.parent).toBe(parent)
    parent.visible = false
    expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(false)
    parent.visible = true
    mesh.material = [new MeshBasicMaterial({ visible: false })]
    expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(false)
    mesh.material.push(new MeshBasicMaterial())
    expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
    index.dispose()
  })

  test('keeps matching ancestor groups once, and preserves scene order after layer changes', () => {
    const { parent, mesh, index, roots } = fixture()
    const second = new Mesh()
    parent.add(second)
    second.layers.set(OVERLAY_LAYER)
    mesh.layers.set(OVERLAY_LAYER)
    index.prepare(OVERLAY_LAYER, roots)
    expect(roots).toEqual([mesh, second])
    parent.layers.set(OVERLAY_LAYER)
    parent.renderOrder = 37
    index.prepare(OVERLAY_LAYER, roots)
    expect(roots).toEqual([parent])
    expect(roots[0]?.renderOrder).toBe(37)
    parent.layers.set(SCENE_LAYER)
    const next = new Group()
    parent.add(next)
    next.add(mesh)
    index.prepare(OVERLAY_LAYER, roots)
    expect(roots).toEqual([second, mesh])
    index.dispose()
  })

  test('does not visit unrelated branches during frame preparation', () => {
    const { scene, mesh, index, roots } = fixture()
    const unrelated = new Group()
    scene.add(unrelated)
    mesh.layers.set(OVERLAY_LAYER)
    const children = unrelated.children
    Object.defineProperty(unrelated, 'children', {
      configurable: true,
      get: () => {
        throw new Error('whole-scene walk')
      },
    })
    expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
    Object.defineProperty(unrelated, 'children', { configurable: true, value: children })
    index.dispose()
  })
})

test('private pass orders the main update, retains scene properties, and clears only on empty transitions/resizes', () => {
  const { scene, mesh, index } = fixture()
  scene.environment = new Texture()
  const camera = new PerspectiveCamera()
  const main = new PassNode(PassNode.COLOR, scene, camera)
  const calls: string[] = []
  main.updateBefore = () => {
    calls.push('main')
    scene.updateMatrixWorld()
    return undefined
  }
  const layer = new LayerPassNode(index, camera, OVERLAY_LAYER, main)
  const layers = new Layers()
  layers.set(OVERLAY_LAYER)
  layer.setLayers(layers)
  const frame = new NodeFrame()
  let width = 100
  let target: unknown = null
  let mrt: unknown = null
  const renderer = {
    getOutputRenderTarget: () => null,
    getDrawingBufferSize: (size: { set: (x: number, y: number) => void }) => size.set(width, 100),
    getRenderTarget: () => target,
    setRenderTarget: (value: unknown) => {
      target = value
    },
    getMRT: () => mrt,
    setMRT: (value: unknown) => {
      mrt = value
    },
    clear: () => {
      calls.push('clear')
      expect(target).toBe(layer.renderTarget)
    },
    render: (root: Scene) => {
      calls.push('render')
      expect(root.children).toEqual([mesh])
      expect(root.environment).toBe(scene.environment)
      expect(root.matrixWorldAutoUpdate).toBe(false)
      expect(mesh.parent).not.toBe(root)
    },
  }
  frame.renderer = renderer as unknown as NonNullable<NodeFrame['renderer']>
  const tick = () => {
    frame.frameId++
    layer.updateBefore(frame)
    expect(target).toBeNull()
    expect(mrt).toBeNull()
  }
  tick()
  tick()
  expect(calls).toEqual(['main', 'clear', 'main'])
  mesh.layers.set(OVERLAY_LAYER)
  tick()
  expect(calls.at(-1)).toBe('render')
  expect(camera.layers.mask).toBe(1)
  mesh.visible = false
  tick()
  tick()
  expect(calls.slice(-3)).toEqual(['main', 'clear', 'main'])
  width = 200
  tick()
  expect(calls.at(-1)).toBe('clear')
  index.dispose()
  layer.dispose()
})

test('collects only layer-eligible lights and retains a full-scene shadow requirement', () => {
  const { scene, mesh, index, roots } = fixture()
  const light = new DirectionalLight()
  scene.add(light)
  mesh.layers.set(OVERLAY_LAYER)
  expect(index.prepare(OVERLAY_LAYER, roots).shadowLight).toBe(false)
  expect(roots).toEqual([mesh])
  light.layers.enable(OVERLAY_LAYER)
  expect(index.prepare(OVERLAY_LAYER, roots).shadowLight).toBe(false)
  expect(roots).toEqual([mesh, light])
  light.castShadow = true
  expect(index.prepare(OVERLAY_LAYER, roots).shadowLight).toBe(true)
  light.visible = false
  expect(index.prepare(OVERLAY_LAYER, roots).shadowLight).toBe(false)
  index.dispose()
})
