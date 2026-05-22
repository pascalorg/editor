'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Color, EdgesGeometry, LineSegments, type Mesh, type Object3D } from 'three'
import { fract, positionLocal, sin, vec3 } from 'three/tsl'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { type EdgeMode, edgeColorFor, edgeStyleFor } from '../../lib/edge-style'
import { ZONE_LAYER } from '../../lib/layers'
import { getSceneTheme } from '../../lib/scene-themes'
import useViewer from '../../store/use-viewer'

const EDGE_OVERLAY_NAME = '__edge-overlay'
const SKETCH_AMPLITUDE = 0.025

// Static per-vertex hash jitter for the 'sketchy' look. No time term: the
// viewer renders on-demand (`frameloop="never"`), so a time-animated wobble
// wouldn't tick — a static offset still reads as hand-drawn.
function buildSketchyPositionNode() {
  const seed = positionLocal
  const h1 = fract(sin(seed.dot(vec3(127.1, 311.7, 74.7))).mul(43758.5453)).sub(0.5)
  const h2 = fract(sin(seed.dot(vec3(269.5, 183.3, 246.1))).mul(43758.5453)).sub(0.5)
  const h3 = fract(sin(seed.dot(vec3(113.5, 271.9, 124.6))).mul(43758.5453)).sub(0.5)
  return positionLocal.add(vec3(h1, h2, h3).mul(SKETCH_AMPLITUDE))
}

type EdgeData = { srcUuid: string; mode: EdgeMode; line: LineSegments }

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
  ;(data.line.material as { dispose?: () => void }).dispose?.()
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
 * Draws crisp `EdgesGeometry` outlines over every node-backed building mesh
 * when an edge mode is active. Overlays are children of their source mesh (so
 * they inherit its transform) and are rebuilt only when the source geometry
 * uuid or the edge mode changes; colour/opacity track the active scene theme.
 */
export function EdgeOverlaySystem() {
  const edges = useViewer((state) => state.edges)
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const invalidate = useThree((state) => state.invalidate)

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
          const material = new LineBasicNodeMaterial({
            depthWrite: false,
            opacity: style.opacity,
            transparent: true,
          })
          material.color.copy(color)
          if (style.sketchy) material.positionNode = buildSketchyPositionNode()
          const line = new LineSegments(new EdgesGeometry(mesh.geometry, style.threshold), material)
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

        const material = data.line.material as unknown as LineBasicNodeMaterial
        material.color.copy(color)
        material.opacity = style.opacity
      })
    }
  })

  return null
}
