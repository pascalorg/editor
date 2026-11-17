'use client'

import { runAsSingleSceneHistoryStep, sceneRegistry, useScene } from '@pascal-app/core'
import { AGENT_OPERATIONS, applyAgentOutcome } from '@pascal-app/core/agent-operations'
import { AGENT_TOOL_CONTRACTS } from '@pascal-app/core/agent-tools'
import { createAgentHost, liveSceneRuntime } from '@pascal-app/core/runtime'
import {
  applySceneGraphToEditor,
  Editor,
  getSavedSceneDocument,
  type SceneGraph,
  selectPlacedNode,
  selectZoneOrRoom,
  useEditor,
} from '@pascal-app/editor'
import {
  getPendingRoofMergeCount,
  pendingSceneBuildCount,
  useGeometryStatus,
  useViewer,
} from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { Mesh, Object3D } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { z } from 'zod'
import { type RoofFixtureCase, roofFixture, roofFixtureCases } from './roof-scene'
import { deliveryScene } from './scene'

type Point = [number, number, number]
type Pose = { position: Point; target: Point }
type Controls = { setLookAt: (...args: [...Point, ...Point, boolean]) => Promise<void> }
type Probe = {
  frame: number
  drawnAt: number
  pending: number
  drawCalls: number
  geometry: Record<string, number>
  camera: number[]
  itemFailures: Record<string, string>
  sceneData: string | null
  view: {
    textures: boolean
    shading: string
    wallMode: string
    selectedIds: string[]
    zoneId: string | null
    roomId: string | null
  }
  roof: {
    pendingMerges: number
    failures: Record<string, string>
    roots: Record<
      string,
      {
        visibleVertices: number
        meshes: { name: string; vertices: number; placeholder: boolean; uuid: string }[]
      }
    >
  }
}
type Bridge = {
  probe: Probe | null
  loading: boolean
  tools: string[]
  call: (name: string, input: unknown) => Record<string, unknown>
  snapshot: () => ReturnType<typeof getSavedSceneDocument>
  history: () => { undo: number; redo: number }
  reset: (scene?: SceneGraph) => void
  selectRoom: typeof selectZoneOrRoom
  clearSelection: () => void
  camera: (pose: Pose) => Promise<void>
  roofCases: readonly RoofFixtureCase[]
  loadRoof: typeof loadRoof
}

declare global {
  interface Window {
    deliveryFixture?: Bridge
  }
}

// Stable identities: a new onLoad callback would reload the mounted editor.
const loadFixture = async () => deliveryScene()
const saveFixture = async (_scene: SceneGraph) => {}
const snapshot = () => structuredClone(getSavedSceneDocument())

function selectRoom(id: string) {
  useEditor.getState().armToolMode({ mode: 'select' })
  return selectZoneOrRoom(id)
}

function clearSelection() {
  useEditor.getState().clearRoom()
  useEditor.getState().setSelectedMaterialTarget(null)
  useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
  useViewer.getState().setHoveredId(null)
}

function reset(scene = deliveryScene()) {
  applySceneGraphToEditor(structuredClone(scene))
  useViewer.getState().setCameraMode('perspective')
  useViewer.getState().setShading('rendered')
  // Textures-off is clay mode: it also suppresses authored flat finish colors.
  useViewer.getState().setTextures(true)
  useViewer.getState().setWallMode('up')
  useViewer.getState().setUnit('metric')
  selectRoom('zone_salon')
}

function loadRoof(caseId: RoofFixtureCase) {
  const { scene, ...description } = roofFixture(caseId)
  applySceneGraphToEditor(scene)
  useEditor.getState().armToolMode({ mode: 'select' })
  useEditor.getState().clearRoom()
  useViewer.getState().resetSelection()
  useViewer.getState().setCameraMode('perspective')
  useViewer.getState().setShading('rendered')
  useViewer.getState().setTextures(true)
  useViewer.getState().setUnit('metric')
  selectPlacedNode(description.segmentId)
  return description
}

function call(name: string, input: unknown) {
  const contract = AGENT_TOOL_CONTRACTS.find((tool) => tool.name === name)
  const operation = AGENT_OPERATIONS[name as keyof typeof AGENT_OPERATIONS]
  if (!contract || !operation) throw new Error(`No public operation for ${name}`)
  const parsed = z.object(contract.input).parse(input)
  return runAsSingleSceneHistoryStep(useScene, () =>
    applyAgentOutcome(
      operation(liveSceneRuntime.reader().nodes, parsed as never, {
        activeLevelId: useViewer.getState().selection.levelId,
        materials: useScene.getState().materials,
      }),
      createAgentHost(liveSceneRuntime),
    ),
  )
}

function FixtureProbe({ bridge }: { bridge: Bridge }) {
  const gl = useThree((state) => state.gl) as unknown as WebGPURenderer
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as unknown as Controls | null
  const frame = useRef(0)

  useEffect(() => {
    bridge.camera = async ({ position, target }) => {
      if (!controls) throw new Error('Camera controls not mounted')
      await controls.setLookAt(...position, ...target, false)
    }
    return () => {
      bridge.camera = async () => {
        throw new Error('Camera controls not mounted')
      }
      bridge.probe = null
    }
  }, [bridge, controls])

  // Same post-render priority as viewer-live: grid geometry is not scene evidence.
  useFrame(() => {
    const geometry: Record<string, number> = {}
    const roots: Probe['roof']['roots'] = {}
    for (const node of Object.values(useScene.getState().nodes)) {
      const id = node.id
      let vertices = 0
      sceneRegistry.nodes.get(id)?.traverse((object) => {
        vertices += (object as Mesh).geometry?.getAttribute('position')?.count ?? 0
      })
      geometry[id] = vertices
      if (node.type === 'roof') {
        const root = sceneRegistry.nodes.get(id)
        const meshes: Probe['roof']['roots'][string]['meshes'] = []
        let visible = true
        for (
          let ancestor: Object3D | null | undefined = root;
          ancestor;
          ancestor = ancestor.parent
        ) {
          if (!ancestor.visible) visible = false
        }
        if (visible)
          root?.traverseVisible((object) => {
            const mesh = object as Mesh
            const count = mesh.geometry?.getAttribute('position')?.count ?? 0
            if (mesh.isMesh && count && mesh.layers.test(camera.layers))
              meshes.push({
                name: mesh.name,
                vertices: count,
                placeholder: Boolean(mesh.geometry.userData.placeholder),
                uuid: mesh.geometry.uuid,
              })
          })
        roots[id] = {
          visibleVertices: meshes.reduce(
            (sum, mesh) => sum + (mesh.placeholder ? 0 : mesh.vertices),
            0,
          ),
          meshes,
        }
      }
    }
    bridge.probe = {
      frame: ++frame.current,
      drawnAt: performance.now(),
      pending: pendingSceneBuildCount(),
      drawCalls: gl.info.render.drawCalls,
      geometry,
      camera: camera.position.toArray(),
      itemFailures: { ...useViewer.getState().itemLoadFailures },
      sceneData: document.documentElement.getAttribute('data-scene-data'),
      view: {
        textures: useViewer.getState().textures,
        shading: useViewer.getState().shading,
        wallMode: useViewer.getState().wallMode,
        selectedIds: [...useViewer.getState().selection.selectedIds],
        zoneId: useViewer.getState().selection.zoneId,
        roomId: useEditor.getState().room?.zoneId ?? null,
      },
      roof: {
        pendingMerges: getPendingRoofMergeCount(),
        failures: Object.fromEntries(useGeometryStatus.getState().failures),
        roots,
      },
    }
  }, 2)
  return null
}

export default function DeliveryFixture() {
  const [mounted, setMounted] = useState(false)
  const [bridge] = useState<Bridge>(() => ({
    probe: null,
    loading: true,
    tools: AGENT_TOOL_CONTRACTS.map((tool) => tool.name),
    call,
    snapshot,
    history: () => ({
      undo: useScene.temporal.getState().pastStates.length,
      redo: useScene.temporal.getState().futureStates.length,
    }),
    reset,
    selectRoom,
    clearSelection,
    roofCases: roofFixtureCases,
    loadRoof,
    camera: async () => {
      throw new Error('Camera controls not mounted')
    },
  }))
  useEffect(() => {
    window.deliveryFixture = bridge
    setMounted(true)
    return () => {
      delete window.deliveryFixture
    }
  }, [bridge])

  if (!mounted) return null
  return (
    <main data-delivery-fixture style={{ height: '100dvh', width: '100vw' }}>
      <Editor
        layoutVersion="v2"
        locale="en"
        projectId="delivery-fixture"
        onLoad={loadFixture}
        onSave={saveFixture}
        onLoaderChange={(visible) => {
          bridge.loading = visible
        }}
        disablePostFx
        viewerSceneSlot={<FixtureProbe bridge={bridge} />}
      />
    </main>
  )
}
