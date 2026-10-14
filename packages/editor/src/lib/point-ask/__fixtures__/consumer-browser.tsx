import { useScene } from '@pascal-app/core'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PerspectiveCamera, Raycaster } from 'three'
import { setEditorThreeContext } from '../../../components/editor/three-context-bridge'
import { PointAskLayer } from '../../../components/point-ask/point-ask-layer'
import { useAutoSave } from '../../../hooks/use-auto-save'
import useEditor from '../../../store/use-editor'
import { type PointBubble, usePointAsk } from '../../../store/use-point-ask'
import { changeMore, endCompare, redoAsk, sendBubble, startCompare, undoAsk } from '../session'

// Same-package entry: the private fixture uses this window boundary, never Editor src imports.
const saves: unknown[] = []
let saveControls: ReturnType<typeof useAutoSave>
function Host() {
  saveControls = useAutoSave({
    onSave: async (scene) => {
      saves.push(structuredClone(scene))
    },
  })
  return <PointAskLayer />
}
const element = document.createElement('div')
element.id = 'point-consumer-editor'
document.body.append(element)
const root = createRoot(element)
// Only the DOM mode precondition and CPU projection: no renderer or GPU is created.
const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 600
document.body.append(canvas)
const camera = new PerspectiveCamera(50, 4 / 3, 0.1, 100)
camera.position.set(2, 5, 8)
camera.lookAt(2, 0, 2)
setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
useEditor.setState({
  viewMode: '3d',
  workspaceMode: 'edit',
  isPreviewMode: false,
  isFirstPersonMode: false,
})
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
await act(async () => {
  root.render(<Host />)
})

const fixture = {
  scene: useScene,
  point: usePointAsk,
  act,
  saves,
  open: (bubble: PointBubble) =>
    act(async () => {
      usePointAsk.getState().openBubble(bubble)
    }),
  send: (text: string) =>
    act(async () => {
      await sendBubble(text, { x: 0, y: 0, width: 100, height: 20 })
    }),
  changeMore,
  undo: undoAsk,
  redo: redoAsk,
  startCompare,
  endCompare,
  beginLoad: () => saveControls.beginSceneLoad(),
  completeLoad: () => saveControls.completeSceneLoad(),
  saveNow: () => saveControls.saveNow(),
  unmount: () =>
    act(async () => {
      root.unmount()
      setEditorThreeContext(null)
      canvas.remove()
    }),
}
;(window as unknown as { pointEditorFixture: typeof fixture }).pointEditorFixture = fixture
window.dispatchEvent(new Event('point-editor-fixture-ready'))
