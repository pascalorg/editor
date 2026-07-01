'use client'

import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_WALL_HEIGHT,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallThickness,
  isCurvedWall,
  resolveLevelId,
  sceneRegistry,
  spatialGridManager,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useWallSnapIndicator, type WallSnapKind } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'
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
 * draft + endpoint-move tools). The vertical mouse pillar and the corner
 * (endpoint) square are green; the other floor glyphs are indigo.
 *
 * The point carries only XZ (building-local plan coords); like the alignment
 * guides it's lifted to the active level's building-local Y each frame so it
 * stands on the floor being edited when floors are stacked. Mounted inside
 * ToolManager's building-local group.
 */

const BEACON_COLOR = 0x81_8c_f8 // indigo-400 — matches the alignment guide accent
const MARKER_GREEN = 0x22_c5_5e // green-500 — vertical mouse marker + corner (endpoint) glyph
const BEACON_HEIGHT = 2.5 // world-meter height of the pillar
const BEACON_RADIUS = 0.018 // world-meter radius of the pillar
const MARKER = 0.13 // world-meter base size of the floor glyph
const FLOOR_LIFT = 0.012 // tiny lift so the marker reads above the floor grid
const WALL_TOP_HIGHLIGHT_LIFT = 0.035
const WALL_TOP_HIGHLIGHT_HEIGHT = 0.018
const WALL_TOP_HIGHLIGHT_OVERHANG = 0.14
const WALL_TOP_GLOW_HEIGHT = 0.026
const WALL_TOP_GLOW_OVERHANG = 0.36
const WALL_TOP_END_OVERHANG = 0.08
const CURVED_WALL_HIGHLIGHT_SEGMENT_LENGTH = 0.45
const NO_RAYCAST = () => null

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
const greenMarkerMaterial = new MeshBasicNodeMaterial({
  color: MARKER_GREEN,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
  opacity: 0.9,
})
const wallTopHighlightMaterial = new MeshBasicNodeMaterial({
  color: BEACON_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
  opacity: 0.88,
})
const wallTopHighlightGlowMaterial = new MeshBasicNodeMaterial({
  color: BEACON_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
  opacity: 0.26,
})
const PILLAR_GEOMETRY = new CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS, BEACON_HEIGHT, 8)
// Flat unit geometries scaled per marker. Boxes are 0.002 tall so they read as
// a flat plate; circles/triangles lie flat via an X rotation at the mesh.
const FLAT_BOX_GEOMETRY = new BoxGeometry(1, 0.002, 1)
const WALL_TOP_HIGHLIGHT_GEOMETRY = new BoxGeometry(1, 1, 1)
const TRIANGLE_GEOMETRY = new CircleGeometry(1, 3)
const CIRCLE_GEOMETRY = new CircleGeometry(1, 28)

export const WallSnapBeaconLayer = memo(function WallSnapBeaconLayer() {
  const point = useWallSnapIndicator((s) => s.point)
  const levelId = useViewer((s) => s.selection.levelId)
  const nodes = useScene((s) => s.nodes)
  const groupRef = useRef<Group>(null)
  const highlightedWalls = useMemo(() => {
    if (!point?.wallIds?.length) return []
    return point.wallIds
      .map((wallId) => nodes[wallId as AnyNodeId])
      .filter((node): node is WallNode => node?.type === 'wall' && node.visible !== false)
  }, [nodes, point?.wallIds])

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
      {highlightedWalls.map((wall) => (
        <WallTopHighlight key={wall.id} nodes={nodes} wall={wall} />
      ))}
      <mesh
        geometry={PILLAR_GEOMETRY}
        layers={EDITOR_LAYER}
        material={greenMarkerMaterial}
        position={[point.x, BEACON_HEIGHT / 2, point.z]}
        renderOrder={1002}
      />
      <SnapMarker kind={point.kind} x={point.x} z={point.z} />
    </group>
  )
})

type WallTopHighlightSegment = {
  angle: number
  center: [number, number]
  length: number
}

function getWallTopY(wall: WallNode, nodes: Readonly<Record<string, AnyNode>>) {
  const levelId = resolveLevelId(wall, nodes as Record<string, AnyNode>)
  const slabElevation = spatialGridManager.getSlabElevationForWall(
    levelId,
    wall.start,
    wall.end,
    wall.curveOffset ?? 0,
    wall.thickness,
  )
  const wallHeight = wall.height ?? DEFAULT_WALL_HEIGHT
  return (slabElevation > 0 ? slabElevation + wallHeight : wallHeight) + WALL_TOP_HIGHLIGHT_LIFT
}

function buildHighlightSegment(start: [number, number], end: [number, number]) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return null

  return {
    angle: -Math.atan2(dz, dx),
    center: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2] as [number, number],
    length,
  }
}

function buildWallTopHighlightSegments(wall: WallNode): WallTopHighlightSegment[] {
  if (!isCurvedWall(wall)) {
    const segment = buildHighlightSegment(wall.start, wall.end)
    return segment ? [segment] : []
  }

  const sampleCount = Math.max(
    8,
    Math.ceil(getWallCurveLength(wall) / CURVED_WALL_HIGHLIGHT_SEGMENT_LENGTH),
  )
  const segments: WallTopHighlightSegment[] = []
  let previous = getWallCurveFrameAt(wall, 0).point
  for (let index = 1; index <= sampleCount; index += 1) {
    const current = getWallCurveFrameAt(wall, index / sampleCount).point
    const segment = buildHighlightSegment([previous.x, previous.y], [current.x, current.y])
    if (segment) segments.push(segment)
    previous = current
  }
  return segments
}

function WallTopHighlight({
  nodes,
  wall,
}: {
  nodes: Readonly<Record<string, AnyNode>>
  wall: WallNode
}) {
  const segments = useMemo(() => buildWallTopHighlightSegments(wall), [wall])
  const y = getWallTopY(wall, nodes)
  const width = Math.max(getWallThickness(wall) + WALL_TOP_HIGHLIGHT_OVERHANG, 0.24)
  const glowWidth = Math.max(getWallThickness(wall) + WALL_TOP_GLOW_OVERHANG, 0.42)

  return (
    <>
      {segments.map((segment, index) => (
        <group key={`${wall.id}:${index}`}>
          <mesh
            frustumCulled={false}
            geometry={WALL_TOP_HIGHLIGHT_GEOMETRY}
            layers={EDITOR_LAYER}
            material={wallTopHighlightGlowMaterial}
            position={[segment.center[0], y - 0.003, segment.center[1]]}
            raycast={NO_RAYCAST}
            renderOrder={1003}
            rotation={[0, segment.angle, 0]}
            scale={[segment.length + WALL_TOP_END_OVERHANG, WALL_TOP_GLOW_HEIGHT, glowWidth]}
          />
          <mesh
            frustumCulled={false}
            geometry={WALL_TOP_HIGHLIGHT_GEOMETRY}
            layers={EDITOR_LAYER}
            material={wallTopHighlightMaterial}
            position={[segment.center[0], y + 0.002, segment.center[1]]}
            raycast={NO_RAYCAST}
            renderOrder={1004}
            rotation={[0, segment.angle, 0]}
            scale={[segment.length + WALL_TOP_END_OVERHANG, WALL_TOP_HIGHLIGHT_HEIGHT, width]}
          />
        </group>
      ))}
    </>
  )
}

/** Floor glyph whose shape encodes which kind of geometry the point snapped to. */
function SnapMarker({ kind, x, z }: { kind: WallSnapKind; x: number; z: number }) {
  const y = FLOOR_LIFT
  if (kind === 'endpoint') {
    return (
      <mesh
        geometry={FLAT_BOX_GEOMETRY}
        layers={EDITOR_LAYER}
        material={greenMarkerMaterial}
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
