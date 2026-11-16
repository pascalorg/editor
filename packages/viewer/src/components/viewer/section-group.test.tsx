import { afterEach, beforeEach, expect, test } from 'bun:test'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { Vector3 } from 'three'
import ClippingContext from 'three/src/renderers/common/ClippingContext.js'
import type { ClippingGroup } from 'three/webgpu'
import { SectionGroup, useViewer } from '../../index'
import { PointerRaycastLayers } from './pointer-raycast-layers'

let previous: ReturnType<typeof useViewer.getState>
beforeEach(() => {
  previous = useViewer.getState()
  useViewer.getState().setProjectId('section-component-test')
  useViewer.getState().setWalkthroughMode(false)
})
afterEach(() => useViewer.setState(previous, true))

test('updates the same world plane and restores the section after walkthrough', async () => {
  const renderer = await create(
    <SectionGroup name="model">
      <group />
    </SectionGroup>,
  )
  try {
    const group = renderer.scene.children[0]!.instance as ClippingGroup
    const plane = group.clippingPlanes[0]!
    expect(group.enabled).toBe(false)
    expect(group.clipShadows).toBe(false)
    await act(async () => {
      useViewer.getState().setSectionEnabled(true)
      useViewer.getState().setSectionAxis('z')
      useViewer.getState().setSectionPosition(4)
    })
    expect(group.enabled).toBe(true)
    expect(group.clipShadows).toBe(true)
    expect(group.clippingPlanes).toEqual([plane])
    expect(plane.normal.toArray()).toEqual([0, 0, -1])
    expect(plane.constant).toBe(4)
    const context = new ClippingContext()
    const clipped = context.getGroupContext(group)
    const key = clipped.cacheKey
    const version = clipped.version
    await act(async () => {
      useViewer.getState().setSectionAxis('x')
      useViewer.getState().setSectionPosition(5)
      useViewer.getState().setSectionFlipped(true)
    })
    expect(context.getGroupContext(group).cacheKey).toBe(key)
    expect(clipped.version).toBe(version)
    for (const [i, value] of [-1, 0, 0, -5].entries()) {
      expect(clipped.unionPlanes[0]!.getComponent(i)).toBeCloseTo(value)
    }
    await act(async () => useViewer.getState().setWalkthroughMode(true))
    expect(group.enabled).toBe(false)
    expect(useViewer.getState().sectionEnabled).toBe(true)
    await act(async () => useViewer.getState().setWalkthroughMode(false))
    expect(group.enabled).toBe(true)
    expect(group.clippingPlanes[0]).toBe(plane)
  } finally {
    await renderer.unmount()
  }
})

test('installs the pointer filter only during a cut and restores the host filter', async () => {
  let state: ReturnType<typeof useThree> | undefined
  const hostFilter = (hits: any[]) => hits
  function Events() {
    state = useThree()
    state.events.filter ??= hostFilter
    return <PointerRaycastLayers />
  }
  const renderer = await create(
    <>
      <Events />
      <SectionGroup name="cut-model">
        <group name="surface" />
      </SectionGroup>
      <group name="host-helper" />
    </>,
  )
  try {
    expect(state!.events.filter).toBe(hostFilter)
    await act(async () => useViewer.getState().setSectionEnabled(true))
    expect(state!.events.filter).not.toBe(hostFilter)
    const object = renderer.scene.findByProps({ name: 'surface' }).instance
    const helper = renderer.scene.findByProps({ name: 'host-helper' }).instance
    const hits = [
      { object, point: new Vector3(0, 1, 0) },
      { object, point: new Vector3(0, -1, 0) },
      { object: helper, point: new Vector3(0, 2, 0) },
    ]
    expect(state!.events.filter!(hits as any, state!)).toEqual(hits.slice(1))
    await act(async () => useViewer.getState().setSectionEnabled(false))
    expect(state!.events.filter).toBe(hostFilter)
  } finally {
    await renderer.unmount()
  }
})

test('the indexed zone pass retains section clipping ancestry for fills and borders', async () => {
  const { LayerPassIndex, LayerPassNode } = await import('../../lib/layer-pass')
  const { ZONE_LAYER } = await import('../../lib/layers')
  const { Layers, PerspectiveCamera, Scene } = await import('three')
  const { NodeFrame, PassNode } = await import('three/webgpu')
  useViewer.setState({ sectionEnabled: true, sectionAxis: 'x', sectionPosition: 0 })
  const renderer = await create(
    <SectionGroup>
      <mesh name="fill" layers={ZONE_LAYER} />
      <mesh name="border" layers={ZONE_LAYER} />
    </SectionGroup>,
  )
  const group = renderer.scene.children[0]!.instance as ClippingGroup
  const scene = new Scene()
  scene.add(group)
  const index = new LayerPassIndex(scene, [ZONE_LAYER])
  const camera = new PerspectiveCamera()
  const main = new PassNode(PassNode.COLOR, scene, camera)
  main.updateBefore = () => undefined
  const pass = new LayerPassNode(index, camera, ZONE_LAYER, main)
  const layers = new Layers()
  layers.set(ZONE_LAYER)
  pass.setLayers(layers)
  const seen: string[] = []
  const frame = new NodeFrame()
  frame.renderer = {
    getRenderTarget: () => null,
    setRenderTarget() {},
    getMRT: () => null,
    setMRT() {},
    getOutputRenderTarget: () => null,
    getDrawingBufferSize: (size: any) => size.set(100, 100),
    render(root: Scene) {
      const visit = (object: any, context: ClippingContext) => {
        if (object.isClippingGroup && object.enabled && camera.layers.test(object.layers))
          context = context.getGroupContext(object)
        if (object.isMesh && camera.layers.test(object.layers)) {
          expect(context.unionPlanes).toHaveLength(1)
          seen.push(object.name)
        }
        for (const child of object.children) visit(child, context)
      }
      visit(root, new ClippingContext())
    },
  } as any
  try {
    pass.updateBefore(frame)
    expect(seen).toEqual(['fill', 'border'])
  } finally {
    index.dispose()
    pass.dispose()
    main.dispose()
    await renderer.unmount()
  }
})
