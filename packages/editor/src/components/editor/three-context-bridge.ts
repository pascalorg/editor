import type { Camera, Raycaster } from 'three'

// Escape hatch for DOM-level interaction sessions (group pick-up move) that
// need to raycast the 3D view without living inside the R3F tree. The
// editor's SelectionManager (always mounted with the canvas) publishes the
// live camera / raycaster / canvas here; consumers must handle `null`
// (canvas not mounted yet, or torn down).
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
