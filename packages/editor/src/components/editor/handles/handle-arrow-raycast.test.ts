import { expect, test } from 'bun:test'
import { _roots, act, createRoot, extend } from '@react-three/fiber'
import { createElement } from 'react'
import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3, type WebGLRenderer } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import useEditor from '../../../store/use-editor'
import { hitAreaRaycast, InvisibleHandleHitArea } from './handle-arrow'

extend({ Mesh })

test('an occluded handle does not sort ahead of a nearer scene body', () => {
  const geometry = new BoxGeometry(0.5, 0.5, 0.5)
  const material = new MeshBasicMaterial()
  const body = new Mesh(geometry, material)
  body.position.z = 1
  body.updateMatrixWorld()
  const handle = new Mesh(geometry, material)
  handle.position.z = 2
  handle.raycast = hitAreaRaycast
  handle.updateMatrixWorld()

  const raycaster = new Raycaster(new Vector3(0, 0, 0), new Vector3(0, 0, 1))
  const hits = raycaster.intersectObjects([body, handle], false)

  expect(hits[0]?.object).toBe(body)
  expect(hits.find((hit) => hit.object === handle)?.distance).toBeGreaterThan(
    hits.find((hit) => hit.object === body)?.distance ?? Number.POSITIVE_INFINITY,
  )

  geometry.dispose()
  material.dispose()
})

test('mounted handles disable synchronously during placement drags and restore after release', async () => {
  const previousDragMode = useEditor.getState().placementDragMode
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  const canvas = new EventTarget() as HTMLCanvasElement
  const root = createRoot(canvas)
  const geometry = new BoxGeometry(1, 1, 1)
  const material = new MeshBasicNodeMaterial()
  try {
    useEditor.setState({ placementDragMode: true })
    await root.configure({
      gl: { render() {}, setSize() {}, setPixelRatio() {} } as unknown as WebGLRenderer,
      frameloop: 'never',
      dpr: 1,
      size: { width: 100, height: 100, top: 0, left: 0 },
    })
    const render = (scale: number) =>
      createElement(InvisibleHandleHitArea, {
        geometry,
        material,
        scale,
        onPointerDown() {},
        onPointerEnter() {},
        onPointerLeave() {},
      })
    await act(async () => root.render(render(1)))
    const scene = _roots.get(canvas)!.store.getState().scene
    const handle = scene.children[0] as Mesh
    scene.updateMatrixWorld(true)
    const raycaster = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1))
    raycaster.layers.enableAll()
    expect(raycaster.intersectObject(handle)).toHaveLength(0)
    useEditor.setState({ placementDragMode: false })
    expect(handle.raycast).toBe(hitAreaRaycast)
    expect(raycaster.intersectObject(handle).length).toBeGreaterThan(0)
    useEditor.setState({ placementDragMode: true })
    expect(raycaster.intersectObject(handle)).toHaveLength(0)
    await act(async () => root.render(render(2)))
    expect(raycaster.intersectObject(handle)).toHaveLength(0)
    await act(async () => root.render(null))
    const detachedRaycast = handle.raycast
    useEditor.setState({ placementDragMode: false })
    expect(handle.raycast).toBe(detachedRaycast)
  } finally {
    await act(async () => root.render(null))
    _roots.delete(canvas)
    geometry.dispose()
    material.dispose()
    useEditor.setState({ placementDragMode: previousDragMode })
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
})
