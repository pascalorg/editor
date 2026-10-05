import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { _roots, act, createRoot, extend } from '@react-three/fiber'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import useSessionGroups from '../store/use-session-groups'

extend({
  Group: THREE.Group,
  Mesh: THREE.Mesh,
  LineSegments: THREE.LineSegments,
  CircleGeometry: THREE.CircleGeometry,
  CylinderGeometry: THREE.CylinderGeometry,
  PlaneGeometry: THREE.PlaneGeometry,
  MeshBasicMaterial: THREE.MeshBasicMaterial,
  LineBasicMaterial: THREE.LineBasicMaterial,
})

export async function withSelectionHarness(
  run: (harness: {
    render: (node: ReactNode) => Promise<void>
    canvas: HTMLCanvasElement
  }) => Promise<void>,
) {
  const scene = useScene.getState()
  const viewer = useViewer.getState()
  const editor = useEditor.getState()
  const scope = useInteractionScope.getState()
  const groups = useSessionGroups.getState()
  const previousWindow = globalThis.window
  const previousRaf = globalThis.requestAnimationFrame
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.requestAnimationFrame = () => 0
  const canvas = Object.assign(new EventTarget(), {
    style: { cursor: '' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
  }) as unknown as HTMLCanvasElement
  const root = createRoot(canvas)
  try {
    const camera = Object.assign(new THREE.OrthographicCamera(-1, 9, 9, -1, 0.1, 100), {
      manual: true,
    })
    camera.position.set(0, 10, 0)
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    await root.configure({
      gl: {
        domElement: canvas,
        render() {},
        setSize() {},
        setPixelRatio() {},
      } as unknown as THREE.WebGLRenderer,
      camera,
      frameloop: 'never',
      dpr: 1,
      size: { width: 1000, height: 1000, top: 0, left: 0 },
    })
    await run({
      render: async (node) => {
        await act(async () => root.render(node))
      },
      canvas,
    })
  } finally {
    await act(async () => root.render(null))
    _roots.delete(canvas)
    useScene.setState(scene)
    useViewer.setState(viewer)
    useEditor.setState(editor)
    useInteractionScope.setState(scope)
    useSessionGroups.setState(groups)
    globalThis.window = previousWindow
    globalThis.requestAnimationFrame = previousRaf
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
}
