'use client'

import { flushSync } from 'react-dom'
import useEditor from '../store/use-editor'
import { ViewerControlsBar } from './viewer/viewer-controls-bar'
import { ViewerSceneHeader } from './viewer/viewer-scene-header'

type ProjectOwner = {
  id: string
  name: string
  username: string | null
  image: string | null
}

function requestWalkthroughPointerLock() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-pascal-viewer-3d] canvas')
  if (!canvas) return

  if (!canvas.hasAttribute('tabindex')) {
    canvas.tabIndex = -1
  }
  canvas.focus({ preventScroll: true })

  if (document.pointerLockElement === canvas) return

  try {
    // The request can also reject ASYNC (browser cooldown after a recent
    // unlock) — swallow it like the P-resume path; clicking the canvas
    // re-requests once the cooldown passes.
    const result = canvas.requestPointerLock?.() as Promise<void> | undefined
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch {
    return
  }
}

interface ViewerOverlayProps {
  projectName?: string | null
  owner?: ProjectOwner | null
  canShowScans?: boolean
  canShowGuides?: boolean
  onBack?: () => void
}

export const ViewerOverlay = ({
  projectName,
  owner,
  canShowScans = true,
  canShowGuides = true,
  onBack,
}: ViewerOverlayProps) => (
  <>
    <ViewerSceneHeader onBack={onBack} owner={owner} projectName={projectName} />
    <ViewerControlsBar
      canShowGuides={canShowGuides}
      canShowScans={canShowScans}
      onWalkthroughToggle={() => {
        flushSync(() => useEditor.getState().setFirstPersonMode(true))
        requestWalkthroughPointerLock()
      }}
    />
  </>
)
