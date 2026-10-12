'use client'

import { initSpatialGridSync, useScene } from '@pascal-app/core'
import { applySceneGraphToEditor, type SceneGraph } from '@pascal-app/editor'
import { SceneEnvironment, useViewer, Viewer } from '@pascal-app/viewer'
import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import Image from 'next/image'
import { Component, type ReactNode, useEffect, useRef, useState } from 'react'

interface EmbedViewerProps {
  id: string
  name: string
  graph: SceneGraph
}

const CHIP =
  'pointer-events-auto rounded-full border border-white/10 bg-black/60 px-3 py-1.5 font-medium text-white text-xs shadow-lg backdrop-blur-sm'

/** A read-only 3D view of a shared project, for `/embed/<id>`. */
export function EmbedViewer({ id, name, graph }: EmbedViewerProps) {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    useScene.getState().unloadScene()
    applySceneGraphToEditor(graph)
    // The editor's loader picks a level; a viewer shows the whole building.
    useViewer.getState().resetSelection()
    const stopSpatialSync = initSpatialGridSync()
    setLoaded(true)
    return () => {
      stopSpatialSync()
      useScene.getState().unloadScene()
    }
  }, [graph])

  return (
    <div className="dark relative h-screen w-screen overflow-hidden bg-[#0f0f10] text-foreground [color-scheme:dark]">
      <ViewerErrorBoundary>
        {loaded && (
          <div className="absolute inset-0">
            <Viewer
              defaultRender={{ shading: 'rendered' }}
              renderContext="viewer"
              sceneReadyKey={id}
              selectionManager="custom"
              useBvh={false}
            >
              <SceneEnvironment />
              <EmbedCameraControls />
            </Viewer>
          </div>
        )}
      </ViewerErrorBoundary>

      <div className="pointer-events-none absolute inset-0 z-10">
        <div className={`${CHIP} absolute top-3 left-3 max-w-[calc(100%-1.5rem)] truncate`}>
          {name}
        </div>
        <a
          className={`${CHIP} absolute bottom-3 left-3 inline-flex items-center gap-1.5 transition-colors hover:bg-black/80`}
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
      </div>
    </div>
  )
}

/** Orbit only: there is nothing to select, so the left button rotates. */
function EmbedCameraControls() {
  const controls = useRef<CameraControlsImpl>(null)
  const site = useScene((state) => Object.values(state.nodes).find((node) => node.type === 'site'))
  const opened = useRef(false)

  useEffect(() => {
    const control = controls.current
    if (!control || opened.current) return
    if (!site) {
      control.setLookAt(30, 30, 30, 0, 0, 0, false)
      return
    }
    opened.current = true
    if (!site.camera) {
      control.setLookAt(30, 30, 30, 0, 0, 0, false)
      return
    }
    const { position, target } = site.camera
    control.setLookAt(position[0], position[1], position[2], target[0], target[1], target[2], false)
  }, [site])

  return (
    <CameraControls
      makeDefault
      maxDistance={100}
      maxPolarAngle={Math.PI / 2 - 0.1}
      minDistance={5}
      minPolarAngle={0}
      mouseButtons={{
        left: CameraControlsImpl.ACTION.ROTATE,
        middle: CameraControlsImpl.ACTION.SCREEN_PAN,
        right: CameraControlsImpl.ACTION.SCREEN_PAN,
        wheel: CameraControlsImpl.ACTION.DOLLY,
      }}
      ref={controls}
      touches={{
        one: CameraControlsImpl.ACTION.TOUCH_ROTATE,
        two: CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK,
        three: CameraControlsImpl.ACTION.TOUCH_TRUCK,
      }}
    />
  )
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
        <p className="max-w-sm text-sm text-white/70">
          This project could not be shown in 3D here. Try a browser with hardware acceleration
          turned on.
        </p>
      </div>
    )
  }
}
