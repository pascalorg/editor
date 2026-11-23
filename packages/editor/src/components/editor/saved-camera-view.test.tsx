import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  emitter,
  LevelNode,
  SiteNode,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { frameViewerNode } from '@pascal-app/viewer/ui'
import { CameraControlsImpl } from '@react-three/drei'
import { _roots, act, createRoot, extend, useThree } from '@react-three/fiber'
import { type ReactNode, useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import useEditor, { takePreviewCameraRestore } from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import useSessionGroups from '../../store/use-session-groups'
import { CustomCameraControls } from './custom-camera-controls'
import {
  applySavedCameraView,
  captureSavedCameraView,
  readSavedCameraView,
  readSettledOrthographicZoom,
} from './saved-camera-view'

extend({
  Group: THREE.Group,
  Mesh: THREE.Mesh,
  OrthographicCamera: THREE.OrthographicCamera,
  PerspectiveCamera: THREE.PerspectiveCamera,
})

const scope = globalThis as Record<string, unknown>
const stubDomRect = !scope.DOMRect
beforeAll(() => {
  if (stubDomRect) scope.DOMRect = class {}
  CameraControlsImpl.install({ THREE })
})
afterAll(() => {
  if (stubDomRect) delete scope.DOMRect
})

function StageCamera() {
  const cameraMode = useViewer((s) => s.cameraMode)
  const set = useThree((s) => s.set)
  const camera = useMemo(() => {
    if (cameraMode === 'orthographic') {
      const ortho = new THREE.OrthographicCamera(-600, 600, 400, -400, -1000, 1000)
      ortho.zoom = 20
      ortho.position.set(10, 10, 10)
      ortho.updateProjectionMatrix()
      return ortho
    }
    const persp = new THREE.PerspectiveCamera(50, 1200 / 800, 0.3, 1000)
    persp.position.set(10, 10, 10)
    persp.updateProjectionMatrix()
    return persp
  }, [cameraMode])

  useLayoutEffect(() => {
    set({ camera })
  }, [camera, set])

  return <primitive object={camera} />
}

function settleControls(control: CameraControlsImpl, steps = 180) {
  for (let i = 0; i < steps; i++) {
    control.update(1 / 60)
  }
}

async function withCameraStage(
  run: (stage: {
    render: (node: ReactNode) => Promise<void>
    getCamera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera
    getControls: () => CameraControlsImpl
  }) => Promise<void>,
) {
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  const previousEditor = useEditor.getState()
  const previousScope = useInteractionScope.getState()
  const previousGroups = useSessionGroups.getState()
  takePreviewCameraRestore()
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousRaf = globalThis.requestAnimationFrame
  const previousCancelRaf = globalThis.cancelAnimationFrame
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT

  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  const windowTarget = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    matchMedia: () => ({ matches: false }),
  }) as unknown as Window & typeof globalThis
  globalThis.window = windowTarget
  globalThis.document = Object.assign(new EventTarget(), {
    body: { style: { cursor: '' } },
  }) as unknown as Document
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  }
  globalThis.cancelAnimationFrame = () => {}

  const canvas = Object.assign(new EventTarget(), {
    ownerDocument: globalThis.document,
    style: { cursor: '', touchAction: '' },
    setAttribute() {},
    removeAttribute() {},
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1200,
      height: 800,
      x: 0,
      y: 0,
      right: 1200,
      bottom: 800,
      toJSON: () => ({}),
    }),
  }) as unknown as HTMLCanvasElement

  const root = createRoot(canvas)
  try {
    const initialCamera = new THREE.PerspectiveCamera(50, 1200 / 800, 0.3, 1000)
    initialCamera.position.set(10, 10, 10)
    initialCamera.lookAt(0, 0, 0)
    initialCamera.updateMatrixWorld(true)

    await root.configure({
      gl: {
        domElement: canvas,
        render() {},
        setSize() {},
        setPixelRatio() {},
      } as unknown as THREE.WebGLRenderer,
      camera: initialCamera,
      frameloop: 'never',
      dpr: 1,
      size: { width: 1200, height: 800, top: 0, left: 0 },
    })

    const getStore = () => _roots.get(canvas)!.store
    await run({
      render: async (node) => {
        await act(async () => {
          root.render(node)
        })
      },
      getCamera: () =>
        getStore().getState().camera as THREE.PerspectiveCamera | THREE.OrthographicCamera,
      getControls: () => getStore().getState().controls as unknown as CameraControlsImpl,
    })
  } finally {
    await act(async () => {
      root.render(null)
    })
    _roots.delete(canvas)
    takePreviewCameraRestore()
    useScene.setState(previousScene)
    useViewer.setState(previousViewer)
    useEditor.setState(previousEditor)
    useInteractionScope.setState(previousScope)
    useSessionGroups.setState(previousGroups)
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    globalThis.requestAnimationFrame = previousRaf
    globalThis.cancelAnimationFrame = previousCancelRaf
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
}

function makeProjectNodes(
  siteCamera?: Record<string, unknown>,
  zoneCamera?: Record<string, unknown>,
) {
  const zone = ZoneNode.parse({
    id: 'zone_studio',
    name: 'Studio',
    parentId: 'level_0',
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    ...(zoneCamera ? { camera: zoneCamera } : {}),
  })
  const level = LevelNode.parse({
    id: 'level_0',
    parentId: 'building_0',
    level: 0,
    children: [zone.id],
  })
  const building = BuildingNode.parse({
    id: 'building_0',
    parentId: 'site_0',
    children: [level.id],
  })
  const site = SiteNode.parse({
    id: 'site_0',
    children: [building.id],
    ...(siteCamera ? { camera: siteCamera } : {}),
  })
  return {
    [site.id]: site,
    [building.id]: building,
    [level.id]: level,
    [zone.id]: zone,
  } as Record<string, AnyNode>
}

function expectCloseTuple(actual: readonly number[], expected: readonly number[], digits = 6) {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]!).toBeCloseTo(expected[i]!, digits)
  }
}

describe('saved camera view helpers', () => {
  test('round-trips a perspective view with custom fov and an orthographic view with custom zoom', () => {
    const perspCamera = new THREE.PerspectiveCamera(34, 1.5, 0.3, 1000)
    const perspControls = new CameraControlsImpl(perspCamera)
    try {
      perspControls.setLookAt(14, 7, 18, 2, 1.2, -3, false)
      perspControls.update(0)
      const capturedPersp = captureSavedCameraView(perspControls, perspCamera, 'perspective')
      expect(capturedPersp.mode).toBe('perspective')
      expect(capturedPersp.fov).toBe(34)
      expectCloseTuple(capturedPersp.position, [14, 7, 18])
      expectCloseTuple(capturedPersp.target, [2, 1.2, -3])

      const restoredPerspCamera = new THREE.PerspectiveCamera(50, 1.5, 0.3, 1000)
      const restoredPerspControls = new CameraControlsImpl(restoredPerspCamera)
      try {
        applySavedCameraView(
          restoredPerspControls,
          restoredPerspCamera,
          readSavedCameraView(capturedPersp)!,
          false,
        )
        expect(restoredPerspCamera.fov).toBe(34)
        expectCloseTuple(
          restoredPerspControls.getPosition(new THREE.Vector3()).toArray(),
          [14, 7, 18],
        )
        expectCloseTuple(
          restoredPerspControls.getTarget(new THREE.Vector3()).toArray(),
          [2, 1.2, -3],
        )
      } finally {
        restoredPerspControls.dispose()
      }
    } finally {
      perspControls.dispose()
    }

    const orthoCamera = new THREE.OrthographicCamera(-600, 600, 400, -400, -1000, 1000)
    orthoCamera.zoom = 20
    const orthoControls = new CameraControlsImpl(orthoCamera)
    try {
      orthoControls.setLookAt(16, 12, 20, 3, 1.5, -2, true)
      orthoControls.zoomTo(42, true)
      // Guard against camera-controls renaming or removing the private `_zoomEnd` field
      // that `readSettledOrthographicZoom` relies on while a damped zoom is in flight.
      expect('_zoomEnd' in orthoControls).toBe(true)
      expect((orthoControls as unknown as { _zoomEnd?: unknown })._zoomEnd).toBe(42)
      expect(orthoCamera.zoom).toBe(20)
      expect(readSettledOrthographicZoom(orthoControls, orthoCamera)).toBe(42)
      // Capture before damping finishes: settled destination zoom (42) must still be saved.
      const capturedOrtho = captureSavedCameraView(orthoControls, orthoCamera, 'orthographic')
      expect(capturedOrtho.mode).toBe('orthographic')
      expect(capturedOrtho.zoom).toBe(42)
      expectCloseTuple(capturedOrtho.position, [16, 12, 20])
      expectCloseTuple(capturedOrtho.target, [3, 1.5, -2])

      const restoredOrthoCamera = new THREE.OrthographicCamera(-600, 600, 400, -400, -1000, 1000)
      restoredOrthoCamera.zoom = 20
      const restoredOrthoControls = new CameraControlsImpl(restoredOrthoCamera)
      try {
        applySavedCameraView(
          restoredOrthoControls,
          restoredOrthoCamera,
          readSavedCameraView(capturedOrtho)!,
          false,
        )
        expect(restoredOrthoCamera.zoom).toBe(42)
        expectCloseTuple(
          restoredOrthoControls.getPosition(new THREE.Vector3()).toArray(),
          [16, 12, 20],
        )
        expectCloseTuple(
          restoredOrthoControls.getTarget(new THREE.Vector3()).toArray(),
          [3, 1.5, -2],
        )
      } finally {
        restoredOrthoControls.dispose()
      }
    } finally {
      orthoControls.dispose()
    }
  })

  test('older saved views without mode, fov, or zoom fall back to current lens and projection', () => {
    const legacy = readSavedCameraView({ position: [8, 6, 10], target: [1, 0, -1] })
    expect(legacy).toEqual({ position: [8, 6, 10], target: [1, 0, -1] })

    const orthoCamera = new THREE.OrthographicCamera(-600, 600, 400, -400, -1000, 1000)
    orthoCamera.zoom = 33
    orthoCamera.updateProjectionMatrix()
    const orthoControls = new CameraControlsImpl(orthoCamera)
    try {
      applySavedCameraView(orthoControls, orthoCamera, legacy!, false)
      expect(orthoCamera.zoom).toBe(33)
      expectCloseTuple(orthoControls.getPosition(new THREE.Vector3()).toArray(), [8, 6, 10])
      expectCloseTuple(orthoControls.getTarget(new THREE.Vector3()).toArray(), [1, 0, -1])
    } finally {
      orthoControls.dispose()
    }
  })
})

describe('CustomCameraControls saved view round-trip (#1280)', () => {
  test('orthographic view with custom zoom round-trips on project open, view-saved-camera, and views bar framing', async () => {
    await withCameraStage(async ({ render, getCamera, getControls }) => {
      useScene.setState({ nodes: makeProjectNodes(), readOnly: false })
      useViewer.setState({ cameraMode: 'orthographic' })
      useEditor.setState({
        isFirstPersonMode: false,
        isPreviewMode: false,
        openingCameraSettled: true,
      })

      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )

      const orthoControls = getControls()
      expect((getCamera() as THREE.OrthographicCamera).isOrthographicCamera).toBe(true)
      orthoControls.setLookAt(16, 12, 20, 3, 1.5, -2, false)
      orthoControls.zoomTo(42, false)
      orthoControls.update(0)

      await act(async () => {
        emitter.emit('camera-controls:capture', { nodeId: 'site_0' as never })
      })

      const saved = useScene.getState().nodes.site_0?.camera
      expect(saved?.mode).toBe('orthographic')
      expect(saved?.zoom).toBe(42)
      expectCloseTuple(saved!.position, [16, 12, 20])
      expectCloseTuple(saved!.target, [3, 1.5, -2])

      // Switch to perspective and move somewhere else, then restore via camera-controls:view.
      await act(async () => {
        useViewer.getState().setCameraMode('perspective')
      })
      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )
      expect((getCamera() as THREE.PerspectiveCamera).isPerspectiveCamera).toBe(true)
      getControls().setLookAt(30, 25, 30, 0, 0, 0, false)
      getControls().update(0)

      await act(async () => {
        emitter.emit('camera-controls:view', { nodeId: 'site_0' as never })
      })
      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )
      settleControls(getControls())

      expect(useViewer.getState().cameraMode).toBe('orthographic')
      expect((getCamera() as THREE.OrthographicCamera).isOrthographicCamera).toBe(true)
      expect((getCamera() as THREE.OrthographicCamera).zoom).toBeCloseTo(42, 5)
      const viewPos = getControls().getPosition(new THREE.Vector3(), false)
      const viewTarget = getControls().getTarget(new THREE.Vector3(), false)
      expect(viewPos.x).toBeCloseTo(16, 4)
      expect(viewPos.y).toBeCloseTo(12, 4)
      expect(viewPos.z).toBeCloseTo(20, 4)
      expect(viewTarget.x).toBeCloseTo(3, 4)
      expect(viewTarget.y).toBeCloseTo(1.5, 4)
      expect(viewTarget.z).toBeCloseTo(-2, 4)

      // Now reopen the project from perspective mode (`sceneReady` false -> true) and verify opening camera restores orthographic + zoom 42.
      await act(async () => {
        useViewer.getState().setCameraMode('perspective')
        useEditor.setState({ openingCameraSettled: false })
      })
      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady={false} />
        </>,
      )
      expect((getCamera() as THREE.PerspectiveCamera).isPerspectiveCamera).toBe(true)

      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )
      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )
      settleControls(getControls())

      expect(useViewer.getState().cameraMode).toBe('orthographic')
      expect((getCamera() as THREE.OrthographicCamera).isOrthographicCamera).toBe(true)
      expect((getCamera() as THREE.OrthographicCamera).zoom).toBeCloseTo(42, 5)
      const openPos = getControls().getPosition(new THREE.Vector3(), false)
      const openTarget = getControls().getTarget(new THREE.Vector3(), false)
      expect(openPos.x).toBeCloseTo(16, 4)
      expect(openPos.y).toBeCloseTo(12, 4)
      expect(openPos.z).toBeCloseTo(20, 4)
      expect(openTarget.x).toBeCloseTo(3, 4)
      expect(openTarget.y).toBeCloseTo(1.5, 4)
      expect(openTarget.z).toBeCloseTo(-2, 4)

      // Also verify framing a room/zone with an orthographic saved camera from the header/views bar (`frameViewerNode`).
      const withZoneCamera = makeProjectNodes(saved, {
        position: [6, 14, 8],
        target: [3, 0.8, 2],
        mode: 'orthographic',
        zoom: 36,
      })
      useScene.setState({ nodes: withZoneCamera })
      await act(async () => {
        useViewer.getState().setCameraMode('perspective')
      })
      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )
      await act(async () => {
        frameViewerNode('zone_studio', {
          nodes: useScene.getState().nodes,
          objectFor: () => undefined,
        })
      })
      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )
      settleControls(getControls())

      expect(useViewer.getState().cameraMode).toBe('orthographic')
      expect((getCamera() as THREE.OrthographicCamera).zoom).toBeCloseTo(36, 5)
      expect(getControls().getTarget(new THREE.Vector3(), false).y).toBeCloseTo(0.8, 4)
    })
  })

  test('perspective view with custom fov round-trips on project open and view-saved-camera, and legacy views preserve active mode', async () => {
    await withCameraStage(async ({ render, getCamera, getControls }) => {
      useScene.setState({ nodes: makeProjectNodes(), readOnly: false })
      useViewer.setState({ cameraMode: 'perspective' })
      useEditor.setState({
        isFirstPersonMode: false,
        isPreviewMode: false,
        openingCameraSettled: true,
      })

      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )

      const perspCam = getCamera() as THREE.PerspectiveCamera
      perspCam.fov = 35
      perspCam.updateProjectionMatrix()
      getControls().setLookAt(14, 6, 18, 1, 1.1, -2, false)
      getControls().update(0)

      await act(async () => {
        emitter.emit('camera-controls:capture', { nodeId: 'site_0' as never })
      })
      const savedPersp = useScene.getState().nodes.site_0?.camera
      expect(savedPersp?.mode).toBe('perspective')
      expect(savedPersp?.fov).toBe(35)
      expectCloseTuple(savedPersp!.position, [14, 6, 18])
      expectCloseTuple(savedPersp!.target, [1, 1.1, -2])

      // Switch to orthographic with custom zoom, then reopen project -> switches back to perspective with fov 35.
      await act(async () => {
        useViewer.getState().setCameraMode('orthographic')
        useEditor.setState({ openingCameraSettled: false })
      })
      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady={false} />
        </>,
      )
      getControls().zoomTo(60, false)
      getControls().update(0)

      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )
      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )
      settleControls(getControls())

      expect(useViewer.getState().cameraMode).toBe('perspective')
      expect((getCamera() as THREE.PerspectiveCamera).isPerspectiveCamera).toBe(true)
      expect((getCamera() as THREE.PerspectiveCamera).fov).toBe(35)
      expect(getControls().getPosition(new THREE.Vector3(), false).x).toBeCloseTo(14, 4)
      expect(getControls().getTarget(new THREE.Vector3(), false).y).toBeCloseTo(1.1, 4)

      // Legacy saved view without mode/fov/zoom parsed through SiteNode/updateNode keeps current projection and lens intact.
      useScene.setState({
        nodes: makeProjectNodes(),
      })
      useScene.getState().updateNode('site_0' as never, {
        camera: { position: [10, 8, 12], target: [0, 0.5, 0] },
      })
      expect(useScene.getState().nodes.site_0?.camera).toEqual({
        position: [10, 8, 12],
        target: [0, 0.5, 0],
      })
      await act(async () => {
        useViewer.getState().setCameraMode('orthographic')
      })
      await render(
        <>
          <StageCamera />
          <CustomCameraControls sceneReady />
        </>,
      )
      getControls().zoomTo(28, false)
      getControls().update(0)

      await act(async () => {
        emitter.emit('camera-controls:view', { nodeId: 'site_0' as never })
      })
      settleControls(getControls())

      expect(useViewer.getState().cameraMode).toBe('orthographic')
      expect((getCamera() as THREE.OrthographicCamera).zoom).toBeCloseTo(28, 5)
      expect(getControls().getPosition(new THREE.Vector3(), false).z).toBeCloseTo(12, 4)
    })
  })
})
