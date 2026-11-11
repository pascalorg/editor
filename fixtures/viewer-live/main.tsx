import {
  acquireSceneReadOnlyLease,
  emitter,
  loadPlugin,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { renderPlugin } from '@pascal-app/nodes/render'
import {
  configureViewer,
  OVERLAY_LAYER,
  pendingSceneBuildCount,
  useViewer,
  Viewer,
} from '@pascal-app/viewer'
import { initInteractionSounds } from '@pascal-app/viewer/sfx'
import { ParametricViewerRooms, SceneLoader, ViewerControlsBar } from '@pascal-app/viewer/ui'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Mesh } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import sceneJson from './scene.json'

type SceneInput = Parameters<ReturnType<typeof useScene.getState>['setScene']>
// JSON imports widen discriminants; setScene validates and migrates the graph on load.
const scene = sceneJson as unknown as {
  nodes: SceneInput[0]
  rootNodeIds: SceneInput[1]
} & NonNullable<SceneInput[2]>

configureViewer({
  assetsBaseUrl: window.location.origin,
  sfxBaseUrl: '/fixture-sfx',
  iconsBaseUrl: '/icons',
})
// The packed sfx entry loads its files from the configured base; the check intercepts them.
initInteractionSounds()
Object.assign(window, { playFixtureSound: () => emitter.emit('interaction:sound', 'door-open') })
await loadPlugin(renderPlugin)
const releaseReadOnly = acquireSceneReadOnlyLease()
useScene.getState().setScene(scene.nodes, scene.rootNodeIds, {
  materials: scene.materials,
  collections: scene.collections,
  installedPlugins: scene.installedPlugins,
})
useViewer.getState().setTextures(false)
useViewer.getState().setSelection({
  buildingId: 'building_fixture',
  levelId: 'level_fixture',
  zoneId: 'zone_fixture',
  selectedIds: [],
})

// Inspect the real scene roots rather than counting the viewer's grid/backdrop.
function GeometryProbe() {
  const gl = useThree((state) => state.gl) as unknown as WebGPURenderer
  const root = useThree((state) => state.scene)
  useFrame(() => {
    const geometry: Record<string, number> = {}
    for (const id of Object.keys(scene.nodes)) {
      let vertices = 0
      sceneRegistry.nodes.get(id)?.traverse((object) => {
        const mesh = object as Mesh
        vertices += mesh.geometry?.getAttribute('position')?.count ?? 0
      })
      geometry[id] = vertices
    }
    // The room highlight draws on the overlay layer only.
    let overlay = 0
    root.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.layers.mask === 1 << OVERLAY_LAYER)
        overlay += mesh.geometry?.getAttribute('position')?.count ?? 0
    })
    Object.assign(window, {
      viewerFixture: {
        geometry,
        pending: pendingSceneBuildCount(),
        overlay,
        itemFailures: useViewer.getState().itemLoadFailures,
        drawCalls: gl.info.render.drawCalls,
      },
    })
    // After the viewer's render (priority 1), so the counts describe the frame just drawn.
  }, 2)
  return null
}

function App() {
  const [ready, setReady] = useState(false)
  // Mounted once the zone's own geometry is proven, as it hides zone volumes. With only the
  // level selected, the level shows its room pills.
  const [rooms, setRooms] = useState(false)
  Object.assign(window, {
    showFixtureRooms: () => {
      useViewer.getState().setSelection({ zoneId: null })
      setRooms(true)
    },
  })
  return (
    <>
      <Viewer
        daylight={false}
        defaultRender={{ textures: false }}
        disablePostFx
        onSceneReadyChange={setReady}
        selectionManager="custom"
      >
        <OrbitControls makeDefault target={[0, 1, 0]} />
        <GeometryProbe />
        {rooms && <ParametricViewerRooms />}
      </Viewer>
      {/* The packed UI entry mounts without the editor; its icons load from iconsBaseUrl. */}
      <ViewerControlsBar onWalkthroughToggle={() => {}} />
      {!ready && <SceneLoader />}
      <output data-scene-ready={ready}>{ready ? 'Scene ready' : 'Building scene…'}</output>
    </>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount()
    releaseReadOnly()
  })
}
