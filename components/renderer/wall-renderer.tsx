'use client'

import { Base, Geometry, Subtraction } from '@react-three/csg'
import { Edges, Line } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useCallback, useMemo } from 'react'
import * as THREE from 'three'
import { emitter } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { useWalls } from '@/hooks/use-nodes'
import type { DoorNode, WallNode } from '@/lib/nodes/types'
import { getNodeRelativePosition } from '@/lib/nodes/utils'
import { TILE_SIZE, WALL_HEIGHT } from '../editor'

export const WALL_THICKNESS = 0.2 // 20cm wall thickness
// --- Junction Helper Types and Functions (from wall.tsx) ---
interface Point {
  x: number
  y: number
}
interface LineEquation {
  a: number
  b: number
  c: number
}
interface ProcessedWall {
  angle: number
  edgeA: LineEquation
  edgeB: LineEquation
  v: Point
  wall_id: string
  pA: Point
  pB: Point
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

function pointToKey(p: Point, tolerance = 1e-3): string {
  const snap = 1 / tolerance
  return `${Math.round(p.x * snap)},${Math.round(p.y * snap)}`
}

function getOutgoingVector(wall: LiveWall, endType: 'start' | 'end', meetingPoint: Point): Point {
  if (endType === 'start') {
    return { x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y }
  }
  return { x: wall.start.x - wall.end.x, y: wall.start.y - wall.end.y }
}

function createLineFromPointAndVector(p: Point, v: Point): LineEquation {
  const a = -v.y
  const b = v.x
  const c = -(a * p.x + b * p.y)
  return { a, b, c }
}

function intersectLines(l1: LineEquation, l2: LineEquation): Point | null {
  const det = l1.a * l2.b - l2.a * l1.b
  if (Math.abs(det) < 1e-9) return null
  const x = (l1.b * l2.c - l2.b * l1.c) / det
  const y = (l2.a * l1.c - l1.a * l2.c) / det
  return { x, y }
}

function findJunctions(walls: LiveWall[]): Map<string, Junction> {
  const junctions = new Map<string, Junction>()

  walls.forEach((wall) => {
    const keyStart = pointToKey(wall.start)
    const keyEnd = pointToKey(wall.end)

    if (!junctions.has(keyStart)) {
      junctions.set(keyStart, { meetingPoint: wall.start, connectedWalls: [] })
    }
    junctions.get(keyStart)?.connectedWalls.push({ wall, endType: 'start' })

    if (!junctions.has(keyEnd)) {
      junctions.set(keyEnd, { meetingPoint: wall.end, connectedWalls: [] })
    }
    junctions.get(keyEnd)?.connectedWalls.push({ wall, endType: 'end' })
  })

  const actualJunctions = new Map<string, Junction>()
  for (const [key, junction] of junctions.entries()) {
    if (junction.connectedWalls.length >= 2) {
      actualJunctions.set(key, junction)
    }
  }
  return actualJunctions
}

function calculateJunctionIntersections(junction: Junction) {
  const { meetingPoint, connectedWalls } = junction
  const processedWalls: ProcessedWall[] = []

  for (const connected of connectedWalls) {
    const { wall, endType } = connected
    const halfThickness = wall.thickness / 2
    const v = getOutgoingVector(wall, endType, meetingPoint)
    const L = Math.sqrt(v.x * v.x + v.y * v.y)

    if (L < 1e-9) continue

    const n_unit = { x: -v.y / L, y: v.x / L }
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
      edgeA: createLineFromPointAndVector(pA, v),
      edgeB: createLineFromPointAndVector(pB, v),
      v,
      wall_id: wall.id,
      pA,
      pB,
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
// --- End of Junction Helpers ---

interface WallRendererProps {
  node: WallNode
}

export function WallRenderer({ node }: WallRendererProps) {
  const getLevelId = useEditor((state) => state.getLevelId)
  const debug = useEditor((state) => state.debug)
  const tileSize = TILE_SIZE

  // Check if this is a preview node
  const isPreview = node.preview === true

  const levelId = useMemo(() => {
    const id = getLevelId(node)
    return id
  }, [getLevelId, node])
  const allWalls = useWalls(levelId || '')
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  // Calculate local space coordinates for preview line
  // The parent group already handles position & rotation, so we render in local space
  const { localEndX, localEndZ } = useMemo(() => {
    const length = node.size[0] // Length in grid units
    const worldLength = length * TILE_SIZE

    // In local space, start is always at (0, 0) and end is at (length, 0)
    // since the parent group handles the rotation and position
    return {
      localEndX: worldLength,
      localEndZ: 0,
    }
  }, [node.size])

  // Generate wall geometry similar to wall.tsx with junction handling
  // Note: Geometry is in LOCAL space since parent group handles position & rotation
  const wallGeometry = useMemo(() => {
    // Get wall dimensions from node
    const length = node.size[0] // Length in grid units
    const worldLength = length * TILE_SIZE
    const wallHeight = WALL_HEIGHT

    if (worldLength < 1e-9) return null // Skip zero-length walls

    const halfT = WALL_THICKNESS / 2

    // Calculate world space coordinates for junction detection
    // Note: rotation was calculated as atan2(-dy, dx), so when reconstructing:
    // x2 = x1 + length * cos(rotation)
    // y2 = y1 - length * sin(rotation)  <- Note the minus sign!
    const [x1, y1] = node.position
    const x2 = x1 + Math.cos(node.rotation) * length
    const y2 = y1 - Math.sin(node.rotation) * length

    // Convert all walls to LiveWall format for junction calculation
    const liveWalls: LiveWall[] = allWalls.map((w) => {
      const [wx1, wy1] = w.position
      const wLength = w.size[0]
      const wx2 = wx1 + Math.cos(w.rotation) * wLength
      const wy2 = wy1 - Math.sin(w.rotation) * wLength
      return {
        id: w.id,
        start: { x: wx1 * TILE_SIZE, y: wy1 * TILE_SIZE },
        end: { x: wx2 * TILE_SIZE, y: wy2 * TILE_SIZE },
        thickness: WALL_THICKNESS,
      }
    })

    // Find junctions
    const junctions = findJunctions(liveWalls)
    const junctionData = new Map<string, Map<string, { left: Point; right: Point }>>()
    for (const [key, junction] of junctions.entries()) {
      const { wallIntersections } = calculateJunctionIntersections(junction)
      junctionData.set(key, wallIntersections)
    }

    // Get this wall's data
    const thisWall = liveWalls.find((w) => w.id === node.id)
    if (!thisWall) return null

    const key_start = pointToKey(thisWall.start)
    const key_end = pointToKey(thisWall.end)
    const startJunctionData = junctionData.get(key_start)?.get(node.id)
    const endJunctionData = junctionData.get(key_end)?.get(node.id)

    // Helper to transform world point to local space
    const worldToLocal = (worldPoint: Point): { x: number; z: number } => {
      // Translate to origin
      const dx = worldPoint.x - thisWall.start.x
      const dy = worldPoint.y - thisWall.start.y
      // Since rotation = atan2(-dy, dx), we rotate by +rotation (not -rotation) to align with +X axis
      const cos = Math.cos(node.rotation)
      const sin = Math.sin(node.rotation)
      return {
        x: dx * cos - dy * sin,
        z: dx * sin + dy * cos,
      }
    }

    // Calculate local space corners
    let p_start_L: { x: number; z: number }
    let p_start_R: { x: number; z: number }
    let p_end_L: { x: number; z: number }
    let p_end_R: { x: number; z: number }

    if (startJunctionData) {
      p_start_L = worldToLocal(startJunctionData.left)
      p_start_R = worldToLocal(startJunctionData.right)
    } else {
      p_start_L = { x: 0, z: halfT }
      p_start_R = { x: 0, z: -halfT }
    }

    if (endJunctionData) {
      p_end_L = worldToLocal(endJunctionData.right)
      p_end_R = worldToLocal(endJunctionData.left)
    } else {
      p_end_L = { x: worldLength, z: halfT }
      p_end_R = { x: worldLength, z: -halfT }
    }

    // Build polygon in local space
    const polyPoints = [p_start_R, p_end_R]
    if (endJunctionData) polyPoints.push({ x: worldLength, z: 0 }) // center point
    polyPoints.push(p_end_L, p_start_L)
    if (startJunctionData) polyPoints.push({ x: 0, z: 0 }) // center point

    // Create THREE.Shape
    // Note: After rotation by -π/2 around X, Vector2(x,y) becomes 3D(x,z,-y)
    // So to get the correct z orientation, we negate: Vector2(x, -z)
    const shapePoints = polyPoints.map((p) => new THREE.Vector2(p.x, -p.z))
    const shape = new THREE.Shape(shapePoints)

    // Create Extrude Geometry
    const extrudeSettings = { depth: wallHeight, bevelEnabled: false }
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings)

    // Rotate to lie on XZ plane and extrude along Y
    geometry.rotateX(-Math.PI / 2)

    return geometry
  }, [node, allWalls])

  // Determine opacity based on selected floor
  // When no floor is selected (selectedFloorId === null), show all walls fully opaque (like full view mode)
  // When a floor is selected, show only that floor's walls fully opaque, others semi-transparent
  const isActiveFloor = selectedFloorId === null || levelId === selectedFloorId
  const opacity = isActiveFloor ? 1 : 0.3
  const transparent = !isActiveFloor

  //  Event handlers

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    emitter.emit('wall:click', {
      node,
      position: [e.point.x, e.point.y, e.point.z],
    })
  }, [])

  const onPointerEnter = useCallback((e: ThreeEvent<PointerEvent>) => {
    emitter.emit('wall:enter', {
      node,
      position: [e.point.x, e.point.y, e.point.z],
    })
  }, [])

  const onPointerLeave = useCallback((e: ThreeEvent<PointerEvent>) => {
    emitter.emit('wall:leave', {
      node,
      position: [e.point.x, e.point.y, e.point.z],
    })
  }, [])

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    emitter.emit('wall:move', {
      node,
      position: [e.point.x, e.point.y, e.point.z],
    })
  }, [])

  if (!wallGeometry) return null

  return (
    <>
      {isPreview ? (
        <>
          {/* Preview line - occluded version (dimmer) */}
          <Line
            color="#336633"
            dashed={false}
            depthTest={false}
            lineWidth={2}
            opacity={0.3}
            points={[
              [0, 0.1, 0], // Start at origin in local space
              [localEndX, 0.1, localEndZ], // End at length along local X axis
            ]}
            transparent
          />

          {/* Preview line - visible version (brighter) */}
          <Line
            color="#44ff44"
            dashed={false}
            depthTest={true}
            lineWidth={3}
            points={[
              [0, 0.1, 0], // Start at origin in local space
              [localEndX, 0.1, localEndZ], // End at length along local X axis
            ]}
          />

          {/* Occluded/behind version - dimmer, shows through everything */}
          <mesh geometry={wallGeometry} renderOrder={1}>
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
          <mesh geometry={wallGeometry} renderOrder={2}>
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
        </>
      ) : (
        <>
          <mesh
            castShadow
            onPointerDown={onPointerDown}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            onPointerMove={onPointerMove}
            receiveShadow
          >
            <Geometry useGroups computeVertexNormals={true}>
              <Base geometry={wallGeometry} />
              {node.children.map((opening, idx) => {
                // Transform opening's world position to wall's local coordinate system
                const { localX, localZ } = getNodeRelativePosition(opening, node, tileSize)

                const scale: [number, number, number] =
                  opening.type === 'door' ? [0.98, 4, 0.3] : [0.9, 1.22, 0.9] // Adjust scale based on type
                // TODO: Create a WallOpening type to save properly the cut and be agnostic here
                return (
                  <Subtraction
                    key={idx}
                    position-x={localX}
                    position-y={opening.type === 'window' ? 1.12 : 0}
                    position-z={localZ}
                    scale={scale}
                    showOperation={opening.preview}
                  >
                    <boxGeometry />
                    <meshStandardMaterial color={'skyblue'} opacity={0.5} transparent />
                  </Subtraction>
                )
              })}
            </Geometry>
            <meshStandardMaterial
              color="beige"
              metalness={0.1}
              opacity={opacity}
              roughness={0.7}
              transparent={transparent}
            />
            {debug && (
              <Edges
                color="#000000"
                key={wallGeometry.id}
                linewidth={1}
                opacity={0.1}
                renderOrder={1000}
                threshold={15}
              />
            )}
          </mesh>
        </>
      )}
    </>
  )
}
