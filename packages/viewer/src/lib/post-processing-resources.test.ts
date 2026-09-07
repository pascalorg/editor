import { expect, mock, test } from 'bun:test'
import { Layers, Mesh, PerspectiveCamera, Scene } from 'three'
import { NodeFrame, PassNode, RenderPipeline } from 'three/webgpu'
import { LayerPassIndex, LayerPassNode } from './layer-pass'
import { OVERLAY_LAYER, ZONE_LAYER } from './layers'
import { PostProcessingResources } from './post-processing-resources'

function fixture() {
  const scene = new Scene()
  const mesh = new Mesh()
  mesh.layers.set(OVERLAY_LAYER)
  scene.add(mesh)
  const resources = new PostProcessingResources()
  const index = new LayerPassIndex(scene, [OVERLAY_LAYER, ZONE_LAYER])
  resources.layerIndex = index
  const main = new PassNode(PassNode.COLOR, scene, new PerspectiveCamera())
  resources.passes.push(main)
  const passes = [OVERLAY_LAYER, ZONE_LAYER].map((layer) => {
    const pass = new LayerPassNode(index, main.camera, layer, main)
    const layers = new Layers()
    layers.set(layer)
    pass.setLayers(layers)
    resources.passes.push(pass)
    return pass
  })
  const targetDisposals = resources.passes.map((pass) => {
    const dispose = mock(() => {})
    pass.renderTarget.addEventListener('dispose', dispose)
    return dispose
  })
  return { scene, mesh, resources, index, main, passes, targetDisposals }
}

test('runtime disposal releases targets, observers and retained roots; later teardown is idempotent', () => {
  const f = fixture()
  const pipeline = new RenderPipeline({} as never)
  f.resources.pipeline = pipeline
  const pipelineDispose = mock(pipeline.dispose.bind(pipeline))
  pipeline.dispose = pipelineDispose
  const outlineDispose = mock(() => {})
  f.resources.outline = { dispose: outlineDispose }
  const frame = new NodeFrame()
  f.main.updateBefore = () => undefined
  frame.renderer = {
    getOutputRenderTarget: () => null,
    getDrawingBufferSize: (size: { set(x: number, y: number): void }) => size.set(1, 1),
    getRenderTarget: () => null,
    getMRT: () => null,
    setRenderTarget: () => {},
    setMRT: () => {},
    render: () => {},
  } as never
  f.passes[0]!.updateBefore(frame)
  const privateRoots = f.passes[0]!.scene.children
  expect(privateRoots).toEqual([f.mesh])
  f.scene.remove(f.mesh)
  expect(privateRoots).toEqual([f.mesh])
  const cleanup = () => f.resources.dispose()
  pipeline.render = () => {
    throw new Error('runtime failure after retries')
  }
  try {
    pipeline.render()
  } catch {
    cleanup()
  }
  expect(privateRoots).toEqual([])
  expect(f.resources.pipeline).toBeNull()
  expect(f.resources.layerIndex).toBeNull()
  expect(f.resources.passes).toEqual([])
  expect(f.resources.outline).toBeNull()
  expect(Object.getOwnPropertyDescriptor(f.scene.layers, 'mask')?.get).toBeUndefined()
  f.scene.add(f.mesh)
  expect(Object.getOwnPropertyDescriptor(f.mesh.layers, 'mask')?.get).toBeUndefined()
  cleanup()
  for (const dispose of f.targetDisposals) expect(dispose).toHaveBeenCalledTimes(1)
  expect(pipelineDispose).toHaveBeenCalledTimes(1)
  expect(outlineDispose).toHaveBeenCalledTimes(1)
})

test('construction failure can dispose partial resources before a pipeline exists', () => {
  const f = fixture()
  f.resources.dispose()
  f.resources.dispose()
  for (const dispose of f.targetDisposals) expect(dispose).toHaveBeenCalledTimes(1)
  expect(Object.getOwnPropertyDescriptor(f.mesh.layers, 'mask')?.get).toBeUndefined()
  const roots: Mesh[] = []
  f.scene.add(new Mesh())
  expect(f.index.prepare(OVERLAY_LAYER, roots).drawable).toBe(false)
})

test('teardown permits a fresh index on the same scene without old cleanup affecting it', () => {
  const f = fixture()
  f.resources.dispose()
  const next = new LayerPassIndex(f.scene, [OVERLAY_LAYER])
  f.resources.dispose()
  const roots: Mesh[] = []
  expect(next.prepare(OVERLAY_LAYER, roots).drawable).toBe(true)
  f.mesh.layers.disableAll()
  expect(next.prepare(OVERLAY_LAYER, roots).drawable).toBe(false)
  next.dispose()
})
