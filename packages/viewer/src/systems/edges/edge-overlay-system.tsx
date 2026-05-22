'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Color, EdgesGeometry, type Mesh, type Object3D } from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { type EdgeMode, edgeColorFor, edgeStyleFor } from '../../lib/edge-style'
import { ZONE_LAYER } from '../../lib/layers'
import { getSceneTheme } from '../../lib/scene-themes'
import useViewer from '../../store/use-viewer'

const EDGE_OVERLAY_NAME = '__edge-overlay'

// LineSegments2 builds its own Line2NodeMaterial; that material type isn't in
// three's webgpu .d.ts in this version, so we set its props through a minimal
// structural type.
type EdgeLineMaterial = {
  color: Color
  opacity: number
  linewidth: number
  transparent: boolean
  depthWrite: boolean
  // WebGL LineMaterial exposes a settable `resolution` Vector2; the WebGPU
  // Line2NodeMaterial reads the viewport internally, so it's absent there.
  resolution?: { set: (x: number, y: number) => void }
  dispose?: () => void
}

type EdgeData = { srcUuid: string; mode: EdgeMode; line: LineSegments2 }

function getEdgeData(mesh: Mesh) {
  return (mesh.userData as { __edge?: EdgeData }).__edge
}

// Only node-backed opaque building meshes get edges — never the edge overlay
// itself, zone-layer fills/borders, or invisible selection-hitbox meshes.
function isBuildingMesh(obj: Object3D): obj is Mesh {
  const mesh = obj as Mesh
  if (!(mesh.isMesh && mesh.geometry)) return false
  if (obj.name === EDGE_OVERLAY_NAME) return false
  if (obj.layers.isEnabled(ZONE_LAYER)) return false
  const material = mesh.material
  if (!Array.isArray(material) && material && material.visible === false) return false
  return true
}

function disposeOverlay(mesh: Mesh) {
  const data = getEdgeData(mesh)
  if (!data) return
  mesh.remove(data.line)
  data.line.geometry.dispose()
  ;(data.line.material as unknown as EdgeLineMaterial).dispose?.()
  delete (mesh.userData as { __edge?: EdgeData }).__edge
}

function disposeAllOverlays() {
  for (const obj of sceneRegistry.nodes.values()) {
    obj.traverse((child) => {
      if ((child as Mesh).isMesh) disposeOverlay(child as Mesh)
    })
  }
}

/**
 * Draws crisp `EdgesGeometry` outlines (as screen-space-thick `LineSegments2`)
 * over every node-backed building mesh when an edge mode is active. Overlays
 * are children of their source mesh (so they inherit its transform) and are
 * rebuilt only when the source geometry uuid or the edge mode changes;
 * colour/opacity/width track the active scene theme and viewport size.
 */
export function EdgeOverlaySystem() {
  const edges = useViewer((state) => state.edges)
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const invalidate = useThree((state) => state.invalidate)
  const size = useThree((state) => state.size)

  // Toggling edges / switching theme must run a frame even when nothing else
  // invalidates the on-demand loop.
  useEffect(() => {
    invalidate()
  }, [invalidate])

  useEffect(() => {
    if (edges === 'off') disposeAllOverlays()
  }, [edges])

  useEffect(() => disposeAllOverlays, [])

  useFrame(() => {
    if (edges === 'off') return
    const style = edgeStyleFor(edges)
    const color = new Color(edgeColorFor(getSceneTheme(sceneTheme).background))

    for (const obj of sceneRegistry.nodes.values()) {
      obj.traverse((child) => {
        if (!isBuildingMesh(child)) return
        const mesh = child
        const data = getEdgeData(mesh)

        if (!data || data.srcUuid !== mesh.geometry.uuid || data.mode !== edges) {
          disposeOverlay(mesh)
          const edgeGeom = new EdgesGeometry(mesh.geometry, style.threshold)
          const lineGeom = new LineSegmentsGeometry()
          lineGeom.setPositions(edgeGeom.getAttribute('position').array as Float32Array)
          edgeGeom.dispose()

          const line = new LineSegments2(lineGeom)
          const material = line.material as unknown as EdgeLineMaterial
          material.color.copy(color)
          material.linewidth = style.linewidth
          material.opacity = style.opacity
          material.transparent = true
          material.depthWrite = false
          material.resolution?.set(size.width, size.height)

          line.name = EDGE_OVERLAY_NAME
          line.frustumCulled = false
          line.raycast = () => {}
          mesh.add(line)
          ;(mesh.userData as { __edge?: EdgeData }).__edge = {
            mode: edges,
            srcUuid: mesh.geometry.uuid,
            line,
          }
          return
        }

        const material = data.line.material as unknown as EdgeLineMaterial
        material.color.copy(color)
        material.opacity = style.opacity
        material.linewidth = style.linewidth
        material.resolution?.set(size.width, size.height)
      })
    }
  })

  return null
}
