'use client'

import { initSpatialGridSync, useScene } from '@pascal-app/core'
import {
  applySceneGraphToEditor,
  FirstPersonControls,
  ParametricViewerRooms,
  type SceneGraph,
  useEditor,
  useFirstPersonHud,
  useViewerFloorDisplay,
  ViewerControlsBar,
  ViewerHoverLabel,
  ViewerSceneHeader,
  ViewerSelectionManager,
  ViewerStage,
  type ViewerStageMode,
  WalkthroughHud,
} from '@pascal-app/editor'
import { InteractiveSystem, SceneEnvironment, useViewer, Viewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { Component, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { EmbedCameraControls } from '@/components/embed-camera-controls'
import { cn } from '@/lib/utils'

interface EmbedViewerProps {
  id: string
  name: string
  graph: SceneGraph
  /** The editor's Preview chrome (header, controls bar, 3D/2D switcher). Off for `?ui=0`. */
  chrome?: boolean
}

type LevelId = ReturnType<typeof useViewer.getState>['selection']['levelId']

const THREE_D_ONLY = ['3d'] as const
// Where Preview puts its 3D/2D switcher.
const SWITCHER_POSITION =
  'top-28 right-4 left-auto translate-x-0 md:top-4 md:right-auto md:left-1/2 md:-translate-x-1/2'

/**
 * A read-only view of a shared project, for `/embed/<id>`: the editor's Preview
 * mode without the back button, or the bare 3D view when `chrome` is off.
 */
export function EmbedViewer({ id, name, graph, chrome = true }: EmbedViewerProps) {
  const [loaded, setLoaded] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)
  const [mode, setMode] = useState<ViewerStageMode>('3d')
  const isFirstPersonMode = useEditor((s) => s.isFirstPersonMode)
  const hasFloorplan = useScene((s) => Object.values(s.nodes).some((node) => node.type === 'level'))

  useEffect(() => {
    useScene.getState().unloadScene()
    applySceneGraphToEditor(graph)
    // The editor's loader picks a level, as Preview opens on. The bare view has
    // no floor list to leave it by, so it shows the whole building instead.
    if (!chrome) useViewer.getState().resetSelection()
    const stopSpatialSync = initSpatialGridSync()
    setLoaded(true)
    return () => {
      stopSpatialSync()
      useScene.getState().unloadScene()
    }
  }, [graph, chrome])

  useViewerFloorDisplay()
  useWalkthroughViewerSync(isFirstPersonMode)

  const handleModeChange = useCallback((nextMode: ViewerStageMode) => {
    if (nextMode !== '3d') useEditor.getState().setFirstPersonMode(false)
    setMode(nextMode)
  }, [])

  const showStageChrome = chrome && hasFloorplan && !isFirstPersonMode
  const stageMode = showStageChrome ? mode : '3d'

  return (
    <div className="dark relative h-screen w-screen overflow-hidden bg-neutral-100 text-foreground">
      {chrome &&
        (isFirstPersonMode ? (
          <EmbedWalkthroughHud />
        ) : (
          <>
            <ViewerSceneHeader backHref={null} projectName={name} />
            {stageMode === '3d' && (
              <ViewerControlsBar
                onWalkthroughToggle={() => {
                  flushSync(() => useEditor.getState().setFirstPersonMode(true))
                  requestWalkthroughPointerLock()
                }}
              />
            )}
          </>
        ))}
      {chrome && stageMode === '3d' && !isFirstPersonMode && <ViewerHoverLabel />}

      <ViewerErrorBoundary>
        {loaded && (
          <ViewerStage
            className="absolute inset-0"
            mode={stageMode}
            modes={showStageChrome ? undefined : THREE_D_ONLY}
            onModeChange={handleModeChange}
            showCompass={showStageChrome}
            showSwitcher={showStageChrome}
            switcherClassName={SWITCHER_POSITION}
          >
            <Viewer
              defaultRender={{ shading: 'rendered' }}
              onSceneReadyChange={setSceneReady}
              renderContext="viewer"
              sceneReadyKey={id}
              selectionManager="custom"
              useBvh={false}
            >
              <SceneEnvironment />
              {chrome && <ViewerSelectionManager />}
              {chrome && <ParametricViewerRooms />}
              <InteractiveSystem />
              {isFirstPersonMode && <FirstPersonControls />}
              <EmbedCameraControls sceneReady={sceneReady} selectable={chrome} />
            </Viewer>
          </ViewerStage>
        )}
      </ViewerErrorBoundary>

      {!isFirstPersonMode && (
        <a
          // The floorplan keeps its zoom buttons in the bottom-right corner; sit above them.
          className={cn(
            'corner-smooth absolute z-20 inline-flex items-center gap-1.5 rounded-2xl border border-border/40 bg-background/95 px-3 py-2 font-medium text-foreground text-xs shadow-elevation-4 backdrop-blur-xl transition-colors hover:bg-background',
            stageMode === '3d' ? 'right-3 bottom-3' : 'right-4 bottom-16',
          )}
          href="https://editor.pascal.app"
          rel="noopener"
          target="_blank"
        >
          <Image
            alt=""
            className="h-3.5 w-3.5 invert"
            height={14}
            src="/pascal-logo-shape.svg"
            width={14}
          />
          Made with Pascal
        </a>
      )}
    </div>
  )
}

/**
 * The editor turns its first-person flag into the viewer's walkthrough state
 * (perspective, walls up, nothing selected) and hands the floor back on exit.
 * The embed has no editor around it, so it does the same here.
 */
function useWalkthroughViewerSync(isFirstPersonMode: boolean) {
  const previousLevelId = useRef<LevelId>(null)
  const wasFirstPerson = useRef(isFirstPersonMode)

  useEffect(() => {
    const was = wasFirstPerson.current
    wasFirstPerson.current = isFirstPersonMode
    const viewer = useViewer.getState()

    if (isFirstPersonMode && !was) {
      previousLevelId.current = viewer.selection.levelId
      viewer.setCameraMode('perspective')
      viewer.setWallMode('up')
      viewer.setWalkthroughMode(true)
      viewer.setSelection({ selectedIds: [], zoneId: null })
      return
    }
    if (!was || isFirstPersonMode) return

    viewer.setWalkthroughMode(false)
    const levelId = previousLevelId.current
    previousLevelId.current = null
    if (levelId && useScene.getState().nodes[levelId]?.type === 'level') {
      viewer.setSelection({ levelId, zoneId: null, selectedIds: [] })
    }
  }, [isFirstPersonMode])

  useEffect(() => () => useEditor.getState().setFirstPersonMode(false), [])
}

function EmbedWalkthroughHud() {
  const floorLabel = useFirstPersonHud((s) => s.floorLabel)
  const zoneLabel = useFirstPersonHud((s) => s.zoneLabel)
  const interact = useFirstPersonHud((s) => s.interact)
  const suspended = useViewer((s) => s.walkthroughSuspended)

  return (
    <WalkthroughHud
      floorLabel={floorLabel}
      interact={interact}
      onExit={() => {
        if (document.pointerLockElement) document.exitPointerLock()
        useEditor.getState().setFirstPersonMode(false)
      }}
      suspended={suspended}
      zoneLabel={zoneLabel}
    />
  )
}

/**
 * Lock the pointer on the 3D canvas inside the walkthrough click, as Preview
 * does. A refused lock (the browser's re-lock cooldown) is fine: clicking the
 * canvas locks it.
 */
function requestWalkthroughPointerLock() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-pascal-viewer-3d] canvas')
  if (!canvas) return
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = -1
  canvas.focus({ preventScroll: true })
  if (document.pointerLockElement === canvas) return
  try {
    const result = canvas.requestPointerLock?.() as Promise<void> | undefined
    result?.catch?.(() => {})
  } catch {
    // Clicking the canvas still locks.
  }
}

class ViewerErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center">
        <p className="max-w-sm text-neutral-600 text-sm">
          This project could not be shown in 3D here. Try a browser with hardware acceleration
          turned on.
        </p>
      </div>
    )
  }
}
