import { expect, test } from 'bun:test'
import { RoofSegmentNode, sceneRegistry, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { hideFromScene, showInScene, useViewer } from '@pascal-app/viewer'
import { _roots, act, createRoot, extend, type Instance, type ThreeEvent } from '@react-three/fiber'
import { createElement } from 'react'
import * as THREE from 'three'
import useInteractionScope from '../../../store/use-interaction-scope'
import { RoofEditSystem } from './roof-edit-system'

extend({ Group: THREE.Group, Mesh: THREE.Mesh, LineSegments: THREE.LineSegments })

test('roof trim drag keeps its plane hit over a surface joining and leaving a batch', async () => {
  const previousViewer = useViewer.getState()
  const previousScene = useScene.getState()
  const previousScope = useInteractionScope.getState().scope
  const previousOverrides = useLiveNodeOverrides.getState()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const events = Object.assign(new EventTarget(), { setTimeout, clearTimeout })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { body: { style: { cursor: '' } } },
  })
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  }) as unknown as HTMLCanvasElement
  const root = createRoot(canvas)
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 15, 10)
  camera.lookAt(0, 3, 0)
  camera.updateMatrixWorld()
  const scene = new THREE.Scene()
  const segment = RoofSegmentNode.parse({
    id: 'rseg_batch_drag',
    width: 10,
    depth: 10,
    metadata: { showTrimPlanes: true },
  })
  const source = new THREE.Group()
  const surface = new THREE.Mesh(new THREE.BoxGeometry(30, 0.25, 30), new THREE.MeshBasicMaterial())
  surface.position.y = 2
  scene.add(surface)
  scene.updateMatrixWorld(true)
  try {
    sceneRegistry.nodes.set(segment.id, source)
    useScene.setState({ nodes: { [segment.id]: segment }, readOnly: false })
    useViewer.setState({
      hoveredId: null,
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [segment.id] },
    })
    await root.configure({
      gl: {
        domElement: canvas,
        render() {},
        setSize() {},
        setPixelRatio() {},
      } as unknown as THREE.WebGLRenderer,
      camera,
      scene,
      frameloop: 'never',
      dpr: 1,
      size: { width: 100, height: 100, top: 0, left: 0 },
    })
    await act(async () => {
      root.render(createElement(RoofEditSystem))
    })
    let pointerDown: ((event: ThreeEvent<PointerEvent>) => void) | undefined
    scene.traverse((object) => {
      const instance = (object as THREE.Object3D & { __r3f?: Instance }).__r3f
      pointerDown ??= instance?.handlers.onPointerDown
    })
    expect(pointerDown).toBeDefined()
    await act(async () => {
      pointerDown!({
        button: 0,
        clientX: 50,
        clientY: 50,
        stopPropagation() {},
      } as ThreeEvent<PointerEvent>)
    })
    const move = async () => {
      await act(async () => {
        events.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 60, clientY: 60 }))
      })
      return useLiveNodeOverrides.getState().overrides.get(segment.id)?.trim
    }
    const before = await move()
    expect(before).toBeDefined()
    expect(Object.values(before!).some((value) => (value as number) > 0)).toBe(true)
    hideFromScene(surface, 'batched')
    expect(await move()).toEqual(before)
    showInScene(surface, 'batched')
    expect(await move()).toEqual(before)
    await act(async () => {
      events.dispatchEvent(new Event('pointercancel'))
    })
    expect(useLiveNodeOverrides.getState().overrides.has(segment.id)).toBe(false)
  } finally {
    await act(async () => {
      root.render(null)
    })
    _roots.delete(canvas)
    sceneRegistry.nodes.delete(segment.id)
    surface.geometry.dispose()
    surface.material.dispose()
    useScene.setState(previousScene)
    useViewer.setState(previousViewer)
    useInteractionScope.setState({ scope: previousScope })
    useLiveNodeOverrides.setState(previousOverrides)
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
