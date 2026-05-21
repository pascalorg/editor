'use client'

// Renders an IFC-derived scene graph through the real `@pascal-app/viewer`
// (the same one the editor uses). The full `@pascal-app/editor` shell was
// tried but its CSS expects a full-page layout that doesn't sit cleanly
// inside the converter page; we use the bare Viewer + a custom toolbar
// overlay instead.

import { type AnyNode, type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import type { PascalSceneGraph } from '@pascal-app/ifc-converter'
import { useViewer, Viewer } from '@pascal-app/viewer'
import { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Box3, type Object3D, Vector3 } from 'three'

// Structural subset of drei's CameraControls. We can't import the real
// type because `camera-controls` is a transitive dep of `@react-three/drei`,
// not a direct one.
type CameraControlsImpl = {
  fitToBox: (
    target: Object3D,
    enableTransition: boolean,
    options?: {
      paddingTop?: number
      paddingBottom?: number
      paddingLeft?: number
      paddingRight?: number
    },
  ) => Promise<unknown>
  getTarget: (out: Vector3) => Vector3
  moveTo: (x: number, y: number, z: number, enableTransition?: boolean) => Promise<unknown>
}

import { FitSceneButton, LevelSelector, PreviewToolbar } from './PreviewToolbar'

interface PascalSceneViewerProps {
  sceneGraph: PascalSceneGraph
  className?: string
  /** Fired when the user clicks a node in the 3D view. */
  onSelectNode?: (nodeId: string | null) => void
}

// Inside the Canvas — watches the scene store and frames the camera onto
// the rendered scene whenever a new model lands. Lives as a sibling of
// `<CameraControls makeDefault />`, so `useThree(s => s.controls)` picks
// up the active CameraControls instance.
function AutoFit({ trigger }: { trigger: number }) {
  const sceneRoot = useThree((s) => s.scene)
  const controls = useThree((s) => s.controls) as CameraControlsImpl | null
  const lastFitRef = useRef(-1)

  useEffect(() => {
    if (!controls || trigger === lastFitRef.current) return
    // Defer two RAFs: the first commits the React tree, the second
    // gives the per-frame geometry systems (wall mitering, slab build,
    // floor-elevation lift) a tick to settle so the bounding box
    // measures the final meshes, not their pre-build placeholders.
    let cancelled = false
    let id1 = 0
    const id0 = requestAnimationFrame(() => {
      if (cancelled) return
      id1 = requestAnimationFrame(() => {
        if (cancelled) return
        const box = new Box3().setFromObject(sceneRoot)
        if (!box.isEmpty()) {
          controls.fitToBox(sceneRoot, true, {
            paddingTop: 1,
            paddingBottom: 1,
            paddingLeft: 1,
            paddingRight: 1,
          })
          lastFitRef.current = trigger
        }
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id0)
      cancelAnimationFrame(id1)
    }
  }, [trigger, sceneRoot, controls])

  return null
}

// Inside the Canvas — when the selected level changes, glide the camera
// target up/down to that level's elevation (the level group's world Y in
// the scene registry), keeping the current orbit X/Z. Mirrors the
// editor's CustomCameraControls level behaviour. Skips the initial
// pre-selected level so it doesn't fight `<AutoFit>`'s first framing.
function LevelFocus() {
  const levelId = useViewer((s) => s.selection.levelId)
  const controls = useThree((s) => s.controls) as CameraControlsImpl | null
  const target = useRef(new Vector3())
  const seededRef = useRef(false)

  useEffect(() => {
    if (!controls) return
    if (!seededRef.current) {
      // First level we see is the auto-pre-selection — don't move.
      seededRef.current = true
      return
    }
    if (!levelId) return
    const levelMesh = sceneRegistry.nodes.get(levelId)
    if (!levelMesh) return
    controls.getTarget(target.current)
    controls.moveTo(target.current.x, levelMesh.position.y, target.current.z, true)
  }, [levelId, controls])

  return null
}

export default function PascalSceneViewer({
  sceneGraph,
  className,
  onSelectNode,
}: PascalSceneViewerProps) {
  const setScene = useScene((s) => s.setScene)
  const setSelection = useViewer((s) => s.setSelection)
  const [fitTrigger, setFitTrigger] = useState(0)

  // Push the scene into the shared store + skip the SelectionManager's
  // building/level drill-down by pre-selecting both so clicks on
  // walls/items resolve to wall/item selection immediately. Bumping
  // fitTrigger forces the `<AutoFit>` inside the Canvas to re-frame.
  useEffect(() => {
    setScene(sceneGraph.nodes as Record<AnyNodeId, AnyNode>, sceneGraph.rootNodeIds as AnyNodeId[])
    const allNodes = Object.values(sceneGraph.nodes) as AnyNode[]
    const firstBuilding = allNodes.find((n) => n.type === 'building')
    const firstLevel = allNodes.find((n) => n.type === 'level')
    setSelection({
      buildingId: (firstBuilding?.id ?? null) as never,
      levelId: (firstLevel?.id ?? null) as never,
      zoneId: null,
      selectedIds: [],
    })
    setFitTrigger((n) => n + 1)
  }, [sceneGraph, setScene, setSelection])

  // Bridge `useViewer.selection.selectedIds[0]` (the SelectionManager's
  // multi-select bucket for walls/items/doors/etc) back to the parent so
  // the converter's inspector panel updates on every 3D click.
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const zoneId = useViewer((s) => s.selection.zoneId)
  useEffect(() => {
    onSelectNode?.((selectedIds[0] as string | undefined) ?? zoneId ?? null)
  }, [selectedIds, zoneId, onSelectNode])

  const onFit = useCallback(() => {
    setFitTrigger((n) => n + 1)
  }, [])

  return (
    <div
      className={
        className ?? 'relative w-full h-[600px] overflow-hidden rounded-lg border border-gray-200'
      }
    >
      <div className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2">
        <div className="pointer-events-auto">
          <PreviewToolbar />
        </div>
      </div>
      <div className="pointer-events-none absolute top-2 right-2 z-10">
        <div className="pointer-events-auto">
          <FitSceneButton onFit={onFit} />
        </div>
      </div>
      <div className="pointer-events-none absolute top-1/2 left-2 z-10 -translate-y-1/2">
        <div className="pointer-events-auto">
          <LevelSelector />
        </div>
      </div>
      <Viewer>
        <CameraControls makeDefault />
        <AutoFit trigger={fitTrigger} />
        <LevelFocus />
      </Viewer>
    </div>
  )
}
