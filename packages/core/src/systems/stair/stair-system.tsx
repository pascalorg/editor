import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import { spatialGridManager } from '../../hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../../hooks/spatial-grid/spatial-grid-sync'
import type { AnyNode, AnyNodeId, StairNode, StairSegmentNode } from '../../schema'
import useScene from '../../store/use-scene'

const pendingStairUpdates = new Set<AnyNodeId>()
const MAX_STAIRS_PER_FRAME = 2
const MAX_SEGMENTS_PER_FRAME = 4

// ============================================================================
// STAIR SYSTEM
// ============================================================================

export const StairSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)
  const rootNodeIds = useScene((state) => state.rootNodeIds)

  useFrame(() => {
    if (rootNodeIds.length === 0) {
      pendingStairUpdates.clear()
      return
    }

    if (dirtyNodes.size === 0 && pendingStairUpdates.size === 0) return

    const nodes = useScene.getState().nodes

    // --- Pass 1: Process dirty stair-segments (throttled) ---
    // Collect parent stair IDs that need segment transform recomputation
    const parentsNeedingSegmentSync = new Set<AnyNodeId>()

    let segmentsProcessed = 0
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node) return

      if (node.type === 'stair-segment') {
        const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
        if (mesh) {
          const isVisible = mesh.parent?.visible !== false
          if (isVisible && segmentsProcessed < MAX_SEGMENTS_PER_FRAME) {
            // Geometry will be updated; chained position is applied in the parent sync pass below
            updateStairSegmentGeometry(node as StairSegmentNode, mesh)
            if (node.parentId) parentsNeedingSegmentSync.add(node.parentId as AnyNodeId)
            segmentsProcessed++
          } else if (isVisible) {
            return // Over budget — keep dirty, process next frame
          } else if (mesh.geometry.type === 'BoxGeometry') {
            // Replace BoxGeometry placeholder with empty geometry
            mesh.geometry.dispose()
            const placeholder = new THREE.BufferGeometry()
            placeholder.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
            mesh.geometry = placeholder
          }
          clearDirty(id as AnyNodeId)
        } else {
          clearDirty(id as AnyNodeId)
        }
        // Queue the parent stair for a merged geometry update
        if (node.parentId) {
          pendingStairUpdates.add(node.parentId as AnyNodeId)
        }
      } else if (node.type === 'stair') {
        pendingStairUpdates.add(id as AnyNodeId)
        // Also sync individual segment positions when in edit mode
        parentsNeedingSegmentSync.add(id as AnyNodeId)
        clearDirty(id as AnyNodeId)
      }
    })

    // --- Pass 1b: Sync chained transforms to individual segment meshes (edit mode) ---
    for (const stairId of parentsNeedingSegmentSync) {
      const stairNode = nodes[stairId]
      if (!stairNode || stairNode.type !== 'stair') continue
      const group = sceneRegistry.nodes.get(stairId) as THREE.Group | undefined
      if (group) {
        syncStairGroupElevation(stairNode as StairNode, group, nodes)
      }
      syncSegmentMeshTransforms(stairNode as StairNode, nodes)
    }

    // --- Pass 2: Process pending merged-stair updates (throttled) ---
    let stairsProcessed = 0
    for (const id of pendingStairUpdates) {
      if (stairsProcessed >= MAX_STAIRS_PER_FRAME) break

      const node = nodes[id]
      if (!node || node.type !== 'stair') {
        pendingStairUpdates.delete(id)
        continue
      }
      const group = sceneRegistry.nodes.get(id) as THREE.Group
      if (group) {
        const mergedMesh = group.getObjectByName('merged-stair') as THREE.Mesh | undefined
        if (mergedMesh?.visible !== false) {
          updateMergedStairGeometry(node as StairNode, group, nodes)
          stairsProcessed++
        }
      }
      pendingStairUpdates.delete(id)
    }
  }, 5)

  return null
}

// ============================================================================
// SEGMENT GEOMETRY
// ============================================================================

/**
 * Generates the step/landing profile as a THREE.Shape (in the XY plane),
 * then extrudes along Z for the segment width.
 */
function generateStairSegmentGeometry(
  segment: StairSegmentNode,
  absoluteHeight: number,
): THREE.BufferGeometry {
  const { width, length, height, stepCount, segmentType, fillToFloor, thickness } = segment

  const shape = new THREE.Shape()

  if (segmentType === 'landing') {
    shape.moveTo(0, 0)
    shape.lineTo(length, 0)

    if (fillToFloor) {
      shape.lineTo(length, -absoluteHeight)
      shape.lineTo(0, -absoluteHeight)
    } else {
      shape.lineTo(length, -thickness)
      shape.lineTo(0, -thickness)
    }
  } else {
    const riserHeight = height / stepCount
    const treadDepth = length / stepCount

    shape.moveTo(0, 0)

    // Draw step profile
    for (let i = 0; i < stepCount; i++) {
      shape.lineTo(i * treadDepth, (i + 1) * riserHeight)
      shape.lineTo((i + 1) * treadDepth, (i + 1) * riserHeight)
    }

    if (fillToFloor) {
      shape.lineTo(length, -absoluteHeight)
      shape.lineTo(0, -absoluteHeight)
    } else {
      // Sloped bottom with consistent thickness
      const angle = Math.atan(riserHeight / treadDepth)
      const vOff = thickness / Math.cos(angle)

      // Bottom-back corner
      shape.lineTo(length, height - vOff)

      if (absoluteHeight === 0) {
        // Ground floor: slope hits the ground (y=0)
        const m = riserHeight / treadDepth
        const xGround = length - (height - vOff) / m

        if (xGround > 0) {
          shape.lineTo(xGround, 0)
        }
      } else {
        // Floating: parallel slope
        shape.lineTo(0, -vOff)
      }
    }
  }

  shape.lineTo(0, 0)

  const geometry = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth: width,
    bevelEnabled: false,
  })

  // Rotate so extrusion is along X (width), and the shape is in the XZ plane
  // Shape is drawn in XY, extruded along Z → rotate -90° around Y then offset
  const matrix = new THREE.Matrix4()
  matrix.makeRotationY(-Math.PI / 2)
  matrix.setPosition(width / 2, 0, 0)
  geometry.applyMatrix4(matrix)

  return geometry
}

function updateStairSegmentGeometry(node: StairSegmentNode, mesh: THREE.Mesh) {
  // Compute absolute height from parent chain
  const absoluteHeight = computeAbsoluteHeight(node)

  const newGeometry = generateStairSegmentGeometry(node, absoluteHeight)

  mesh.geometry.dispose()
  mesh.geometry = newGeometry

  // NOTE: position/rotation are NOT set here — they're set by syncSegmentMeshTransforms
  // which computes the chained position based on segment order and attachmentSide.
}

/**
 * Applies chained transforms to individual segment meshes (edit mode).
 * Each segment's world position is determined by the chain of previous segments,
 * not by the node's stored position field.
 */
function syncSegmentMeshTransforms(stairNode: StairNode, nodes: Record<string, AnyNode>) {
  const segments = (stairNode.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
    .filter((n): n is StairSegmentNode => n?.type === 'stair-segment')

  if (segments.length === 0) return

  const transforms = computeSegmentTransforms(segments)

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const transform = transforms[i]!
    const mesh = sceneRegistry.nodes.get(segment.id) as THREE.Mesh | undefined
    if (mesh) {
      mesh.position.set(transform.position[0], transform.position[1], transform.position[2])
      mesh.rotation.y = transform.rotation
    }
  }
}

function syncStairGroupElevation(
  stairNode: StairNode,
  group: THREE.Group,
  nodes: Record<string, AnyNode>,
) {
  const levelId = resolveLevelId(stairNode, nodes)
  const slabElevation = getStairSlabElevation(levelId, stairNode, nodes)
  group.position.y = stairNode.position[1] + slabElevation
}

function getStairSlabElevation(
  levelId: string,
  stairNode: StairNode,
  nodes: Record<string, AnyNode>,
): number {
  const segments = (stairNode.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
    .filter((n): n is StairSegmentNode => n?.type === 'stair-segment')

  if (segments.length === 0) return 0

  const transforms = computeSegmentTransforms(segments)
  let maxElevation = Number.NEGATIVE_INFINITY

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const transform = transforms[i]!

    const [centerOffsetX, centerOffsetZ] = rotateXZ(0, segment.length / 2, transform.rotation)
    const centerInGroupX = transform.position[0] + centerOffsetX
    const centerInGroupZ = transform.position[2] + centerOffsetZ
    const [centerOffsetWorldX, centerOffsetWorldZ] = rotateXZ(
      centerInGroupX,
      centerInGroupZ,
      stairNode.rotation,
    )

    const slabElevation = spatialGridManager.getSlabElevationForItem(
      levelId,
      [
        stairNode.position[0] + centerOffsetWorldX,
        stairNode.position[1] + transform.position[1],
        stairNode.position[2] + centerOffsetWorldZ,
      ],
      [segment.width, Math.max(segment.height, segment.thickness, 0.01), segment.length],
      [0, stairNode.rotation + transform.rotation, 0],
    )

    if (slabElevation > maxElevation) {
      maxElevation = slabElevation
    }
  }

  return maxElevation === Number.NEGATIVE_INFINITY ? 0 : maxElevation
}

// ============================================================================
// MERGED STAIR GEOMETRY
// ============================================================================

const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()
const _scale = new THREE.Vector3(1, 1, 1)
const _yAxis = new THREE.Vector3(0, 1, 0)

function updateMergedStairGeometry(
  stairNode: StairNode,
  group: THREE.Group,
  nodes: Record<string, AnyNode>,
) {
  const mergedMesh = group.getObjectByName('merged-stair') as THREE.Mesh | undefined
  if (!mergedMesh) return

  const children = stairNode.children ?? []
  const segments = children
    .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
    .filter((n): n is StairSegmentNode => n?.type === 'stair-segment')

  if (segments.length === 0) {
    mergedMesh.geometry.dispose()
    mergedMesh.geometry = new THREE.BufferGeometry()
    mergedMesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    return
  }

  // Compute chained transforms for segments
  const transforms = computeSegmentTransforms(segments)

  const geometries: THREE.BufferGeometry[] = []

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const transform = transforms[i]!

    const absoluteHeight = transform.position[1]
    const geo = generateStairSegmentGeometry(segment, absoluteHeight)

    // Apply segment transform (position + rotation) relative to parent stair
    _position.set(transform.position[0], transform.position[1], transform.position[2])
    _quaternion.setFromAxisAngle(_yAxis, transform.rotation)
    _matrix.compose(_position, _quaternion, _scale)
    geo.applyMatrix4(_matrix)

    geometries.push(geo)
  }

  const merged = mergeGeometries(geometries, false)
  if (merged) {
    mergedMesh.geometry.dispose()
    mergedMesh.geometry = merged
  }

  // Dispose individual geometries
  for (const geo of geometries) {
    geo.dispose()
  }
}

// ============================================================================
// SEGMENT CHAINING
// ============================================================================

interface SegmentTransform {
  position: [number, number, number]
  rotation: number
}

/**
 * Computes world-relative transforms for each segment by chaining
 * based on attachmentSide. This mirrors the prototype's StairSystem logic.
 */
function computeSegmentTransforms(segments: StairSegmentNode[]): SegmentTransform[] {
  const transforms: SegmentTransform[] = []
  let currentPos = new THREE.Vector3(0, 0, 0)
  let currentRot = 0

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!

    if (i === 0) {
      transforms.push({
        position: [currentPos.x, currentPos.y, currentPos.z],
        rotation: currentRot,
      })
    } else {
      const prev = segments[i - 1]!
      const localAttachPos = new THREE.Vector3()
      let rotChange = 0

      switch (segment.attachmentSide) {
        case 'front':
          localAttachPos.set(0, prev.height, prev.length)
          rotChange = 0
          break
        case 'left':
          localAttachPos.set(prev.width / 2, prev.height, prev.length / 2)
          rotChange = Math.PI / 2
          break
        case 'right':
          localAttachPos.set(-prev.width / 2, prev.height, prev.length / 2)
          rotChange = -Math.PI / 2
          break
      }

      // Rotate local attachment point by previous global rotation
      localAttachPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), currentRot)
      currentPos = currentPos.clone().add(localAttachPos)
      currentRot += rotChange

      transforms.push({
        position: [currentPos.x, currentPos.y, currentPos.z],
        rotation: currentRot,
      })
    }
  }

  return transforms
}

function rotateXZ(x: number, z: number, angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}

/**
 * Computes the absolute Y height of a segment by traversing the stair's segment chain.
 */
function computeAbsoluteHeight(node: StairSegmentNode): number {
  const nodes = useScene.getState().nodes
  if (!node.parentId) return 0

  const parent = nodes[node.parentId as AnyNodeId]
  if (!parent || parent.type !== 'stair') return 0

  const stair = parent as StairNode
  const segments = (stair.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
    .filter((n): n is StairSegmentNode => n?.type === 'stair-segment')

  const transforms = computeSegmentTransforms(segments)
  const index = segments.findIndex((s) => s.id === node.id)
  if (index < 0) return 0

  return transforms[index]?.position[1] ?? 0
}
