// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  BatchedMesh,
  BoxGeometry,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SkinnedMesh,
  Sprite,
  SpriteMaterial,
  type Vector2,
} from 'three'
import RenderObject from 'three/src/renderers/common/RenderObject.js'
import RenderObjects from 'three/src/renderers/common/RenderObjects.js'
import { pass } from 'three/tsl'
import { NodeFrame } from 'three/webgpu'
import { mergedOutline } from './merged-outline-node'

describe('merged outline rendering', () => {
  test('keeps selected outlines active during camera interaction', () => {
    const cameraInteractionActive = true
    const params = {
      enabled: () => !cameraInteractionActive,
      primaryObjects: [new Object3D()],
    }
    const outline = mergedOutline(new Scene(), new PerspectiveCamera(), params)
    const frame = {
      get renderer(): never {
        throw new Error('outline renderer was reached')
      },
    }

    expect(() => outline.updateBefore(frame)).toThrow('outline renderer was reached')
    outline.dispose()
  })
})

function makeRenderer() {
  let target: any = null
  let renderObjectFunction: any = null
  let clearAlpha = 0
  let mrt: any = null
  const clearColor = new Color()
  const renders: Object3D[] = []
  const clears: any[] = []
  const draws: { object: Object3D; material: any; group: any }[] = []
  return {
    renders,
    clears,
    draws,
    samples: 4,
    autoClear: true,
    getRenderTarget: () => target,
    setRenderTarget: (next: any) => {
      target = next
    },
    getOutputRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getRenderObjectFunction: () => renderObjectFunction,
    setRenderObjectFunction: (next: any) => {
      renderObjectFunction = next
    },
    getPixelRatio: () => 1,
    setPixelRatio: () => {},
    getMRT: () => mrt,
    setMRT: (next: any) => {
      mrt = next
    },
    getClearColor: (color: Color) => color.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: (color: any, alpha: number) => {
      clearColor.set(color)
      clearAlpha = alpha
    },
    getScissorTest: () => false,
    setScissorTest: () => {},
    getDrawingBufferSize: (size: Vector2) => size.set(100, 100),
    clearColor: () => clears.push(target),
    renderObject: (
      object: Object3D,
      _scene: any,
      _camera: any,
      _geometry: any,
      material: any,
      group: any,
    ) => {
      draws.push({ object, material, group })
    },
    render: (root: Object3D, camera: PerspectiveCamera) => {
      renders.push(root)
      if (root.matrixWorldAutoUpdate) root.updateMatrixWorld()
      root.traverseVisible((object: any) => {
        if (!renderObjectFunction || !object.geometry || !object.layers.test(camera.layers)) return
        const submit = (material: any, group: any) => {
          if (material?.visible)
            renderObjectFunction(object, root, camera, object.geometry, material, group)
        }
        if (Array.isArray(object.material)) {
          for (const group of object.geometry.groups)
            submit(object.material[group.materialIndex], group)
        } else {
          submit(object.material, null)
        }
      })
    },
  }
}

function makeOutlineFixture(reuseDepth = true) {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  const root = new Group()
  const geometry = new BoxGeometry()
  const material = new MeshBasicMaterial()
  const mesh = new Mesh(geometry, material)
  root.add(mesh)
  scene.add(root)
  const scenePass = pass(scene, camera)
  const outline = mergedOutline(scene, camera, {
    secondaryObjects: [root],
    ...(reuseDepth ? { sceneDepthNode: scenePass.getTextureNode('depth') } : {}),
  })
  const renderer = makeRenderer()
  const frame = new NodeFrame()
  frame.renderer = renderer as any
  return {
    scene,
    camera,
    root,
    geometry,
    material,
    mesh,
    scenePass,
    outline,
    renderer,
    frame,
    internals: outline as any,
    tick: () => {
      frame.update()
      frame.updateBeforeNode(outline)
    },
    dispose: () => {
      outline.dispose()
      scenePass.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}

describe('merged outline proxy bookkeeping', () => {
  test('deduplicates descendants, reuses proxies, and prunes removed or empty geometry', () => {
    const f = makeOutlineFixture()
    f.outline.secondaryObjects.push(f.mesh)
    f.tick()
    const proxy = f.internals._proxiesB.get(f.mesh)
    expect(f.internals._maskSceneB.children).toEqual([proxy])
    expect(proxy.geometry).toBe(f.geometry)
    expect(proxy.material).toBe(f.material)
    expect(proxy.matrixAutoUpdate).toBe(false)
    expect(proxy.frustumCulled).toBe(false)
    expect(f.internals._maskSceneB.matrixWorldAutoUpdate).toBe(false)
    f.tick()
    expect(f.internals._proxiesB.get(f.mesh)).toBe(proxy)

    const second = new Mesh(f.geometry, f.material)
    f.root.add(second)
    f.tick()
    expect(f.internals._proxiesB.size).toBe(2)
    f.root.remove(second)
    f.tick()
    expect(f.internals._proxiesB.has(second)).toBe(false)
    const empty = new BufferGeometry()
    f.mesh.geometry = empty
    f.tick()
    expect(f.internals._proxiesB.size).toBe(0)
    expect(f.internals._maskSceneB.children).toHaveLength(0)
    empty.dispose()
    f.dispose()
  })

  test('forwards current world transforms, morphs, layers, and ancestor visibility', () => {
    const f = makeOutlineFixture()
    f.root.position.set(3, 4, 5)
    f.root.scale.set(2, 3, 4)
    f.mesh.position.set(1, 2, 3)
    f.mesh.morphTargetInfluences = [0.25]
    f.mesh.morphTargetDictionary = { open: 0 }
    f.tick()
    const proxy = f.internals._proxiesB.get(f.mesh)
    expect(proxy.matrixWorld.equals(f.mesh.matrixWorld)).toBe(true)
    expect(proxy.morphTargetInfluences).toBe(f.mesh.morphTargetInfluences)
    expect(proxy.morphTargetDictionary).toBe(f.mesh.morphTargetDictionary)
    f.root.position.x = 20
    f.mesh.layers.set(2)
    f.root.visible = false
    f.tick()
    expect(proxy.matrixWorld.equals(f.mesh.matrixWorld)).toBe(true)
    expect(proxy.layers.mask).toBe(f.mesh.layers.mask)
    expect(proxy.visible).toBe(false)
    f.root.visible = true
    f.scene.remove(f.root)
    f.tick()
    expect(proxy.visible).toBe(false)
    f.dispose()
  })

  test('forwards sprite anchors and count without owning source assets', () => {
    const f = makeOutlineFixture()
    const spriteMaterial = new SpriteMaterial()
    const sprite = new Sprite(spriteMaterial)
    sprite.center.set(0.1, 0.8)
    sprite.count = 2
    f.root.add(sprite)
    f.tick()
    const proxy = f.internals._proxiesB.get(sprite)
    expect(proxy.isSprite).toBe(true)
    expect(proxy.center.equals(sprite.center)).toBe(true)
    expect(proxy.count).toBe(2)
    expect(proxy.geometry).toBe(sprite.geometry)
    let disposed = false
    spriteMaterial.addEventListener('dispose', () => {
      disposed = true
    })
    f.dispose()
    expect(f.internals._proxiesB.size).toBe(0)
    expect(f.internals._maskSceneB.children).toHaveLength(0)
    expect(disposed).toBe(false)
    spriteMaterial.dispose()
  })

  test('preserves material groups and material visibility when submitting a mask', () => {
    const f = makeOutlineFixture()
    const hidden = new MeshBasicMaterial({ visible: false })
    f.mesh.material = [f.material, hidden] as any
    f.geometry.clearGroups()
    f.geometry.addGroup(0, 3, 0)
    f.geometry.addGroup(3, 3, 1)
    f.tick()
    expect(f.renderer.draws).toHaveLength(1)
    expect(f.renderer.draws[0].group).toBe(f.geometry.groups[0])
    expect(f.renderer.draws[0].material).toBe(
      f.internals._proxyMaskMaterials.get(f.internals._proxiesB.get(f.mesh)),
    )
    hidden.dispose()
    f.dispose()
  })

  test('forwards ordinary mesh count, including zero', () => {
    const f = makeOutlineFixture()
    for (const count of [0, 3, 1]) {
      ;(f.mesh as any).count = count
      f.tick()
      const proxy = f.internals._proxiesB.get(f.mesh)
      expect(proxy.count).toBe(count)
      const draw = RenderObject.prototype.getDrawParameters.call({
        object: proxy,
        geometry: f.geometry,
        material: f.material,
        group: null,
        drawRange: f.geometry.drawRange,
        drawParams: null,
        getIndex: () => f.geometry.index,
      } as any)
      expect(draw?.instanceCount ?? 0).toBe(count)
    }
    f.dispose()
  })

  test('allocates no proxies for mixed fallback groups across five frames', () => {
    const f = makeOutlineFixture()
    f.root.add(new SkinnedMesh(f.geometry, f.material))
    let added = 0
    f.internals._maskSceneB.addEventListener('childadded', () => added++)
    for (let i = 0; i < 5; i++) f.tick()
    expect(added).toBe(0)
    expect(f.internals._proxiesB.size).toBe(0)
    f.dispose()
  })

  test('releases real RenderObjects and dispose listeners across five hover cycles', () => {
    const f = makeOutlineFixture()
    let disposed = 0
    const renderer = {
      _currentSourceMaterial: null,
      contextNode: { id: 0, version: 0 },
      backend: { isWebGPUBackend: true },
    }
    const renderObjects = new RenderObjects(
      renderer as any,
      { getCacheKey: () => 0, delete: () => {} } as any,
      {} as any,
      { delete: () => disposed++ } as any,
      { deleteForRender: () => {} } as any,
      {} as any,
    )
    const lights = {} as any
    const context = {} as any
    const listeners = (object: any) => object._listeners?.dispose?.length ?? 0
    const initialGeometryListeners = listeners(f.geometry)
    const materials: any[] = []
    const originalRenderObject = f.renderer.renderObject
    f.renderer.renderObject = (object, scene, camera, geometry, material, group) => {
      originalRenderObject(object, scene, camera, geometry, material, group)
      renderObjects.get(object, material, scene, camera, lights, context, null as any)
      if (!materials.includes(material)) materials.push(material)
    }
    for (let i = 0; i < 5; i++) {
      f.outline.secondaryObjects.push(f.root)
      f.tick()
      expect(listeners(f.geometry)).toBe(initialGeometryListeners + 1)
      f.tick()
      expect(listeners(f.geometry)).toBe(initialGeometryListeners + 1)
      f.outline.secondaryObjects.length = 0
      f.tick()
      expect(listeners(f.geometry)).toBe(initialGeometryListeners)
      expect(materials.reduce((sum, material) => sum + listeners(material), 0)).toBe(0)
      expect(disposed).toBe(i + 1)
    }
    f.outline.secondaryObjects.push(f.root)
    f.tick()
    const replacement = new BoxGeometry()
    f.mesh.geometry = replacement
    f.tick()
    expect(listeners(f.geometry)).toBe(initialGeometryListeners)
    expect(listeners(replacement)).toBe(1)
    f.dispose()
    expect(listeners(replacement)).toBe(0)
    replacement.dispose()
    renderObjects.dispose()
  })

  test('falls back for skinned, instanced, batched, and custom meshes, then recovers', () => {
    const f = makeOutlineFixture()
    const unsupported = [
      new SkinnedMesh(f.geometry, f.material),
      new InstancedMesh(f.geometry, f.material, 1),
      new BatchedMesh(1, 24, 36, f.material),
      new (class CustomMesh extends Mesh {})(f.geometry, f.material),
    ]
    f.tick()
    for (const object of unsupported) {
      f.root.add(object)
      f.renderer.renders.length = 0
      f.tick()
      expect(f.internals._proxiesB.size).toBe(0)
      expect(f.renderer.renders.filter((root) => root === f.scene)).toHaveLength(2)
      f.root.remove(object)
    }
    f.renderer.renders.length = 0
    f.tick()
    expect(f.internals._proxiesB.size).toBe(1)
    expect(f.renderer.renders.filter((root) => root === f.scene)).toHaveLength(1)
    ;(unsupported[1] as InstancedMesh).dispose()
    ;(unsupported[2] as BatchedMesh).dispose()
    f.dispose()
  })

  test('falls back for draw callbacks and hierarchy-dependent rendering', () => {
    const f = makeOutlineFixture()
    const defaultCallback = f.mesh.onBeforeRender
    f.mesh.onBeforeRender = () => {}
    f.tick()
    expect(f.internals._proxiesB.size).toBe(0)
    f.mesh.onBeforeRender = defaultCallback
    f.root.renderOrder = 1
    f.tick()
    expect(f.internals._proxiesB.size).toBe(0)
    f.dispose()
  })
})

describe('merged outline passes', () => {
  test("reads this frame's depth once before masks, regardless of consumer order", () => {
    const f = makeOutlineFixture()
    f.tick()
    expect(f.renderer.renders[0]).toBe(f.scene)
    expect(f.renderer.renders[1]).toBe(f.internals._maskSceneB)
    expect(f.renderer.renders).toHaveLength(9) // producer + mask + seven quads
    f.frame.updateBeforeNode(f.scenePass)
    expect(f.renderer.renders).toHaveLength(9)
    f.renderer.renders.length = 0
    f.frame.update()
    f.frame.updateBeforeNode(f.scenePass)
    f.frame.updateBeforeNode(f.outline)
    expect(f.renderer.renders).toHaveLength(9)
    f.dispose()
  })

  test('shares fallback depth across both groups and copies matrices after that render', () => {
    const f = makeOutlineFixture(false)
    f.outline.primaryObjects.push(f.mesh)
    f.root.position.x = 12
    f.tick()
    expect(f.renderer.renders.filter((root) => root === f.scene)).toHaveLength(1)
    expect(f.renderer.renders).toHaveLength(17) // depth + two masks + fourteen quads
    expect(f.internals._proxiesA.get(f.mesh).matrixWorld.equals(f.mesh.matrixWorld)).toBe(true)
    expect(f.internals._proxiesB.get(f.mesh).matrixWorld.equals(f.mesh.matrixWorld)).toBe(true)
    f.dispose()
  })

  test('clears and prunes has-to-empty groups once, then never touches the renderer', () => {
    const f = makeOutlineFixture()
    f.outline.primaryObjects.push(f.mesh)
    f.tick()
    f.outline.secondaryObjects.length = 0
    f.tick()
    expect(f.renderer.clears).toEqual([f.internals._groupB.composite])
    expect(f.internals._proxiesB.size).toBe(0)
    f.outline.primaryObjects.length = 0
    f.renderer.renders.length = 0
    f.tick()
    expect(f.renderer.clears).toEqual([
      f.internals._groupB.composite,
      f.internals._groupA.composite,
    ])
    expect(f.internals._proxiesA.size).toBe(0)
    expect(f.renderer.renders).toHaveLength(0)
    expect(() =>
      f.outline.updateBefore({
        get renderer(): never {
          throw new Error('must not touch renderer')
        },
      }),
    ).not.toThrow()
    f.dispose()
  })
})
