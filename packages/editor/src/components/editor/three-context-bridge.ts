import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Camera, Raycaster } from 'three'

// Escape hatch for DOM-level interaction sessions (group pick-up move, Point and ask) that
// need to raycast the 3D view from outside the R3F tree. Mounted unconditionally in
// ViewerSceneContent so the live camera / raycaster / canvas stay available in orbit and
// first-person walkthrough alike; consumers must handle `null` (canvas unmounted).
export type EditorThreeContext = {
  camera: Camera
  raycaster: Raycaster
  domElement: HTMLCanvasElement
}

let current: EditorThreeContext | null = null

export function setEditorThreeContext(ctx: EditorThreeContext | null) {
  current = ctx
}

export function getEditorThreeContext(): EditorThreeContext | null {
  return current
}

export function EditorThreeContextBridge() {
  const camera = useThree((s) => s.camera)
  const raycaster = useThree((s) => s.raycaster)
  const domElement = useThree((s) => s.gl.domElement)

  useEffect(() => {
    setEditorThreeContext({ camera, raycaster, domElement })
    return () => setEditorThreeContext(null)
  }, [camera, raycaster, domElement])

  return null
}
