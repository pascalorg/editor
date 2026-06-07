'use client'

import { sceneRegistry, useWallSnapIndicator, type WallSnapKind } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { memo, useRef } from 'react'
import { BoxGeometry, CircleGeometry, CylinderGeometry, type Group } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'

/**
 * "Magnetic" wall-snap beacon for the 3D editor — a vertical marker that
 * stands at the draft / move endpoint while it's locked onto existing wall
 * geometry. It's the spatial cue from the design reference: a standing pillar
 * so you can see *where* the snap caught even at an angle, plus a floor marker
 * whose shape tells you *what* it caught (CAD-style osnap glyphs):
 *
 *   endpoint (corner) → square    midpoint → triangle
 *   intersection      → ✕ cross   wall body (edge) → circle
 *
 * Subscribes to the shared `useWallSnapIndicator` store (published by the wall
 * draft + endpoint-move tools). Shares the indigo accent of
 * `Alignment3DGuideLayer` for visual consistency.
 *
 * The point carries only XZ (building-local plan coords); like the alignment
 * guides it's lifted to the active level's building-local Y each frame so it
 * stands on the floor being edited when floors are stacked. Mounted inside
 * ToolManager's building-local group.
 */

const BEACON_COLOR = 0x81_8c_f8 // indigo-400 — matches the alignment guide accent
const BEACON_HEIGHT = 2.5 // world-meter height of the pillar
const BEACON_RADIUS = 0.018 // world-meter radius of the pillar
const MARKER = 0.13 // world-meter base size of the floor glyph
const FLOOR_LIFT = 0.012 // tiny lift so the marker reads above the floor grid

// Shared resources — one material + unit geometries, so snap churn during a
// drag doesn't rebuild GPU buffers (mirrors the alignment guide layer).
const beaconMaterial = new MeshBasicNodeMaterial({
  color: BEACON_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
  opacity: 0.9,
})
const PILLAR_GEOMETRY = new CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS, BEACON_HEIGHT, 8)
// Flat unit geometries scaled per marker. Boxes are 0.002 tall so they read as
// a flat plate; circles/triangles lie flat via an X rotation at the mesh.
const FLAT_BOX_GEOMETRY = new BoxGeometry(1, 0.002, 1)
const TRIANGLE_GEOMETRY = new CircleGeometry(1, 3)
const CIRCLE_GEOMETRY = new CircleGeometry(1, 28)

export const WallSnapBeaconLayer = memo(function WallSnapBeaconLayer() {
  const point = useWallSnapIndicator((s) => s.point)
  const levelId = useViewer((s) => s.selection.levelId)
  const groupRef = useRef<Group>(null)

  // Track the active level's building-local Y each frame so the beacon stands
  // on the floor being edited, not the building base — same source the
  // alignment guide layer and `grid.tsx` read.
  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const levelMesh = levelId ? sceneRegistry.nodes.get(levelId) : null
    group.position.y = levelMesh ? levelMesh.position.y : 0
  })

  if (!point) return null
  return (
    <group ref={groupRef}>
      <mesh
        geometry={PILLAR_GEOMETRY}
        layers={EDITOR_LAYER}
        material={beaconMaterial}
        position={[point.x, BEACON_HEIGHT / 2, point.z]}
        renderOrder={1002}
      />
      <SnapMarker kind={point.kind} x={point.x} z={point.z} />
    </group>
  )
})

/** Floor glyph whose shape encodes which kind of geometry the point snapped to. */
function SnapMarker({ kind, x, z }: { kind: WallSnapKind; x: number; z: number }) {
  const y = FLOOR_LIFT
  if (kind === 'endpoint') {
    return (
      <mesh
        geometry={FLAT_BOX_GEOMETRY}
        layers={EDITOR_LAYER}
        material={beaconMaterial}
        position={[x, y, z]}
        renderOrder={1001}
        scale={[MARKER * 2, 1, MARKER * 2]}
      />
    )
  }
  if (kind === 'midpoint') {
    return (
      <mesh
        geometry={TRIANGLE_GEOMETRY}
        layers={EDITOR_LAYER}
        material={beaconMaterial}
        position={[x, y, z]}
        renderOrder={1001}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[MARKER * 1.4, MARKER * 1.4, MARKER * 1.4]}
      />
    )
  }
  if (kind === 'intersection') {
    // Two crossed bars → an ✕, the universal "crossing" glyph.
    return (
      <>
        <mesh
          geometry={FLAT_BOX_GEOMETRY}
          layers={EDITOR_LAYER}
          material={beaconMaterial}
          position={[x, y, z]}
          renderOrder={1001}
          rotation={[0, Math.PI / 4, 0]}
          scale={[MARKER * 2.6, 1, MARKER * 0.5]}
        />
        <mesh
          geometry={FLAT_BOX_GEOMETRY}
          layers={EDITOR_LAYER}
          material={beaconMaterial}
          position={[x, y, z]}
          renderOrder={1001}
          rotation={[0, -Math.PI / 4, 0]}
          scale={[MARKER * 2.6, 1, MARKER * 0.5]}
        />
      </>
    )
  }
  // 'wall' (edge / along-wall) → circle
  return (
    <mesh
      geometry={CIRCLE_GEOMETRY}
      layers={EDITOR_LAYER}
      material={beaconMaterial}
      position={[x, y, z]}
      renderOrder={1001}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[MARKER, MARKER, MARKER]}
    />
  )
}
