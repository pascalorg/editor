import {
  emitter,
  type GridEvent,
  ItemNode,
  isObject,
  sceneRegistry,
  useScene,
  useSpatialQuery,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { BoxGeometry, type Mesh, type MeshStandardMaterial, Vector3 } from 'three'
import useEditor from '@/store/use-editor'
import { resolveLevelId } from '../../../../../packages/core/src/hooks/spatial-grid/spatial-grid-sync'

/**
 * Snaps a position to 0.5 grid, with an offset to align item edges to grid lines.
 * For items with dimensions like 2.5, the center would be at 1.25 from the edge,
 * which doesn't align with 0.5 grid. This adds an offset so edges align instead.
 */
function snapToGrid(position: number, dimension: number): number {
  // Check if half the dimension has a 0.25 remainder (odd multiple of 0.5)
  const halfDim = dimension / 2
  const needsOffset = Math.abs(((halfDim * 2) % 1) - 0.5) < 0.01
  const offset = needsOffset ? 0.25 : 0
  // Snap to 0.5 grid with offset
  return Math.round((position - offset) * 2) / 2 + offset
}

const stripTransient = (meta: any) => {
  if (!isObject(meta)) return meta
  const { isTransient, ...rest } = meta as Record<string, any>
  return rest
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate cursor rotation in WORLD space from wall normal and orientation
 */
const calculateCursorRotation = (
  normal: [number, number, number] | undefined,
  wallStart: [number, number],
  wallEnd: [number, number],
): number => {
  if (!normal) return 0

  // Wall direction angle in world XZ plane
  const wallAngle = Math.atan2(wallEnd[1] - wallStart[1], wallEnd[0] - wallStart[0])

  // In local wall space, front face has normal.z < 0, back face has normal.z > 0
  if (normal[2] < 0) {
    return -wallAngle
  } else {
    return Math.PI - wallAngle
  }
}

/**
 * Calculate item rotation in WALL-LOCAL space from normal
 * Items are children of the wall mesh, so their rotation is relative to wall's local space
 */
const calculateItemRotation = (normal: [number, number, number] | undefined): number => {
  if (!normal) return 0

  // In wall-local space: X along wall, Y up, Z perpendicular (thickness)
  // Front face (normal.z < 0): item faces -Z local → rotation = 0
  // Back face (normal.z > 0): item faces +Z local → rotation = PI
  return normal[2] < 0 ? 0 : Math.PI
}

/**
 * Determine which side of the wall based on the normal vector
 * In wall-local space, the wall runs along X-axis, so the normal points along Z-axis
 * Positive Z normal = 'back', Negative Z normal = 'front' (flipped due to orientation fix)
 */
const getSideFromNormal = (normal: [number, number, number] | undefined): 'front' | 'back' => {
  if (!normal) return 'front'
  // The Z component of the normal determines which side
  // Flipped: positive Z = back, negative Z = front
  return normal[2] >= 0 ? 'back' : 'front'
}

/**
 * Check if the normal indicates a valid wall side face (front or back)
 * Filters out top face and thickness edges
 *
 * In wall-local geometry space (after ExtrudeGeometry + rotateX):
 * - X axis: along wall direction
 * - Y axis: up (height)
 * - Z axis: perpendicular to wall (thickness direction)
 *
 * So valid side faces have normals pointing in ±Z direction (local space)
 */
const isValidWallSideFace = (normal: [number, number, number] | undefined): boolean => {
  if (!normal) return false

  // Valid side faces have normals pointing in the local Z direction (perpendicular to wall)
  // This filters out top faces (Y direction) and end caps/junctions (X direction)
  return Math.abs(normal[2]) > 0.7
}

export const ItemTool: React.FC = () => {
  const cursorRef = useRef<Mesh>(null!)
  const draftItem = useRef<ItemNode | null>(null)
  const gridPosition = useRef(new Vector3(0, 0, 0))
  const selectedItem = useEditor((state) => state.selectedItem)
  const { canPlaceOnFloor, canPlaceOnWall } = useSpatialQuery()
  const isOnWall = useRef(false)

  useEffect(() => {
    if (!selectedItem) {
      return
    }

    let currentWallId: string | null = null

    const checkCanPlace = () => {
      const currentLevelId = useViewer.getState().selection.levelId
      if (currentLevelId && draftItem.current) {
        let placeable = true
        if (draftItem.current.asset.attachTo) {
          if (!isOnWall.current || !currentWallId) {
            placeable = false
          } else {
            const result = canPlaceOnWall(
              currentLevelId,
              currentWallId as WallNode['id'],
              gridPosition.current.x,
              gridPosition.current.y,
              draftItem.current.asset.dimensions,
              draftItem.current.asset.attachTo as 'wall' | 'wall-side',
              draftItem.current.side,
              [draftItem.current.id],
            )
            placeable = result.valid
          }
        } else {
          placeable = canPlaceOnFloor(
            currentLevelId,
            [gridPosition.current.x, 0, gridPosition.current.z],
            draftItem.current.asset.dimensions,
            [0, 0, 0],
            [draftItem.current.id],
          ).valid
        }
        if (placeable) {
          ;(cursorRef.current.material as MeshStandardMaterial).color.set('green')
          return true
        } else {
          ;(cursorRef.current.material as MeshStandardMaterial).color.set('red')
          return false
        }
      }
    }
    const createDraftItem = () => {
      const currentLevelId = useViewer.getState().selection.levelId
      if (!currentLevelId) {
        return null
      }
      useScene.temporal.getState().pause()
      draftItem.current = ItemNode.parse({
        position: [gridPosition.current.x, gridPosition.current.y, gridPosition.current.z],
        name: selectedItem.name,
        asset: selectedItem,
        metadata: {
          isTransient: true,
        },
      })
      useScene.getState().createNode(draftItem.current, currentLevelId)
      checkCanPlace()
    }
    createDraftItem()

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return

      if (isOnWall.current) return

      const [dimX, , dimZ] = selectedItem.dimensions
      gridPosition.current.set(
        snapToGrid(event.position[0], dimX),
        0,
        snapToGrid(event.position[2], dimZ),
      )
      cursorRef.current.position.set(
        gridPosition.current.x,
        event.position[1],
        gridPosition.current.z,
      )
      checkCanPlace()
      if (draftItem.current) {
        draftItem.current.position = [gridPosition.current.x, 0, gridPosition.current.z]
      }
    }
    const onGridClick = (event: GridEvent) => {
      const currentLevelId = useViewer.getState().selection.levelId
      if (isOnWall.current) return

      if (!currentLevelId || !draftItem.current || !checkCanPlace()) return

      useScene.temporal.getState().resume()

      useScene.getState().updateNode(draftItem.current.id, {
        position: [gridPosition.current.x, 0, gridPosition.current.z],
        metadata: stripTransient(draftItem.current.metadata),
      })
      draftItem.current = null

      useScene.temporal.getState().pause()
      createDraftItem()
    }

    const onWallEnter = (event: WallEvent) => {
      if (
        useViewer.getState().selection.levelId !==
        resolveLevelId(event.node, useScene.getState().nodes)
      ) {
        return
      }
      if (
        draftItem.current?.asset.attachTo === 'wall' ||
        draftItem.current?.asset.attachTo === 'wall-side'
      ) {
        console.log('Wall enter:', event.node.id, event.normal)
        // Ignore top face and thickness edges
        if (!isValidWallSideFace(event.normal)) return

        event.stopPropagation()
        isOnWall.current = true
        currentWallId = event.node.id

        // Determine side and rotation from normal
        const side = getSideFromNormal(event.normal)
        const itemRotation = calculateItemRotation(event.normal)
        const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

        gridPosition.current.set(
          Math.round(event.localPosition[0] * 2) / 2,
          Math.round(event.localPosition[1] * 2) / 2,
          Math.round(event.localPosition[2] * 2) / 2,
        )
        draftItem.current.parentId = event.node.id
        draftItem.current.side = side
        draftItem.current.rotation = [0, itemRotation, 0]

        useScene.getState().updateNode(draftItem.current.id, {
          position: [gridPosition.current.x, gridPosition.current.y, gridPosition.current.z],
          parentId: event.node.id,
          side,
          rotation: [0, itemRotation, 0],
        })
        cursorRef.current.rotation.y = cursorRotation
        checkCanPlace()
      }
    }

    const onWallLeave = (event: WallEvent) => {
      if (!isOnWall.current) return
      isOnWall.current = false
      currentWallId = null
      event.stopPropagation()
      if (!draftItem.current) return
      const currentLevelId = useViewer.getState().selection.levelId
      draftItem.current.parentId = currentLevelId
      useScene.getState().updateNode(draftItem.current.id, {
        position: [gridPosition.current.x, gridPosition.current.y, gridPosition.current.z],
        parentId: currentLevelId,
      })
      checkCanPlace()
    }

    const onWallClick = (event: WallEvent) => {
      if (!isOnWall.current) return

      // Ignore top face and thickness edges
      if (!isValidWallSideFace(event.normal)) return

      event.stopPropagation()

      const currentLevelId = useViewer.getState().selection.levelId
      if (!currentLevelId || !draftItem.current || !checkCanPlace()) return

      // Get side and rotation from current draft item (already set by onWallMove)
      const side = draftItem.current.side
      const rotation = draftItem.current.rotation

      useScene.temporal.getState().resume()
      useScene.getState().updateNode(draftItem.current.id, {
        position: [gridPosition.current.x, gridPosition.current.y, gridPosition.current.z],
        parentId: event.node.id,
        side,
        rotation,
        metadata: stripTransient(draftItem.current.metadata),
      })
      useScene.getState().dirtyNodes.add(event.node.id)
      draftItem.current = null

      useScene.temporal.getState().pause()
      createDraftItem()
      checkCanPlace()
    }

    const onWallMove = (event: WallEvent) => {
      if (isOnWall.current === false) return
      if (!draftItem.current) return

      // Ignore top face and thickness edges
      if (!isValidWallSideFace(event.normal)) return

      event.stopPropagation()

      // Determine side and rotation from normal
      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      gridPosition.current.set(
        Math.round(event.localPosition[0] * 2) / 2,
        Math.round(event.localPosition[1] * 2) / 2,
        Math.round(event.localPosition[2] * 2) / 2,
      )
      cursorRef.current.position.set(
        Math.round(event.position[0] * 2) / 2,
        Math.round(event.position[1] * 2) / 2,
        Math.round(event.position[2] * 2) / 2,
      )
      cursorRef.current.rotation.y = cursorRotation

      // Update draft item side and rotation
      draftItem.current.side = side
      draftItem.current.rotation = [0, itemRotation, 0]

      const canPlace = checkCanPlace()
      if (draftItem.current && canPlace) {
        draftItem.current.position = [
          gridPosition.current.x,
          gridPosition.current.y,
          gridPosition.current.z,
        ]
        const draftItemMesh = sceneRegistry.nodes.get(draftItem.current.id)
        if (draftItemMesh) {
          draftItemMesh.position.copy(gridPosition.current)
          draftItemMesh.rotation.y = itemRotation
        }

        useScene.getState().updateNode(draftItem.current.id, {
          side,
          rotation: [0, itemRotation, 0],
        })
        useScene.getState().dirtyNodes.add(event.node.id)
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('wall:enter', onWallEnter)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)

    // Keyboard rotation handlers
    const ROTATION_STEP = Math.PI / 2 // 90 degrees
    const onKeyDown = (event: KeyboardEvent) => {
      if (!draftItem.current) return

      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') {
        rotationDelta = ROTATION_STEP // Counter-clockwise
      } else if (event.key === 't' || event.key === 'T') {
        rotationDelta = -ROTATION_STEP // Clockwise
      }

      if (rotationDelta !== 0) {
        event.preventDefault()
        const currentRotation = draftItem.current.rotation
        const newRotationY = (currentRotation[1] ?? 0) + rotationDelta
        draftItem.current.rotation = [currentRotation[0], newRotationY, currentRotation[2]]

        useScene.getState().updateNode(draftItem.current.id, {
          rotation: draftItem.current.rotation,
        })

        // Update cursor rotation to match
        cursorRef.current.rotation.y = newRotationY

        checkCanPlace()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const setupBoundingBox = () => {
      const boxGeometry = new BoxGeometry(
        selectedItem.dimensions[0],
        selectedItem.dimensions[1],
        selectedItem.dimensions[2],
      )
      boxGeometry.translate(0, selectedItem.dimensions[1] / 2, 0)
      cursorRef.current.geometry = boxGeometry
    }
    setupBoundingBox()

    return () => {
      if (draftItem.current) {
        useScene.getState().deleteNode(draftItem.current.id)
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:move', onWallMove)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedItem, canPlaceOnFloor, canPlaceOnWall])

  useFrame((_, delta) => {
    if (draftItem.current && !isOnWall.current) {
      const draftItemMesh = sceneRegistry.nodes.get(draftItem.current.id)
      if (draftItemMesh) {
        draftItemMesh.position.lerp(gridPosition.current, delta * 20)
      }
    }
  })

  return (
    <group>
      <mesh ref={cursorRef}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color="red" wireframe />
      </mesh>
    </group>
  )
}
