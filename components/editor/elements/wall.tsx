'use client'

import { forwardRef, memo, type Ref, useMemo } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import type { WallSegment } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'
import {
  handleElementClick,
  isElementSelected,
  type SelectedElement,
} from '@/lib/building-elements'

const WALL_THICKNESS = 0.2 // 20cm wall thickness
const OUTLINE_RADIUS = 0.02 // 2cm radius for selection outline cylinders

// Helper function to create a cylinder between two points
function createEdgeCylinder(start: number[], end: number[]) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const dz = end[2] - start[2]
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)

  const geometry = new THREE.CylinderGeometry(OUTLINE_RADIUS, OUTLINE_RADIUS, length, 8)
  const midpoint = new THREE.Vector3(
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
    (start[2] + end[2]) / 2,
  )

  // Calculate rotation to align cylinder with edge
  const direction = new THREE.Vector3(dx, dy, dz).normalize()
  const axis = new THREE.Vector3(0, 1, 0).cross(direction).normalize()
  const angle = Math.acos(new THREE.Vector3(0, 1, 0).dot(direction))

  return { geometry, midpoint, axis, angle }
}

// --- 2D Intersection Helper Functions (Ported from demo) ---
// Note: These helpers operate in 2D space. We will use
// the grid's (x, y) coordinates, which map to 3D (x, z).

interface Point {
  x: number
  y: number
}
interface Line {
  a: number
  b: number
  c: number
}
interface ProcessedWall {
  angle: number
  edgeA: Line // "Left" edge
  edgeB: Line // "Right" edge
  v: Point
  wall_id: string
  pA: Point // "Left" edge point
  pB: Point // "Right" edge point
}
interface Junction {
  meetingPoint: Point
  connectedWalls: { wall: LiveWall; endType: 'start' | 'end' }[]
}
interface LiveWall {
  id: string
  start: Point
  end: Point
  thickness: number
}

/** Creates a unique string key for a point */
function pointToKey(p: Point, tolerance = 1e-3): string {
  const snap = 1 / tolerance
  return `${Math.round(p.x * snap)},${Math.round(p.y * snap)}`
}

/** Gets the OUTGOING vector for a wall end at a junction */
function getOutgoingVector(wall: LiveWall, endType: 'start' | 'end', meetingPoint: Point): Point {
  if (endType === 'start') {
    return { x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y }
  }
  return { x: wall.start.x - wall.end.x, y: wall.start.y - wall.end.y }
}

/** Creates a line equation (ax + by + c = 0) from a point and a vector */
function createLineFromPointAndVector(p: Point, v: Point): Line {
  const a = -v.y
  const b = v.x
  const c = -(a * p.x + b * p.y)
  return { a, b, c }
}

/** Finds the intersection of two lines */
function intersectLines(l1: Line, l2: Line): Point | null {
  const det = l1.a * l2.b - l2.a * l1.b
  if (Math.abs(det) < 1e-9) return null // Lines are parallel
  const x = (l1.b * l2.c - l2.b * l1.c) / det
  const y = (l2.a * l1.c - l1.a * l2.c) / det
  return { x, y }
}

/** Finds all junctions (points where >= 2 walls meet) */
function findJunctions(walls: LiveWall[]): Map<string, Junction> {
  const junctions = new Map<string, Junction>()

  walls.forEach((wall) => {
    const keyStart = pointToKey(wall.start)
    const keyEnd = pointToKey(wall.end)

    if (!junctions.has(keyStart)) {
      junctions.set(keyStart, { meetingPoint: wall.start, connectedWalls: [] })
    }
    junctions.get(keyStart)!.connectedWalls.push({ wall, endType: 'start' })

    if (!junctions.has(keyEnd)) {
      junctions.set(keyEnd, { meetingPoint: wall.end, connectedWalls: [] })
    }
    junctions.get(keyEnd)!.connectedWalls.push({ wall, endType: 'end' })
  })

  // Filter out points with only one wall end
  const actualJunctions = new Map<string, Junction>()
  for (const [key, junction] of junctions.entries()) {
    if (junction.connectedWalls.length >= 2) {
      actualJunctions.set(key, junction)
    }
  }
  return actualJunctions
}

/** Calculates intersection points for a single junction */
function calculateJunctionIntersections(junction: Junction) {
  const { meetingPoint, connectedWalls } = junction
  const processedWalls: ProcessedWall[] = []

  for (const connected of connectedWalls) {
    const { wall, endType } = connected
    const halfThickness = wall.thickness / 2
    const v = getOutgoingVector(wall, endType, meetingPoint)
    const L = Math.sqrt(v.x * v.x + v.y * v.y)

    if (L < 1e-9) continue

    const n_unit = { x: -v.y / L, y: v.x / L } // "Left"
    const pA = {
      x: meetingPoint.x + n_unit.x * halfThickness,
      y: meetingPoint.y + n_unit.y * halfThickness,
    }
    const pB = {
      x: meetingPoint.x - n_unit.x * halfThickness,
      y: meetingPoint.y - n_unit.y * halfThickness,
    }

    processedWalls.push({
      angle: Math.atan2(v.y, v.x),
      edgeA: createLineFromPointAndVector(pA, v), // "Left" edge
      edgeB: createLineFromPointAndVector(pB, v), // "Right" edge
      v,
      wall_id: wall.id,
      pA, // Store "Left" edge point
      pB, // Store "Right" edge point
    })
  }

  processedWalls.sort((a, b) => a.angle - b.angle)

  const wallIntersections = new Map<string, { left: Point; right: Point }>()
  const n = processedWalls.length
  if (n < 2) return { wallIntersections }

  for (let i = 0; i < n; i++) {
    const wall1 = processedWalls[i]
    const wall2 = processedWalls[(i + 1) % n]

    const intersection = intersectLines(wall1.edgeA, wall2.edgeB)

    let p: Point
    if (intersection === null) {
      // Lines are parallel (or co-linear).
      // Use wall1's "left" edge point (pA) as the correct
      // intersection point in this specific case.
      p = wall1.pA
    } else {
      p = intersection
    }

    if (!wallIntersections.has(wall1.wall_id)) {
      wallIntersections.set(wall1.wall_id, {} as any)
    }
    wallIntersections.get(wall1.wall_id)!.left = p

    if (!wallIntersections.has(wall2.wall_id)) {
      wallIntersections.set(wall2.wall_id, {} as any)
    }
    wallIntersections.get(wall2.wall_id)!.right = p
  }

  return { wallIntersections }
}
// --- End of 2D Intersection Helper Functions ---

type WallsProps = {
  floorId: string
  isActive: boolean
  isOverviewMode?: boolean
  tileSize: number
  wallHeight: number
  hoveredWallIndex: number | null
  selectedElements: SelectedElement[]
  setSelectedElements: (elements: SelectedElement[]) => void
  onWallHover: (index: number | null) => void
  onWallRightClick?: (e: any, wallSegment: WallSegment) => void
  isCameraEnabled?: boolean
  controlMode: string
  setControlMode: (mode: 'select' | 'building' | 'delete' | 'guide') => void
  movingCamera: boolean
  onDeleteWalls: () => void
}

export const Walls = forwardRef(
  (
    {
      floorId,
      isActive,
      isOverviewMode = false,
      tileSize,
      wallHeight,
      hoveredWallIndex,
      selectedElements,
      setSelectedElements,
      onWallHover,
      onWallRightClick,
      isCameraEnabled,
      controlMode,
      setControlMode,
      movingCamera,
      onDeleteWalls,
    }: WallsProps,
    ref: Ref<THREE.Group>,
  ) => {
    // Fetch wall segments for this floor from the store, filtering out invisible ones
    const wallSegments = useEditor(
      useShallow((state) => {
        const wallComponent = state.components.find((c) => c.type === 'wall' && c.group === floorId)
        return wallComponent?.type === 'wall'
          ? wallComponent.data.segments.filter((seg) => seg.visible !== false)
          : []
      }),
    )

    // --- Pre-calculate Wall Geometry ---
    const wallGeometries = useMemo(() => {
      // 1. Convert grid segments to "LiveWall" format (world coordinates)
      // We use the grid's 'y' coordinate as our 2D 'y' (which maps to 3D 'z')
      const liveWalls: LiveWall[] = wallSegments.map((seg) => ({
        id: seg.id,
        start: { x: seg.start[0] * tileSize, y: seg.start[1] * tileSize },
        end: { x: seg.end[0] * tileSize, y: seg.end[1] * tileSize },
        thickness: WALL_THICKNESS,
      }))

      // 2. Find all junctions
      const junctions = findJunctions(liveWalls)
      const junctionData = new Map<string, Map<string, { left: Point; right: Point }>>()
      for (const [key, junction] of junctions.entries()) {
        const { wallIntersections } = calculateJunctionIntersections(junction)
        junctionData.set(key, wallIntersections)
      }

      // 3. Create extrusion geometry for each wall
      return liveWalls
        .map((wall) => {
          const halfT = wall.thickness / 2

          const v = { x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y }
          const L = Math.sqrt(v.x * v.x + v.y * v.y)
          if (L < 1e-9) return null // Skip zero-length walls

          const n_unit = { x: -v.y / L, y: v.x / L } // "Left" of (start -> end) vector

          const key_start = pointToKey(wall.start)
          const key_end = pointToKey(wall.end)

          const startJunctionData = junctionData.get(key_start)?.get(wall.id)
          const endJunctionData = junctionData.get(key_end)?.get(wall.id)

          // Get 4 corners of the wall polygon
          const p_start_L = startJunctionData
            ? startJunctionData.left
            : { x: wall.start.x + n_unit.x * halfT, y: wall.start.y + n_unit.y * halfT }
          const p_start_R = startJunctionData
            ? startJunctionData.right
            : { x: wall.start.x - n_unit.x * halfT, y: wall.start.y - n_unit.y * halfT }

          const p_end_L = endJunctionData
            ? endJunctionData.right
            : { x: wall.end.x + n_unit.x * halfT, y: wall.end.y + n_unit.y * halfT }
          const p_end_R = endJunctionData
            ? endJunctionData.left
            : { x: wall.end.x - n_unit.x * halfT, y: wall.end.y - n_unit.y * halfT }

          // Build the polygon footprint
          // These 2D (x, y) points map to 3D (x, z)
          const polyPoints = [p_start_R, p_end_R]
          if (endJunctionData) polyPoints.push(wall.end) // Add center point if at junction
          polyPoints.push(p_end_L, p_start_L)
          if (startJunctionData) polyPoints.push(wall.start) // Add center point if at junction

          // Create THREE.Shape
          // Note: Negate y values because rotation by -π/2 around X flips Z sign
          const shapePoints = polyPoints.map((p) => new THREE.Vector2(p.x, -p.y))
          const shape = new THREE.Shape(shapePoints)

          // Create Extrude Geometry
          const extrudeSettings = { depth: wallHeight, bevelEnabled: false }
          const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings)

          // The geometry is created in the XY plane and extruded along Z.
          // We need to rotate it to lie on the XZ plane and extrude along Y.
          // Rotation by -90deg around X-axis transforms (x,y,z) to (x,z,-y).
          // With our negated y-coordinates in the shape, a point at (x,-y,0) becomes (x,0,y).
          // After rotation, the wall already sits from y=0 to y=wallHeight, so no translation needed.
          geometry.rotateX(-Math.PI / 2)

          // Store the 3D corner points for outline rendering
          // Bottom corners (y=0)
          const bottomCorners = [
            [p_start_R.x, 0, p_start_R.y],
            [p_end_R.x, 0, p_end_R.y],
            [p_end_L.x, 0, p_end_L.y],
            [p_start_L.x, 0, p_start_L.y],
          ]
          // Top corners (y=wallHeight)
          const topCorners = [
            [p_start_R.x, wallHeight, p_start_R.y],
            [p_end_R.x, wallHeight, p_end_R.y],
            [p_end_L.x, wallHeight, p_end_L.y],
            [p_start_L.x, wallHeight, p_start_L.y],
          ]

          return { geometry, bottomCorners, topCorners }
        })
        .filter(Boolean) as Array<{
        geometry: THREE.ExtrudeGeometry
        bottomCorners: number[][]
        topCorners: number[][]
      }>
    }, [wallSegments, tileSize, wallHeight])
    // --- End of Pre-calculation ---

    return (
      <group ref={ref}>
        {wallGeometries.map((wallData, i) => {
          // Find the original segment data
          const seg = wallSegments[i]
          if (!seg) return null

          const isSelected = isElementSelected(selectedElements, seg.id, 'wall')
          const isHovered = isActive && hoveredWallIndex === i

          const color = '#aaaabf'
          const emissive = '#aaaabf' // Same as base color for emissive
          let emissiveIntensity = 0

          if (isSelected && isHovered) {
            emissiveIntensity = 0.6
          } else if (isSelected) {
            emissiveIntensity = 0.4
          } else if (isHovered) {
            emissiveIntensity = 0.3
          }

          // In overview mode, show all walls at full opacity
          // Otherwise, only active floor walls are at full opacity
          const opacity = isOverviewMode || isActive ? 1 : 0.2
          const transparent = opacity < 1

          return (
            <group key={seg.id}>
              {/* The geometry is now pre-rotated and in world space,
              so we don't need the <group> for rotation/positioning. */}
              <mesh
                castShadow
                geometry={wallData.geometry} // Use the new extruded geometry
                onClick={(e) => {
                  if (!isActive || movingCamera || controlMode === 'delete') {
                    return
                  }
                  e.stopPropagation()

                  // Handle element selection using the shared handler
                  const updatedSelection = handleElementClick({
                    selectedElements,
                    segments: wallSegments,
                    elementId: seg.id,
                    type: 'wall',
                    event: e,
                  })
                  setSelectedElements(updatedSelection)

                  // Automatically activate building mode when selecting a building element
                  setControlMode('building')
                }}
                onContextMenu={(e) => {
                  if (!isActive) return
                  if (!isCameraEnabled && selectedElements.length > 0) {
                    e.stopPropagation()
                    if (e.nativeEvent) e.nativeEvent.preventDefault()
                  }
                }}
                onPointerDown={(e) => {
                  if (!isActive || movingCamera || controlMode === 'delete') {
                    return
                  }
                  // Stop propagation to prevent camera controls from intercepting
                  e.stopPropagation()

                  if (e.button === 2 && !isCameraEnabled && selectedElements.length > 0) {
                    if (e.nativeEvent) e.nativeEvent.preventDefault()
                    onWallRightClick?.(e, seg)
                  }
                }}
                onPointerEnter={(e) => {
                  if (isActive && controlMode !== 'delete' && !movingCamera) {
                    e.stopPropagation()
                    onWallHover(i)
                  }
                }}
                onPointerLeave={(e) => {
                  if (isActive && controlMode !== 'delete' && !movingCamera) {
                    e.stopPropagation()
                    onWallHover(null)
                  }
                }}
                receiveShadow
              >
                <meshStandardMaterial
                  color={color}
                  emissive={emissive}
                  emissiveIntensity={emissiveIntensity}
                  metalness={0.1}
                  opacity={opacity}
                  roughness={0.7}
                  transparent={transparent}
                />
              </mesh>

              {/* Selection outline - 3D cylinders */}
              {isSelected && (
                <>
                  {(() => {
                    const { bottomCorners, topCorners } = wallData

                    const edges = []
                    // Bottom rectangle edges
                    for (let j = 0; j < bottomCorners.length; j++) {
                      edges.push([bottomCorners[j], bottomCorners[(j + 1) % bottomCorners.length]])
                    }
                    // Top rectangle edges
                    for (let j = 0; j < topCorners.length; j++) {
                      edges.push([topCorners[j], topCorners[(j + 1) % topCorners.length]])
                    }
                    // Vertical edges connecting bottom to top
                    for (let j = 0; j < bottomCorners.length; j++) {
                      edges.push([bottomCorners[j], topCorners[j]])
                    }

                    return edges.map((edge, idx) => {
                      const {
                        geometry: cylGeom,
                        midpoint,
                        axis,
                        angle,
                      } = createEdgeCylinder(edge[0], edge[1])
                      return (
                        <mesh
                          geometry={cylGeom}
                          key={idx}
                          position={midpoint}
                          quaternion={new THREE.Quaternion().setFromAxisAngle(axis, angle)}
                          renderOrder={999}
                        >
                          <meshStandardMaterial
                            color="#ffffff"
                            depthTest={false}
                            emissive="#ffffff"
                            emissiveIntensity={0.5}
                          />
                        </mesh>
                      )
                    })
                  })()}
                </>
              )}
            </group>
          )
        })}
      </group>
    )
  },
)

Walls.displayName = 'Walls'

// --- WallShadowPreview ---
// This also needs to be updated to use the same geometry logic.
// We pass it the `allWallSegments` so it can calculate its own geometry.

type WallShadowPreviewProps = {
  start: [number, number]
  end: [number, number]
  tileSize: number
  wallHeight: number
  // We need all other walls to check for junctions
  allWallSegments: WallSegment[]
}

export const WallShadowPreview = memo(
  ({ start, end, tileSize, wallHeight, allWallSegments }: WallShadowPreviewProps) => {
    const geometry = useMemo(() => {
      const previewWall: LiveWall = {
        id: 'preview',
        start: { x: start[0] * tileSize, y: start[1] * tileSize },
        end: { x: end[0] * tileSize, y: end[1] * tileSize },
        thickness: WALL_THICKNESS,
      }

      const liveWalls: LiveWall[] = allWallSegments.map((seg) => ({
        id: seg.id,
        start: { x: seg.start[0] * tileSize, y: seg.start[1] * tileSize },
        end: { x: seg.end[0] * tileSize, y: seg.end[1] * tileSize },
        thickness: WALL_THICKNESS,
      }))

      // Add the preview wall to the list to find junctions
      const allWalls = [...liveWalls, previewWall]

      const junctions = findJunctions(allWalls)
      const junctionData = new Map<string, Map<string, { left: Point; right: Point }>>()
      for (const [key, junction] of junctions.entries()) {
        const { wallIntersections } = calculateJunctionIntersections(junction)
        junctionData.set(key, wallIntersections)
      }

      // Now, calculate the geometry just for the previewWall
      const wall = previewWall
      const halfT = wall.thickness / 2

      const v = { x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y }
      const L = Math.sqrt(v.x * v.x + v.y * v.y)
      if (L < 1e-9) return null

      const n_unit = { x: -v.y / L, y: v.x / L }

      const key_start = pointToKey(wall.start)
      const key_end = pointToKey(wall.end)

      const startJunctionData = junctionData.get(key_start)?.get(wall.id)
      const endJunctionData = junctionData.get(key_end)?.get(wall.id)

      const p_start_L = startJunctionData
        ? startJunctionData.left
        : { x: wall.start.x + n_unit.x * halfT, y: wall.start.y + n_unit.y * halfT }
      const p_start_R = startJunctionData
        ? startJunctionData.right
        : { x: wall.start.x - n_unit.x * halfT, y: wall.start.y - n_unit.y * halfT }
      const p_end_L = endJunctionData
        ? endJunctionData.right
        : { x: wall.end.x + n_unit.x * halfT, y: wall.end.y + n_unit.y * halfT }
      const p_end_R = endJunctionData
        ? endJunctionData.left
        : { x: wall.end.x - n_unit.x * halfT, y: wall.end.y - n_unit.y * halfT }

      const polyPoints = [p_start_R, p_end_R]
      if (endJunctionData) polyPoints.push(wall.end)
      polyPoints.push(p_end_L, p_start_L)
      if (startJunctionData) polyPoints.push(wall.start)

      // Note: Negate y values because rotation by -π/2 around X flips Z sign
      const shapePoints = polyPoints.map((p) => new THREE.Vector2(p.x, -p.y))
      const shape = new THREE.Shape(shapePoints)

      const extrudeSettings = { depth: wallHeight, bevelEnabled: false }
      const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings)

      // Rotate to lie on XZ plane and extrude along Y
      // After rotation, the wall sits from y=0 to y=wallHeight (no translation needed)
      geometry.rotateX(-Math.PI / 2)

      return geometry
    }, [start, end, tileSize, wallHeight, allWallSegments])

    if (!geometry) return null

    return (
      <group>
        {/* Occluded/behind version - dimmer, shows through everything */}
        <mesh geometry={geometry} renderOrder={1}>
          <meshStandardMaterial
            color="#44ff44"
            depthTest={false}
            depthWrite={false}
            emissive="#22aa22"
            emissiveIntensity={0.1}
            opacity={0.15}
            transparent
          />
        </mesh>
        {/* Visible/front version - brighter, only shows when not occluded */}
        <mesh geometry={geometry} renderOrder={2}>
          <meshStandardMaterial
            color="#44ff44"
            depthTest={true}
            depthWrite={false}
            emissive="#22aa22"
            emissiveIntensity={0.4}
            opacity={0.5}
            transparent
          />
        </mesh>
      </group>
    )
  },
)

WallShadowPreview.displayName = 'WallShadowPreview'
