'use client'

import { flushSync } from 'react-dom'
import { requestWalkthroughPointerLock } from '../lib/walkthrough-pointer-lock'
import useEditor from '../store/use-editor'
import { ViewerControlsBar } from './viewer/viewer-controls-bar'
import { ViewerSceneHeader } from './viewer/viewer-scene-header'

type ProjectOwner = {
  id: string
  name: string
  username: string | null
  image: string | null
}

interface ViewerOverlayProps {
  projectName?: string | null
  owner?: ProjectOwner | null
  canShowScans?: boolean
  canShowGuides?: boolean
  hideBottomBar?: boolean
  onBack?: () => void
}

export const ViewerOverlay = ({
  projectName,
  owner,
  canShowScans = true,
  canShowGuides = true,
  hideBottomBar = false,
  onBack,
}: ViewerOverlayProps) => (
  <>
    <ViewerSceneHeader onBack={onBack} owner={owner} projectName={projectName} />
    {!hideBottomBar ? (
      <ViewerControlsBar
        canShowGuides={canShowGuides}
        canShowScans={canShowScans}
        onWalkthroughToggle={() => {
          flushSync(() => useEditor.getState().setFirstPersonMode(true))
          requestWalkthroughPointerLock()
        }}
      />
    ) : null}
  </>
)
