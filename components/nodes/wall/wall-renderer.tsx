'use client'

import { Addition, Base, Geometry, Subtraction, useCSG } from '@react-three/csg'
import { Edges, Line, useGLTF } from '@react-three/drei'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { emitter } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { getMaterialProps, useMaterial } from '@/lib/materials'
import type { SceneGraph } from '@/lib/scenegraph/index'
import type {
  AnyNode,
  GridItem,
  GridPoint,
  ItemNode,
  SceneNode,
  SceneNodeId,
  WallNode,
} from '@/lib/scenegraph/schema/index'
import { TILE_SIZE, WALL_HEIGHT } from '../../editor'

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

type NodeProvider = (id: string) => AnyNode | null | undefined

/**
 * Find all ancestors of a node using the node index
 */
function findAncestors(getNode: NodeProvider, nodeId: string): AnyNode[] {
  const ancestors: AnyNode[] = []
  let current = getNode(nodeId)

  while (current?.parentId) {
    const parent = getNode(current.parentId)
    if (parent) {
      ancestors.push(parent)
      current = parent
    } else {
      break
    }
  }
  return ancestors
}

/**
 * Calculate the absolute world position of a node by traversing up through all parents
 * and accumulating position and rotation transforms
 */
function calculateWorldPosition(
  node: AnyNode & GridItem,
  getNode: NodeProvider,
): { position: [number, number]; rotation: number } {
  // If node doesn't have a parentId property, it's at world root
  if (!node.parentId) {
    return {
      position: node.position,
      rotation: node.rotation,
    }
  }

  // Get all ancestors (from immediate parent up to root)
  const ancestors = findAncestors(getNode, node.id)

  // Start with the node's local position and rotation
  let worldX = node.position[0]
  let worldY = node.position[1]
  let worldRotation = node.rotation

  // Traverse up through ancestors (from immediate parent to root)
  // ancestors array is ordered from immediate parent to root
  for (const ancestor of ancestors) {
    // Check if ancestor has at least position (groups have position but no rotation/size)
    if ('position' in ancestor) {
      const parent = ancestor as any
      const parentRotation = parent.rotation || 0 // Groups don't have rotation, default to 0
      const parentPos = parent.position

      // Rotate the current position by parent's rotation (if any)
      if (parentRotation !== 0) {
        const cos = Math.cos(parentRotation)
        const sin = Math.sin(parentRotation)
        const rotatedX = worldX * cos - worldY * sin
        const rotatedY = worldX * sin + worldY * cos
        worldX = parentPos[0] + rotatedX
        worldY = parentPos[1] + rotatedY
      } else {
        // No rotation, just add position offset
        worldX = parentPos[0] + worldX
        worldY = parentPos[1] + worldY
      }

      // Add parent's rotation (if any)
      worldRotation += parentRotation
    }
  }

  return {
    position: [worldX, worldY],
    rotation: worldRotation,
  }
}

interface WallRendererProps {
  nodeId: WallNode['id']
}

// Create a selector that returns wall IDs and their relevant properties
export const selectWallDataFromLevel = (levelId: string) => (state: { graph: SceneGraph }) => {
  const levelHandle = state.graph.getNodeById(levelId as SceneNodeId)

  const level = levelHandle?.data()
  if (!level || level.type !== 'level') {
    return { wallIds: [], wallData: {} }
  }

  const wallIds: string[] = []
  const wallData: Record<
    string,
    { position: [number, number]; size: [number, number]; rotation: number }
  > = {}

  const traverse = (nodes: AnyNode[]) => {
    for (const node of nodes) {
      if (node.type === 'wall') {
        const wall = node as WallNode
        wallIds.push(wall.id)
        wallData[wall.id] = {
          position: wall.position,
          size: wall.size,
          rotation: wall.rotation || 0,
        }
      } else if (node.type === 'group' && 'children' in node && Array.isArray(node.children)) {
        traverse(node.children as AnyNode[])
      }
    }
  }

  // Use SceneGraph handles to get children
  const children = levelHandle!.children().map((h) => h.data())
  traverse(children as AnyNode[])

  return { wallIds, wallData }
}

const createWallDataSelector = (levelId: string) => {
  let lastWallIds: string[] = []
  let lastWallData: Record<string, any> = {}
  let lastResult = { wallIds: lastWallIds, wallData: lastWallData }
  return (state: { graph: SceneGraph }) => {
    const levelHandle = state.graph.getNodeById(levelId as SceneNodeId)
    if (!levelHandle) {
      return lastResult // Return same reference if no level
    }

    const wallIds: string[] = []
    const wallData: Record<string, any> = {}

    // Recursive traversal helper using scene graph handles or data
    // Since we are inside a selector, accessing state.graph is fine, but state.graph.getNodeById returns handles wrapper around scene
    // We can just use the raw nodes if we want, or handles.

    // We need to traverse children recursively.
    // levelHandle.children() is only direct children.

    const traverse = (handle: any) => {
      const children = handle.children()
      for (const childHandle of children) {
        const node = childHandle.data()
        if (node.type === 'wall') {
          const wall = node as WallNode
          wallIds.push(wall.id)
          wallData[wall.id] = {
            position: wall.position,
            size: wall.size,
            rotation: wall.rotation || 0,
            start: wall.start,
            end: wall.end,
          }
        } else if (node.type === 'group') {
          traverse(childHandle)
        }
      }
    }

    traverse(levelHandle)

    // Check if data actually changed
    const idsChanged =
      wallIds.length !== lastWallIds.length || !wallIds.every((id, i) => id === lastWallIds[i])

    const dataChanged =
      Object.keys(wallData).length !== Object.keys(lastWallData).length ||
      !Object.keys(wallData).every((key) => {
        const prev = lastWallData[key]
        const next = wallData[key]
        return (
          prev &&
          JSON.stringify(prev.position) === JSON.stringify(next.position) &&
          JSON.stringify(prev.size) === JSON.stringify(next.size) &&
          JSON.stringify(prev.start) === JSON.stringify(next.start) &&
          JSON.stringify(prev.end) === JSON.stringify(next.end) &&
          prev.rotation === next.rotation
        )
      })

    if (idsChanged || dataChanged) {
      lastWallIds = wallIds
      lastWallData = wallData
      lastResult = { wallIds, wallData }
    }

    return lastResult
  }
}

export function WallRenderer({ nodeId }: WallRendererProps) {
  const debug = useEditor((state) => state.debug)

  const {
    isPreview,
    canPlace,
    deletePreview,
    deleteRange,
    paintPreview,
    paintRange,
    paintFace,
    levelId,
    nodeSize,
    nodeChildrenIdsStr,
    materialFront,
    materialBack,
    interiorSide,
  } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId)
      const node = handle?.data() as WallNode | undefined

      // getLevelId helper in state works with node object, but we updated it to take node
      // But store.getLevelId(node) calls graph.getNodeById.

      // Actually we can just use handle.meta.levelId directly if available via selector?
      // Yes, SceneGraph handles have meta.
      const levelId = state.graph.index.byId.get(nodeId)?.levelId

      return {
        isPreview: node?.editor?.preview === true,
        canPlace: node?.editor?.canPlace !== false,
        deletePreview: node?.editor?.deletePreview === true,
        deleteRange: node?.editor?.deleteRange as [number, number] | undefined,
        paintPreview: node?.editor?.paintPreview === true,
        paintRange: node?.editor?.paintRange as [number, number] | undefined,
        paintFace: node?.editor?.paintFace as 'front' | 'back' | undefined,
        levelId,
        nodeSize: node?.size || [0, 0],
        nodeChildrenIdsStr: JSON.stringify(node?.children?.map((child) => child.id) || []),
        materialFront: node?.materialFront || 'concrete',
        materialBack: node?.materialBack || 'brick',
        interiorSide: node?.interiorSide || 'neither',
      }
    }),
  )

  // Use it with useMemo to create a stable selector
  const wallDataSelector = useMemo(
    () => createWallDataSelector(levelId ?? ''),
    [levelId, createWallDataSelector],
  )
  const { wallIds, wallData } = useEditor(useShallow(wallDataSelector))

  const nodeChildrenIds = useMemo(() => JSON.parse(nodeChildrenIdsStr), [nodeChildrenIdsStr])

  // Determine preview colors based on canPlace using centralized materials
  const previewProps = getMaterialProps(canPlace ? 'preview-valid' : 'preview-invalid')
  const previewColor = previewProps.color
  const previewEmissive = previewProps.emissive
  const previewLineDim = canPlace ? '#336633' : '#663333'

  // Delete preview colors using centralized materials
  const deleteProps = getMaterialProps('delete')
  const deleteColor = deleteProps.color
  const deleteEmissive = deleteProps.emissive

  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  // Calculate local space coordinates for preview line
  // The parent group already handles position & rotation, so we render in local space
  const { localEndX, localEndZ } = useMemo(() => {
    const length = nodeSize[0] // Length in grid units
    const worldLength = length * TILE_SIZE

    // In local space, start is always at (0, 0) and end is at (length, 0)
    // since the parent group handles the rotation and position
    return {
      localEndX: worldLength,
      localEndZ: 0,
    }
  }, [nodeSize])

  // Generate wall geometry similar to wall.tsx with junction handling
  // Note: Geometry is in LOCAL space since parent group handles position & rotation
  const wallGeometry = useMemo(() => {
    // Get wall dimensions from node
    const length = nodeSize[0] // Length in grid units
    const worldLength = length * TILE_SIZE
    const wallHeight = WALL_HEIGHT

    if (worldLength < 1e-9) return null // Skip zero-length walls

    const halfT = WALL_THICKNESS / 2

    // Calculate world space coordinates for junction detection
    // Now using calculateWorldPosition to account for parent transforms
    const graph = useEditor.getState().graph
    const getNode = (id: string) => graph.getNodeById(id as SceneNodeId)?.data()

    const wall = getNode(nodeId) as WallNode
    if (!wall) return null

    const worldPos = calculateWorldPosition(wall, getNode)
    const [x1, y1] = worldPos.position
    const worldRotation = worldPos.rotation

    // Calculate end point in world space
    // rotation was calculated as atan2(-dy, dx), so when reconstructing:
    // x2 = x1 + length * cos(rotation)
    // y2 = y1 - length * sin(rotation)  <- Note the minus sign!
    const x2 = x1 + Math.cos(worldRotation) * length
    const y2 = y1 - Math.sin(worldRotation) * length

    const liveWalls: LiveWall[] = wallIds.map((wallId) => {
      const data = wallData[wallId]

      // Get the actual wall node from the index
      const wallNode = getNode(wallId) as WallNode
      const wWorldPos = calculateWorldPosition(wallNode, getNode)
      const [wx1, wy1] = wWorldPos.position
      const wWorldRotation = wWorldPos.rotation
      const wLength = data.size[0]

      const wx2 = wx1 + Math.cos(wWorldRotation) * wLength
      const wy2 = wy1 - Math.sin(wWorldRotation) * wLength

      return {
        id: wallId,
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
    const thisWall = liveWalls.find((w) => w.id === nodeId)
    if (!thisWall) return null

    const key_start = pointToKey(thisWall.start)
    const key_end = pointToKey(thisWall.end)
    const startJunctionData = junctionData.get(key_start)?.get(nodeId)
    const endJunctionData = junctionData.get(key_end)?.get(nodeId)

    // Helper to transform world point to local space
    const worldToLocal = (worldPoint: Point): { x: number; z: number } => {
      // Translate to origin
      const dx = worldPoint.x - thisWall.start.x
      const dy = worldPoint.y - thisWall.start.y
      // Since rotation = atan2(-dy, dx), we rotate by +rotation (not -rotation) to align with +X axis
      const cos = Math.cos(worldRotation)
      const sin = Math.sin(worldRotation)
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
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: wallHeight,
      bevelEnabled: false,
      UVGenerator: {
        generateTopUV: (_geo, vertices, ...idx) => {
          const [a, b, c] = idx
          return [
            new THREE.Vector2(vertices[a * 3] + 0.5, vertices[a * 3 + 1] + 0.5),
            new THREE.Vector2(vertices[b * 3] + 0.5, vertices[b * 3 + 1] + 0.5),
            new THREE.Vector2(vertices[c * 3] + 0.5, vertices[c * 3 + 1] + 0.5),
          ]
        },
        generateSideWallUV: (_geo, vertices, ...idx) => {
          const [a, b, c, d] = idx
          return [
            new THREE.Vector2(vertices[a * 3], vertices[a * 3 + 1]),
            new THREE.Vector2(vertices[b * 3], vertices[b * 3 + 1]),
            new THREE.Vector2(vertices[c * 3], vertices[c * 3 + 1]),
            new THREE.Vector2(vertices[d * 3], vertices[d * 3 + 1]),
          ]
        },
      },
    }
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings)

    // Rotate to lie on XZ plane and extrude along Y
    geometry.rotateX(-Math.PI / 2)

    // Assign material groups based on face normals (after rotation)
    // Material indices: 0 = front (+Z), 1 = back (-Z), 2 = sides (top/bottom/ends)
    const positions = geometry.getAttribute('position')
    const indices = geometry.getIndex()

    geometry.clearGroups()

    // Helper vectors for computing face normal
    const vA = new THREE.Vector3()
    const vB = new THREE.Vector3()
    const vC = new THREE.Vector3()
    const ab = new THREE.Vector3()
    const ac = new THREE.Vector3()
    const faceNormal = new THREE.Vector3()

    // Determine number of triangles and how to access vertex indices
    const isIndexed = indices !== null
    const numTriangles = isIndexed ? indices.count / 3 : positions.count / 3

    // Process each triangle and assign to material group based on computed face normal
    let currentGroup: { start: number; count: number; materialIndex: number } | null = null

    for (let i = 0; i < numTriangles; i++) {
      const triStart = i * 3

      // Get vertex indices - for non-indexed geometry, vertices are sequential
      const idxA = isIndexed ? indices.getX(triStart) : triStart
      const idxB = isIndexed ? indices.getX(triStart + 1) : triStart + 1
      const idxC = isIndexed ? indices.getX(triStart + 2) : triStart + 2

      // Get triangle vertices
      vA.fromBufferAttribute(positions, idxA)
      vB.fromBufferAttribute(positions, idxB)
      vC.fromBufferAttribute(positions, idxC)

      // Compute face normal using cross product
      ab.subVectors(vB, vA)
      ac.subVectors(vC, vA)
      faceNormal.crossVectors(ab, ac).normalize()

      const nx = faceNormal.x
      const ny = faceNormal.y
      const nz = faceNormal.z

      // Determine material based on dominant normal direction
      let materialIndex: number
      const absX = Math.abs(nx)
      const absY = Math.abs(ny)
      const absZ = Math.abs(nz)

      if (absZ > absX && absZ > absY) {
        // Z-facing: front or back wall surfaces
        materialIndex = nz > 0 ? 0 : 1 // 0 = front (+Z), 1 = back (-Z)
      } else {
        // X or Y facing: sides (end caps, top, bottom)
        materialIndex = 2
      }

      // Group consecutive triangles with same material
      if (currentGroup === null || currentGroup.materialIndex !== materialIndex) {
        if (currentGroup !== null) {
          geometry.addGroup(currentGroup.start, currentGroup.count, currentGroup.materialIndex)
        }
        currentGroup = { start: triStart, count: 3, materialIndex }
      } else {
        currentGroup.count += 3
      }
    }

    // Add the last group
    if (currentGroup !== null) {
      geometry.addGroup(currentGroup.start, currentGroup.count, currentGroup.materialIndex)
    }

    return geometry
  }, [wallData, wallIds, nodeId, nodeSize])

  // Generate geometry for the delete preview segment (only the portion to be deleted)
  const deleteSegmentGeometry = useMemo(() => {
    if (!deleteRange) return null

    const [rangeStart, rangeEnd] = deleteRange
    const wallHeight = WALL_HEIGHT
    const halfT = WALL_THICKNESS / 2

    // Calculate segment bounds in world units
    const segmentStartX = rangeStart * TILE_SIZE
    const segmentEndX = (rangeEnd + 1) * TILE_SIZE // +1 because range is inclusive

    // Simple box geometry for the segment (no junction handling for preview)
    const shapePoints = [
      new THREE.Vector2(segmentStartX, halfT),
      new THREE.Vector2(segmentEndX, halfT),
      new THREE.Vector2(segmentEndX, -halfT),
      new THREE.Vector2(segmentStartX, -halfT),
    ]
    const shape = new THREE.Shape(shapePoints)

    const extrudeSettings = { depth: wallHeight, bevelEnabled: false }
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings)
    geometry.rotateX(-Math.PI / 2)

    return geometry
  }, [deleteRange])

  // Generate geometry for the paint preview segment - only on the specified face
  const paintSegmentGeometry = useMemo(() => {
    if (!paintRange) return null
    if (!paintFace) return null

    const [rangeStart, rangeEnd] = paintRange
    const wallHeight = WALL_HEIGHT
    const halfT = WALL_THICKNESS / 2

    // Calculate segment bounds in world units
    const segmentStartX = rangeStart * TILE_SIZE
    const segmentEndX = (rangeEnd + 1) * TILE_SIZE // +1 because range is inclusive

    // Create a thin plane on only the specified face (front = +Z, back = -Z)
    const planeThickness = 0.02
    const zOffset = paintFace === 'front' ? halfT + planeThickness / 2 : -halfT - planeThickness / 2

    // Create plane geometry for the face
    const planeWidth = segmentEndX - segmentStartX
    const geometry = new THREE.BoxGeometry(planeWidth, wallHeight, planeThickness)

    // Position the plane: center it on the segment and at the correct Z offset
    geometry.translate(segmentStartX + planeWidth / 2, wallHeight / 2, zOffset)

    return geometry
  }, [paintRange, paintFace])

  // Determine opacity based on selected floo, [allWalls]r
  // When no floor is selected (selectedFloorId === null), show all walls fully opaque (like full view mode)
  // When a floor is selected, show only that floor's walls fully opaque, others semi-transparent
  const isActiveFloor = selectedFloorId === null || levelId === selectedFloorId

  const opacity = isActiveFloor ? 1 : 0.3
  const transparent = !isActiveFloor

  const getClosestGridPoint = useCallback(
    (point: THREE.Vector3, object: THREE.Object3D): GridPoint => {
      // Transform the world point to the wall mesh's local coordinate system
      // This automatically handles all parent transforms (room, level, etc.)
      const localPoint = object.worldToLocal(point.clone())

      // Convert to grid coordinates in local space
      const localGridX = localPoint.x / TILE_SIZE
      const localGridZ = localPoint.z / TILE_SIZE

      // In wall-local space, the wall runs from (0, 0) to (length, 0) along the X-axis
      const wallLength = nodeSize[0] // Wall length in grid units

      // Project onto the wall's X-axis (the wall runs horizontally in its local space)
      // Clamp to [0, wallLength]
      const projectedX = Math.max(0, Math.min(wallLength, localGridX))

      // Return the grid position in wall-local coordinates
      // Round to nearest grid point
      const localGridPoint: GridPoint = {
        x: Math.round(projectedX),
        z: 0, // Always 0 in wall-local space (on the wall surface)
      }

      return localGridPoint
    },
    [nodeSize],
  )
  //  Event handlers

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // Only emit events for left-click (button 0)
      if (e.button !== 0) return

      const node = useEditor.getState().graph.getNodeById(nodeId)?.data() as WallNode
      const eventData = {
        node,
        gridPosition: getClosestGridPoint(e.point, e.object),
        position: [e.point.x, e.point.y, e.point.z] as [number, number, number],
        normal: e.face
          ? ([e.face.normal.x, e.face.normal.y, e.face.normal.z] as [number, number, number])
          : undefined,
        stopPropagation: () => e.stopPropagation(),
      }
      emitter.emit('wall:click', eventData)
      emitter.emit('wall:pointerdown', eventData)
    },
    [getClosestGridPoint, nodeId],
  )

  const onPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // Only emit events for left-click (button 0)
      if (e.button !== 0) return

      const node = useEditor.getState().graph.getNodeById(nodeId)?.data() as WallNode
      emitter.emit('wall:pointerup', {
        node,
        gridPosition: getClosestGridPoint(e.point, e.object),
        position: [e.point.x, e.point.y, e.point.z],
        normal: e.face
          ? ([e.face.normal.x, e.face.normal.y, e.face.normal.z] as [number, number, number])
          : undefined,
        stopPropagation: () => e.stopPropagation(),
      })
    },
    [getClosestGridPoint, nodeId],
  )

  const onPointerEnter = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const node = useEditor.getState().graph.getNodeById(nodeId)?.data() as WallNode
      emitter.emit('wall:enter', {
        node,
        gridPosition: getClosestGridPoint(e.point, e.object),
        position: [e.point.x, e.point.y, e.point.z],
        normal: e.face ? [e.face.normal.x, e.face.normal.y, e.face.normal.z] : undefined,
        stopPropagation: () => e.stopPropagation(),
      })
    },
    [getClosestGridPoint, nodeId],
  )

  const onPointerLeave = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const node = useEditor.getState().graph.getNodeById(nodeId)?.data() as WallNode
      emitter.emit('wall:leave', {
        node,
        gridPosition: getClosestGridPoint(e.point, e.object),
        position: [e.point.x, e.point.y, e.point.z],
        normal: e.face ? [e.face.normal.x, e.face.normal.y, e.face.normal.z] : undefined,
        stopPropagation: () => e.stopPropagation(),
      })
    },
    [getClosestGridPoint, nodeId],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const node = useEditor.getState().graph.getNodeById(nodeId)?.data() as WallNode
      emitter.emit('wall:move', {
        node,
        gridPosition: getClosestGridPoint(e.point, e.object),
        position: [e.point.x, e.point.y, e.point.z],
        normal: e.face ? [e.face.normal.x, e.face.normal.y, e.face.normal.z] : undefined,
        stopPropagation: () => e.stopPropagation(),
      })
    },
    [getClosestGridPoint, nodeId],
  )

  const selectedMaterial = useEditor((state) => state.selectedMaterial)

  const frontMaterial = useMaterial(materialFront)
  const backMaterial = useMaterial(materialBack)
  const sidesMaterial = useMaterial('white')
  const ghostMaterial = useMaterial('ghost')
  const paintMaterial = useMaterial(selectedMaterial)
  const shadowCasterMaterial = useMaterial('shadow-caster')

  const wallMaterial = useMemo(
    () => (isActiveFloor ? [frontMaterial, backMaterial, sidesMaterial] : ghostMaterial),
    [isActiveFloor, frontMaterial, backMaterial, sidesMaterial, ghostMaterial],
  )

  const u = new THREE.Vector3()
  const v = new THREE.Vector3()
  const wallMesh = useRef<THREE.Mesh>(null)
  const miniwallMesh = useRef<THREE.Mesh>(null)
  const activeTool = useEditor((state) => state.activeTool)
  const controlMode = useEditor((state) => state.controlMode)
  const lastCheckedAt = useRef(0)
  useFrame(({ camera, clock }) => {
    if (clock.elapsedTime - lastCheckedAt.current < 0.2) {
      return
    }
    camera.getWorldDirection(u)
    lastCheckedAt.current = clock.elapsedTime
    if (wallMesh.current) {
      wallMesh.current.getWorldDirection(v)

      let hideWall = false

      if (
        activeTool === 'wall' ||
        activeTool === 'custom-room' ||
        activeTool === 'room' ||
        controlMode === 'painting'
      ) {
        hideWall = false
      } else if (interiorSide === 'front') {
        hideWall = v.dot(u) > 0
      } else if (interiorSide === 'back') {
        hideWall = v.dot(u) < 0
      } else if (interiorSide === 'both') {
        hideWall = true
      }
      // wallMesh.current.visible = !hideWall
      wallMesh.current.material = hideWall ? shadowCasterMaterial : wallMaterial
      if (miniwallMesh.current) {
        miniwallMesh.current.visible = hideWall
      }
    }
  })

  if (!wallGeometry) return null

  return (
    <>
      {isPreview ? (
        <>
          {/* Preview line - occluded version (dimmer) */}
          <Line
            color={previewLineDim}
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
            color={previewColor}
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
              color={previewColor}
              depthTest={false}
              depthWrite={false}
              emissive={previewEmissive}
              emissiveIntensity={0.1}
              opacity={0.15}
              transparent
            />
          </mesh>

          {/* Visible/front version - brighter, only shows when not occluded */}
          <mesh geometry={wallGeometry} renderOrder={2}>
            <meshStandardMaterial
              color={previewColor}
              depthTest={true}
              depthWrite={false}
              emissive={previewEmissive}
              emissiveIntensity={0.4}
              opacity={0.5}
              transparent
            />
          </mesh>
        </>
      ) : (
        <>
          <group>
            {/* INVISIBLE MESH USED FOR EVENTS */}
            {isActiveFloor && (
              <mesh
                geometry={wallGeometry}
                onPointerDown={onPointerDown}
                onPointerEnter={onPointerEnter}
                onPointerLeave={onPointerLeave}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                visible={false}
              />
            )}
            <mesh
              geometry={wallGeometry}
              material={sidesMaterial}
              ref={miniwallMesh}
              scale-y={0.05}
              visible={false}
            />
            <mesh castShadow receiveShadow ref={wallMesh}>
              <Geometry useGroups>
                <Base geometry={wallGeometry} material={wallMaterial} />
                {nodeChildrenIds.map((openingId: string) => (
                  <WallOpening key={openingId} nodeId={openingId} />
                ))}
                {/* Delete preview overlay - only shows the segment to be deleted */}
                {deletePreview && deleteSegmentGeometry && (
                  <Subtraction geometry={deleteSegmentGeometry} renderOrder={100} showOperation>
                    <meshStandardMaterial
                      color={deleteColor}
                      depthTest={true}
                      depthWrite={false}
                      emissive={deleteEmissive}
                      emissiveIntensity={0.6}
                      opacity={0.6}
                      transparent
                    />
                  </Subtraction>
                )}
                {/* {hideWallBasedOnCameraPosition && (
                  <Subtraction
                    position-x={nodeSize[0] * TILE_SIZE * 0.5}
                    position-y={WALL_HEIGHT / 2 + WALL_HEIGHT * 0.2}
                    renderOrder={10}
                  >
                    <boxGeometry args={[nodeSize[0] * TILE_SIZE, WALL_HEIGHT, nodeSize[1]]} />
                  </Subtraction>
                )} */}
                {/* Paint preview overlay - shows the segment to be painted */}
                {paintPreview && paintSegmentGeometry && (
                  <Addition
                    geometry={paintSegmentGeometry}
                    material={paintMaterial}
                    showOperation
                  />
                )}
              </Geometry>
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
          </group>
        </>
      )}
    </>
  )
}

const WallOpening = ({ nodeId }: { nodeId: string }) => {
  const opening = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId as SceneNodeId)
      const node = handle?.data()

      return {
        position: (node as any)?.position,
        modelPosition: (node as ItemNode)?.modelPosition || [0, 0, 0],
        modelScale: (node as ItemNode)?.modelScale || [1, 1, 1],
        nodeSrc: (node as ItemNode)?.src,
      }
    }),
  )

  if (!opening.nodeSrc) {
    return null
  }

  return (
    <Suspense>
      <WallCutout
        key={`${opening.position.join(',')}-${opening.nodeSrc}`}
        modelPosition={opening.modelPosition}
        modelScale={opening.modelScale}
        position={opening.position}
        src={opening.nodeSrc}
      />
    </Suspense>
  )
}

import { lerp } from 'three/src/math/MathUtils.js'
import type { GLTF } from 'three-stdlib'

type GLTFResult = GLTF & {
  nodes: {
    cutout?: THREE.Mesh
  }
}

const WallCutout = ({
  position,
  src,
  modelPosition,
  modelScale,
}: {
  position: ItemNode['position']
  src: ItemNode['src']
  modelPosition: ItemNode['modelPosition']
  modelScale: ItemNode['modelScale']
}) => {
  const { nodes } = useGLTF(src) as GLTFResult

  const { update } = useCSG()

  useEffect(() => {
    if (!nodes.cutout?.geometry) {
      return
    }
    update()
  }, [update, nodes])

  if (!nodes.cutout?.geometry) {
    return null
  }

  return (
    <Subtraction
      geometry={nodes.cutout.geometry}
      position-x={modelPosition[0] + position[0] * TILE_SIZE}
      position-y={modelPosition[1]}
      position-z={modelPosition[2] + position[1] * TILE_SIZE}
      scale={modelScale}
    >
      <meshStandardMaterial color={'skyblue'} opacity={0.5} transparent />
    </Subtraction>
  )
}
