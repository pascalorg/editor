import { describe, expect, spyOn, test } from 'bun:test'
import {
  DirectionalLight,
  Group,
  Layers,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
} from 'three'
import { pass } from 'three/tsl'
import { NodeFrame, PassNode } from 'three/webgpu'
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

test('uses the WebGPU PassNode and TSL texture node identities', () => {
  const { scene, index } = fixture()
  const camera = new PerspectiveCamera()
  const main = pass(scene, camera)
  const layer = new LayerPassNode(index, camera, OVERLAY_LAYER, main)
  expect(main).toBeInstanceOf(PassNode)
  expect(layer).toBeInstanceOf(PassNode)
  expect(layer.isPassNode).toBe(true)
  expect(layer.getTextureNode().isNode).toBe(true)
  expect(layer.getTextureNode().passNode).toBe(layer)
  index.dispose()
  layer.dispose()
  main.dispose()
})

test('drops raw removals before sorting and restores descendant accessors', () => {
  const { scene, parent, mesh, index, roots } = fixture()
  mesh.layers.set(OVERLAY_LAYER)
  const retained = new Mesh()
  retained.layers.set(OVERLAY_LAYER)
  scene.add(retained)
  parent.parent = null
  scene.children.splice(scene.children.indexOf(parent), 1)
  expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
  expect(roots).toEqual([retained])
  expect(Object.getOwnPropertyDescriptor(mesh.layers, 'mask')?.get).toBeUndefined()
  expect(Object.getOwnPropertyDescriptor(parent.layers, 'mask')?.get).toBeUndefined()
  scene.add(parent)
  expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
  expect(roots).toEqual([retained, mesh])
  index.dispose()
})

test('registers eventless subtree insertions and reattaches replaced Layers', () => {
  const { parent, mesh, index, roots } = fixture()
  const group = new Group()
  const late = new Mesh()
  late.layers.set(OVERLAY_LAYER)
  group.add(late)
  group.parent = parent
  parent.children.push(group)
  expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(false)
  index.register(group)
  expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
  expect(roots).toEqual([late])
  const previousLayers = late.layers
  late.layers = new Layers()
  late.layers.set(ZONE_LAYER)
  expect(index.prepare(ZONE_LAYER, roots).drawable).toBe(true)
  expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(false)
  expect(Object.getOwnPropertyDescriptor(previousLayers, 'mask')?.get).toBeUndefined()
  late.layers.set(OVERLAY_LAYER)
  expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
  mesh.layers = new Layers()
  mesh.layers.set(OVERLAY_LAYER)
  index.register(mesh)
  index.prepare(OVERLAY_LAYER, roots)
  expect(roots).toEqual([mesh, late])
  index.dispose()
})

test('rejects overlapping indexes without altering the original observer or mask', () => {
  const { scene, mesh, index, roots } = fixture()
  const accessor = Object.getOwnPropertyDescriptor(scene.layers, 'mask')?.get
  expect(() => new LayerPassIndex(scene, [OVERLAY_LAYER])).toThrow('one index per scene')
  expect(Object.getOwnPropertyDescriptor(scene.layers, 'mask')?.get).toBe(accessor)
  mesh.layers.set(OVERLAY_LAYER)
  expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
  index.dispose()
  expect(mesh.layers.mask).toBe(1 << OVERLAY_LAYER)
  const replacement = new LayerPassIndex(scene, [OVERLAY_LAYER])
  expect(replacement.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
  replacement.dispose()
})

test('rejects shared Layers and rolls back partial index construction', () => {
  const { mesh, index } = fixture()
  const other = new Scene()
  const ordinary = new Mesh()
  const shared = new Mesh()
  shared.layers = mesh.layers
  other.add(ordinary, shared)
  const accessor = Object.getOwnPropertyDescriptor(mesh.layers, 'mask')?.get
  expect(() => new LayerPassIndex(other, [OVERLAY_LAYER])).toThrow('unshared Layers')
  expect(Object.getOwnPropertyDescriptor(mesh.layers, 'mask')?.get).toBe(accessor)
  expect(Object.getOwnPropertyDescriptor(other.layers, 'mask')?.get).toBeUndefined()
  expect(Object.getOwnPropertyDescriptor(ordinary.layers, 'mask')?.get).toBeUndefined()
  index.dispose()
})

test('observes every mask operation, Three attach and ancestor clear', () => {
  const { scene, parent, mesh, index, roots } = fixture()
  for (const operation of ['enable', 'toggle', 'set'] as const) {
    mesh.layers.disableAll()
    mesh.layers[operation](OVERLAY_LAYER)
    expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
  }
  mesh.layers.disable(OVERLAY_LAYER)
  expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(false)
  mesh.layers.enableAll()
  expect(index.prepare(ZONE_LAYER, roots).drawable).toBe(true)
  scene.attach(mesh)
  index.prepare(OVERLAY_LAYER, roots)
  expect(roots).toEqual([mesh])
  parent.attach(mesh)
  scene.clear()
  expect(index.prepare(OVERLAY_LAYER, roots).drawable).toBe(false)
  expect(Object.getOwnPropertyDescriptor(mesh.layers, 'mask')?.get).toBeUndefined()
  index.dispose()
})

function renderFixture() {
  const f = fixture()
  const camera = new PerspectiveCamera()
  const main = new PassNode(PassNode.COLOR, f.scene, camera)
  const mainLayers = new Layers()
  mainLayers.set(SCENE_LAYER)
  main.setLayers(mainLayers)
  const overlay = new LayerPassNode(f.index, camera, OVERLAY_LAYER, main)
  const overlayLayers = new Layers()
  overlayLayers.set(OVERLAY_LAYER)
  overlay.setLayers(overlayLayers)
  const zone = new LayerPassNode(f.index, camera, ZONE_LAYER, main)
  const zoneLayers = new Layers()
  zoneLayers.set(ZONE_LAYER)
  zone.setLayers(zoneLayers)
  const frame = new NodeFrame()
  const renders: { root: Scene; mask: number; positions: number[]; matrices: Matrix4[] }[] = []
  let target: unknown = null
  let mrt: unknown = null
  const renderer = {
    getOutputRenderTarget: () => null,
    getDrawingBufferSize: (size: { set(x: number, y: number): void }) => size.set(100, 100),
    getRenderTarget: () => target,
    setRenderTarget: (value: unknown) => {
      target = value
    },
    getMRT: () => mrt,
    setMRT: (value: unknown) => {
      mrt = value
    },
    clear: () => {},
    render: (root: Scene, renderCamera: PerspectiveCamera) => {
      if (root.matrixWorldAutoUpdate) root.updateMatrixWorld()
      root.onBeforeRender(renderer as never, root, renderCamera, target as never)
      const positions: number[] = []
      const matrices: Matrix4[] = []
      root.traverseVisible((object) => {
        if (!(object instanceof Mesh && object.layers.test(renderCamera.layers))) return
        object.onBeforeRender(
          renderer as never,
          root,
          renderCamera,
          object.geometry,
          object.material as MeshBasicMaterial,
          null as never,
        )
        positions.push(object.matrixWorld.elements[12]!)
        matrices.push(object.matrixWorld.clone())
        object.onAfterRender(
          renderer as never,
          root,
          renderCamera,
          object.geometry,
          object.material as MeshBasicMaterial,
          null as never,
        )
      })
      renders.push({ root, mask: renderCamera.layers.mask, positions, matrices })
      root.onAfterRender(renderer as never, root, renderCamera)
    },
  }
  frame.renderer = renderer as unknown as NonNullable<NodeFrame['renderer']>
  const tick = () => {
    frame.frameId++
    overlay.updateBefore(frame)
    zone.updateBefore(frame)
  }
  const dispose = () => {
    f.index.dispose()
    overlay.dispose()
    zone.dispose()
    main.dispose()
  }
  return { ...f, camera, main, overlay, zone, frame, renders, renderer, tick, dispose }
}

test('custom scene callbacks can enable an empty layer with original identity, receiver and graph', () => {
  const f = renderFixture()
  f.mesh.name = 'overlay'
  const before = f.scene.onBeforeRender
  const after = f.scene.onAfterRender
  const calls: string[] = []
  f.scene.onBeforeRender = function (_renderer, scene, camera) {
    expect(this).toBe(f.scene)
    expect(scene).toBe(f.scene)
    expect(this.getObjectByName('overlay')).toBe(f.mesh)
    calls.push(`before:${camera.layers.mask}`)
    if (camera.layers.mask === 1 << OVERLAY_LAYER) f.mesh.layers.enable(OVERLAY_LAYER)
  }
  f.scene.onAfterRender = function (_renderer, scene, camera) {
    expect(this).toBe(f.scene)
    expect(scene).toBe(f.scene)
    calls.push(`after:${camera.layers.mask}`)
  }
  const callback = f.scene.onBeforeRender
  f.tick()
  expect(calls).toEqual(['before:1', 'after:1', 'before:2', 'after:2', 'before:4', 'after:4'])
  expect(f.renders[1]?.positions).toEqual([0])
  expect(f.renders.every(({ root }) => root === f.scene)).toBe(true)
  expect(f.scene.onBeforeRender).toBe(callback)
  expect(f.camera.layers.mask).toBe(1)
  f.scene.onBeforeRender = before
  f.scene.onAfterRender = after
  f.tick()
  expect(f.renders.at(-1)?.root).not.toBe(f.scene)
  f.dispose()
})

test('a scene after-callback alone keeps empty passes and refreshes moved overlay transforms', () => {
  const f = renderFixture()
  f.mesh.layers.set(OVERLAY_LAYER)
  f.scene.onAfterRender = (_renderer, _scene, camera) => {
    if (camera.layers.mask === 1 << SCENE_LAYER) f.mesh.position.x = 7
  }
  f.tick()
  expect(f.renders[1]?.positions).toEqual([7])
  expect(f.renders[1]?.root).toBe(f.scene)
  expect(f.renders[2]?.mask).toBe(1 << ZONE_LAYER)
  f.dispose()
})

test('refreshes private roots, ancestors and descendants after main object callbacks', () => {
  const f = renderFixture()
  const mover = new Mesh()
  f.scene.add(mover)
  f.parent.layers.set(OVERLAY_LAYER)
  f.mesh.layers.set(OVERLAY_LAYER)
  mover.onAfterRender = () => {
    f.scene.position.x = 2
    f.parent.position.x = 3
    f.mesh.position.x = 7
  }
  f.tick()
  expect(f.renders[1]?.root).not.toBe(f.scene)
  expect(f.renders[1]?.positions).toEqual([12])
  expect(f.renders.filter(({ mask }) => mask === 1).length).toBe(1)
  f.dispose()
})

for (const layer of [OVERLAY_LAYER, ZONE_LAYER]) {
  for (const movedObject of ['root', 'ancestor'] as const) {
    for (const manual of [false, true]) {
      test(`layer ${layer} refreshes descendant matrices after ${movedObject} moves (manual: ${manual})`, () => {
        const f = renderFixture()
        const ancestor = new Group()
        f.scene.add(ancestor)
        ancestor.add(f.parent)
        f.parent.layers.set(layer)
        f.mesh.layers.set(layer)
        const chain = [f.scene, ancestor, f.parent, f.mesh]
        for (const [i, object] of chain.entries()) {
          object.position.set(i + 1, i + 2, i + 3)
          object.rotation.set(i * 0.1, i * 0.2, i * 0.3)
          object.scale.set(1 + i * 0.1, 1, 2)
          object.updateMatrix()
          object.matrixAutoUpdate = !manual
        }
        const mover = new Mesh()
        f.scene.add(mover)
        let expected = new Matrix4()
        mover.onAfterRender = () => {
          const moved = movedObject === 'root' ? f.parent : f.scene
          if (manual) moved.matrix.makeRotationZ(0.8).setPosition(7, 8, 9)
          else moved.position.set(7, 8, 9)
          expected = chain.reduce(
            (product, object) =>
              product.multiply(
                object.matrixAutoUpdate
                  ? new Matrix4().compose(object.position, object.quaternion, object.scale)
                  : object.matrix,
              ),
            new Matrix4(),
          )
        }
        f.tick()
        const rendered = f.renders.find(({ mask }) => mask === 1 << layer)!
        expect(rendered.root).not.toBe(f.scene)
        expect(rendered.root.children).toEqual([f.parent])
        expect(rendered.matrices).toEqual([expected])
        f.dispose()
      })
    }
  }
}

test('refreshes shared ancestors only once per preparation and again on the next frame', () => {
  const f = renderFixture()
  const second = new Mesh()
  f.parent.add(second)
  f.mesh.layers.set(OVERLAY_LAYER)
  second.layers.set(OVERLAY_LAYER)
  const sceneUpdate = spyOn(f.scene, 'updateWorldMatrix')
  const parentUpdate = spyOn(f.parent, 'updateWorldMatrix')
  try {
    for (let frame = 1; frame <= 2; frame++) {
      f.tick()
      expect(sceneUpdate).toHaveBeenCalledTimes(frame)
      expect(parentUpdate).toHaveBeenCalledTimes(frame)
    }
  } finally {
    sceneUpdate.mockRestore()
    parentUpdate.mockRestore()
    f.dispose()
  }
})

test('matrix refresh honors manual local and world matrices after ancestors move', () => {
  const f = renderFixture()
  f.mesh.layers.set(OVERLAY_LAYER)
  f.mesh.matrixAutoUpdate = false
  f.mesh.matrix.makeTranslation(4, 0, 0)
  f.mesh.position.x = 99
  const mover = new Mesh()
  f.scene.add(mover)
  mover.onAfterRender = () => {
    f.parent.position.x += 3
  }
  f.tick()
  expect(f.renders[1]?.positions).toEqual([7])
  f.mesh.matrixWorldAutoUpdate = false
  f.mesh.matrixWorld.makeTranslation(22, 0, 0)
  f.tick()
  expect(f.renders.at(-1)?.positions).toEqual([22])
  f.dispose()
})

test('renders the original scene for shadow lights and restores the proxy afterward', () => {
  const f = renderFixture()
  f.mesh.layers.set(OVERLAY_LAYER)
  const light = new DirectionalLight()
  light.layers.set(OVERLAY_LAYER)
  light.castShadow = true
  f.scene.add(light)
  const proxy = f.overlay.scene
  f.tick()
  expect(f.renders[1]?.root).toBe(f.scene)
  expect(f.overlay.scene).toBe(proxy)
  light.castShadow = false
  f.tick()
  expect(f.renders.at(-1)?.root).toBe(proxy)
  f.dispose()
})

test('backgrounds prevent empty skipping and private scene properties remain forwarded', () => {
  const f = renderFixture()
  f.scene.background = new Texture()
  f.tick()
  expect(f.renders.length).toBe(3)
  expect(f.renders[1]?.root.background).toBe(f.scene.background)
  f.dispose()
})

test('clear failure restores target/MRT and retries clearing on the next frame', () => {
  const f = renderFixture()
  const target = { name: 'previous target' }
  const mrt = { name: 'previous MRT' }
  f.renderer.setRenderTarget(target)
  f.renderer.setMRT(mrt)
  f.renderer.clear = () => {
    throw new Error('clear failed')
  }
  expect(f.tick).toThrow('clear failed')
  expect(f.renderer.getRenderTarget()).toBe(target)
  expect(f.renderer.getMRT()).toBe(mrt)
  let clears = 0
  f.renderer.clear = () => {
    clears++
  }
  f.tick()
  expect(clears).toBe(2)
  f.dispose()
})

test('render failure restores the private scene view', () => {
  const f = renderFixture()
  f.scene.onAfterRender = () => {}
  const proxy = f.overlay.scene
  f.main.updateBefore = () => undefined
  f.renderer.render = () => {
    throw new Error('render failed')
  }
  expect(f.tick).toThrow('render failed')
  expect(f.overlay.scene).toBe(proxy)
  f.dispose()
})

test('private rendering and matrix refresh do not visit unrelated subtrees', () => {
  const f = renderFixture()
  const unrelated = new Group()
  f.scene.add(unrelated)
  f.mesh.layers.set(OVERLAY_LAYER)
  f.main.updateBefore = () => undefined
  const children = unrelated.children
  Object.defineProperty(unrelated, 'children', {
    configurable: true,
    get: () => {
      throw new Error('unrelated traversal')
    },
  })
  f.tick()
  expect(f.renders[0]?.positions).toEqual([0])
  Object.defineProperty(unrelated, 'children', { configurable: true, value: children })
  f.dispose()
})
