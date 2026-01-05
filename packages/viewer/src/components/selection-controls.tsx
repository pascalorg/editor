'use client'

import { useEditor } from '@pascal/core/hooks'
import { Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'

/**
 * Calculate oriented bounding box for a group (follows rotation)
 */
function calculateWorldBounds(group: THREE.Group): {
  size: THREE.Vector3
  center: THREE.Vector3
  rotation: THREE.Euler
} | null {
  // Force update of world matrices to ensure accurate calculation
  group.updateMatrixWorld(true)

  // Calculate bounding box in local space (before rotation)
  const box = new THREE.Box3()
  let hasContent = false

  group.traverse((child) => {
    if (child === group) return

    // For meshes with geometry
    if (child instanceof THREE.Mesh && child.geometry) {
      // Check if this mesh belongs to an image node - if so, exclude it from bounds
      let current: THREE.Object3D | null = child
      let isImage = false
      while (current && current !== group) {
        if (current.userData?.nodeId) {
          const node = useEditor.getState().graph.getNodeById(current.userData.nodeId)?.data()
          if (node?.type === 'reference-image') {
            isImage = true
            break
          }
        }
        current = current.parent
      }

      if (isImage) return

      const geometry = child.geometry

      if (!geometry.boundingBox) {
        geometry.computeBoundingBox()
      }

      if (geometry.boundingBox) {
        hasContent = true
        const localBox = geometry.boundingBox.clone()

        // Transform by the mesh's local matrix (relative to parent group)
        const relativeMatrix = new THREE.Matrix4()
        relativeMatrix.copy(child.matrix)

        // Accumulate parent matrices within the group
        let current = child.parent
        while (current && current !== group) {
          relativeMatrix.premultiply(current.matrix)
          current = current.parent
        }

        localBox.applyMatrix4(relativeMatrix)
        box.union(localBox)
      }
    }
  })

  if (!hasContent || box.isEmpty()) return null

  // Get size in local space
  const size = box.getSize(new THREE.Vector3())
  const localCenter = box.getCenter(new THREE.Vector3())

  // Get world position and rotation
  const worldPosition = new THREE.Vector3()
  const worldQuaternion = new THREE.Quaternion()
  const worldScale = new THREE.Vector3()
  group.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale)

  // Convert local center to world position
  const center = localCenter.clone().applyMatrix4(group.matrixWorld)

  // Convert quaternion to euler for easier use
  const rotation = new THREE.Euler().setFromQuaternion(worldQuaternion)

  return { size, center, rotation }
}

/**
 * Generate edge line points for a box
 */
function getBoxEdgePoints(size: THREE.Vector3): [number, number, number][] {
  const hx = size.x / 2
  const hy = size.y / 2
  const hz = size.z / 2

  // 12 edges of a box, each edge is 2 points
  // We'll create line segments for all 12 edges
  return [
    // Bottom face edges
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, -hy, hz],
    [hx, -hy, hz],
    [-hx, -hy, hz],
    [-hx, -hy, hz],
    [-hx, -hy, -hz],
    // Top face edges
    [-hx, hy, -hz],
    [hx, hy, -hz],
    [hx, hy, -hz],
    [hx, hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
    [-hx, hy, hz],
    [-hx, hy, -hz],
    // Vertical edges
    [-hx, -hy, -hz],
    [-hx, hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, -hy, hz],
    [-hx, hy, hz],
  ]
}

interface SelectionBoxProps {
  size: THREE.Vector3
  center: THREE.Vector3
  rotation: THREE.Euler
  color: string
}

function SelectionBox({ size, center, rotation, color }: SelectionBoxProps) {
  const points = useMemo(() => getBoxEdgePoints(size), [size])

  return (
    <group position={center} rotation={rotation}>
      <Line
        color={color}
        dashed
        dashSize={0.2}
        depthTest={false}
        depthWrite={false}
        gapSize={0.05}
        lineWidth={1.5}
        points={points}
        renderOrder={999}
        segments
        transparent
      />
    </group>
  )
}

interface BoundingBoxData {
  size: THREE.Vector3
  center: THREE.Vector3
  rotation: THREE.Euler
}

/**
 * SelectionControls - Shows selection bounding boxes in viewer mode.
 * This is a simplified version that only shows selection indicators without manipulation controls.
 */
export function SelectionControls() {
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const selectedZoneId = useEditor((state) => state.selectedZoneId)
  const { scene } = useThree()

  // In viewer mode with a zone selected, only show combined bounds
  const isViewerZoneMode = !!selectedZoneId

  // Find selected THREE.Group objects by name (nodeId)
  const selectedGroups = useMemo(() => {
    if (!scene || selectedNodeIds.length === 0) return []
    return selectedNodeIds.map((id) => scene.getObjectByName(id)).filter(Boolean) as THREE.Group[]
  }, [scene, selectedNodeIds])

  // Calculate individual bounding boxes for each selected object
  const individualBounds = useMemo(
    () =>
      selectedGroups
        .map((group) => calculateWorldBounds(group))
        .filter(Boolean) as BoundingBoxData[],
    [selectedGroups],
  )

  // Calculate combined bounding box for all selected objects
  // Combined box is axis-aligned in world space (doesn't rotate)
  const combinedBounds = useMemo((): BoundingBoxData | null => {
    if (individualBounds.length === 0) return null

    const combinedBox = new THREE.Box3()

    // For each oriented bound, compute world-space AABB corners and expand
    individualBounds.forEach((bounds) => {
      const { size, center, rotation } = bounds

      // Create a temporary box at origin
      const halfSize = size.clone().multiplyScalar(0.5)
      const corners = [
        new THREE.Vector3(-halfSize.x, -halfSize.y, -halfSize.z),
        new THREE.Vector3(halfSize.x, -halfSize.y, -halfSize.z),
        new THREE.Vector3(-halfSize.x, halfSize.y, -halfSize.z),
        new THREE.Vector3(halfSize.x, halfSize.y, -halfSize.z),
        new THREE.Vector3(-halfSize.x, -halfSize.y, halfSize.z),
        new THREE.Vector3(halfSize.x, -halfSize.y, halfSize.z),
        new THREE.Vector3(-halfSize.x, halfSize.y, halfSize.z),
        new THREE.Vector3(halfSize.x, halfSize.y, halfSize.z),
      ]

      // Rotate and translate corners to world space
      const matrix = new THREE.Matrix4()
      matrix.makeRotationFromEuler(rotation)
      matrix.setPosition(center)

      corners.forEach((corner) => {
        corner.applyMatrix4(matrix)
        combinedBox.expandByPoint(corner)
      })
    })

    const size = combinedBox.getSize(new THREE.Vector3())
    const center = combinedBox.getCenter(new THREE.Vector3())

    return { size, center, rotation: new THREE.Euler(0, 0, 0) }
  }, [individualBounds])

  // Don't render anything if nothing is selected
  if (selectedNodeIds.length === 0 || !combinedBounds) return null

  return (
    <group>
      {/* Combined bounding box */}
      {/* In viewer zone mode: always show as the room boundary */}
      {(isViewerZoneMode || selectedNodeIds.length > 1) && (
        <SelectionBox
          center={combinedBounds.center}
          color={isViewerZoneMode ? '#f59e0b' : '#ffff00'}
          rotation={new THREE.Euler(0, 0, 0)}
          size={combinedBounds.size}
        />
      )}
    </group>
  )
}
