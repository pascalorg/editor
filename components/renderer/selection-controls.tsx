import type { ThreeMouseEvent } from '@pmndrs/uikit/dist/events'
import { Billboard, Edges } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Container } from '@react-three/uikit'
import { Button } from '@react-three/uikit-default'
import { Move, RotateCcw, RotateCw, Trash2 } from '@react-three/uikit-lucide'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { calculateWallPositionUpdate, isWallNode } from '@/lib/nodes/utils'

interface MoveState {
  isMoving: boolean
  originalData: Map<
    string,
    {
      position: [number, number]
      rotation: number
      wasPreview: boolean
      // Wall-specific data
      start?: [number, number]
      end?: [number, number]
    }
  >
  cleanupFunctions: Array<() => void>
  initialGridPosition: [number, number] | null
}

interface BoundingBoxData {
  size: THREE.Vector3
  center: THREE.Vector3
}

export function SelectionControls() {
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const { scene } = useThree()
  const [isMoving, setIsMoving] = useState(false)
  const moveStateRef = useRef<MoveState>({
    isMoving: false,
    originalData: new Map(),
    cleanupFunctions: [],
    initialGridPosition: null,
  })

  // Cleanup move mode listeners on unmount
  useEffect(
    () => () => {
      const moveState = moveStateRef.current
      if (moveState.isMoving) {
        moveState.cleanupFunctions.forEach((cleanup) => {
          cleanup()
        })
      }
    },
    [],
  )

  // Find selected THREE.Group objects by name (nodeId)
  const selectedGroups = useMemo(() => {
    if (!scene || selectedNodeIds.length === 0) return []
    return selectedNodeIds.map((id) => scene.getObjectByName(id)).filter(Boolean) as THREE.Group[]
  }, [scene, selectedNodeIds])

  // Calculate individual bounding boxes for each selected object
  const individualBounds = useMemo(() => {
    return selectedGroups
      .map((group) => {
        // Force update of world matrices to ensure accurate calculation
        group.updateMatrixWorld(true)

        // Calculate bounding box in local space
        const box = new THREE.Box3()
        let hasContent = false

        group.traverse((child) => {
          if (child === group) return

          // For meshes with geometry
          if (child instanceof THREE.Mesh && child.geometry) {
            const geometry = child.geometry

            if (!geometry.boundingBox) {
              geometry.computeBoundingBox()
            }

            if (geometry.boundingBox) {
              hasContent = true
              const localBox = geometry.boundingBox.clone()

              // Transform by the mesh's matrix (relative to group)
              const relativeMatrix = new THREE.Matrix4()
              relativeMatrix.copy(child.matrix)

              // If child has a parent chain within group, accumulate their matrices
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

        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())

        // Convert center to world space
        const worldCenter = center.clone()
        group.localToWorld(worldCenter)

        return {
          size,
          center: worldCenter,
        }
      })
      .filter(Boolean) as BoundingBoxData[]
  }, [selectedGroups])

  // Calculate combined bounding box for all selected objects
  const combinedBounds = useMemo((): BoundingBoxData | null => {
    if (individualBounds.length === 0) return null

    const combinedBox = new THREE.Box3()
    individualBounds.forEach((bounds) => {
      const { size, center } = bounds
      const min = new THREE.Vector3(
        center.x - size.x / 2,
        center.y - size.y / 2,
        center.z - size.z / 2,
      )
      const max = new THREE.Vector3(
        center.x + size.x / 2,
        center.y + size.y / 2,
        center.z + size.z / 2,
      )
      combinedBox.expandByPoint(min)
      combinedBox.expandByPoint(max)
    })

    const size = combinedBox.getSize(new THREE.Vector3())
    const center = combinedBox.getCenter(new THREE.Vector3())

    return { size, center }
  }, [individualBounds])

  const handleDelete = useCallback(
    (e: ThreeMouseEvent) => {
      e.stopPropagation?.()
      const selectedNodeIds = useEditor.getState().selectedNodeIds
      useEditor.getState().deleteNodes(selectedNodeIds)
    },
    [],
  )

  const handleMove = useCallback((e: ThreeMouseEvent) => {
    e.stopPropagation?.()
    const { selectedNodeIds, graph, updateNode } = useEditor.getState()
    const moveState = moveStateRef.current

    // If already moving, cancel move mode
    if (moveState.isMoving) {
      // Restore original positions and preview states
      moveState.originalData.forEach((data, nodeId) => {
        const updates: any = {
          position: data.position,
          rotation: data.rotation,
          editor: { preview: data.wasPreview },
        }
        // Restore wall-specific data if present
        if (data.start && data.end) {
          updates.start = data.start
          updates.end = data.end
        }
        updateNode(nodeId, updates)
      })

      // Cleanup listeners
      moveState.cleanupFunctions.forEach((cleanup) => {
        cleanup()
      })
      moveState.isMoving = false
      moveState.originalData.clear()
      moveState.cleanupFunctions = []
      moveState.initialGridPosition = null
      setIsMoving(false)
      return
    }

    // Enter move mode
    moveState.isMoving = true
    moveState.originalData.clear()
    moveState.initialGridPosition = null
    setIsMoving(true)

    // Save original data and convert to preview
    for (const nodeId of selectedNodeIds) {
      const handle = graph.getNodeById(nodeId as any)
      if (!handle) continue

      const node = handle.data() as any
      if (!node) continue

      // Save original state (including wall-specific data if applicable)
      const originalData: MoveState['originalData'] extends Map<string, infer T> ? T : never = {
        position: [...node.position] as [number, number],
        rotation: node.rotation || 0,
        wasPreview: node.editor?.preview,
      }

      // Save wall-specific data if this is a wall
      if (isWallNode(node)) {
        originalData.start = [...node.start] as [number, number]
        originalData.end = [...node.end] as [number, number]
      }

      moveState.originalData.set(nodeId, originalData)

      // Convert to preview
      updateNode(nodeId, {
        editor: { preview: true },
      })
    }

    // Handle grid move to update positions
    const handleGridMove = (e: GridEvent) => {
      const [x, y] = e.position

      // Set initial grid position on first move
      if (!moveState.initialGridPosition) {
        moveState.initialGridPosition = [x, y]
        return // Don't move on first event, just record position
      }

      // Calculate relative offset from initial grid position
      const deltaX = x - moveState.initialGridPosition[0]
      const deltaY = y - moveState.initialGridPosition[1]

      // Update all selected nodes with the relative offset
      const { updateNode, graph } = useEditor.getState()
      for (const nodeId of selectedNodeIds) {
        const original = moveState.originalData.get(nodeId)
        if (!original) continue

        const handle = graph.getNodeById(nodeId as any)
        if (!handle) continue

        const node = handle.data() as any
        let finalDeltaX = deltaX
        let finalDeltaY = deltaY

        // Check if node has a parent with rotation
        if (node.parentId) {
          const parentHandle = graph.getNodeById(node.parentId as any)
          if (parentHandle) {
            const parent = parentHandle.data() as any
            const parentRotation = parent.rotation || 0

            // Transform world delta to parent's local space
            const cos = Math.cos(parentRotation)
            const sin = Math.sin(parentRotation)
            finalDeltaX = deltaX * cos - deltaY * sin
            finalDeltaY = deltaX * sin + deltaY * cos
          }
        }

        const newPosition: [number, number] = [
          original.position[0] + finalDeltaX,
          original.position[1] + finalDeltaY,
        ]

        // If this is a wall, also update start/end coordinates
        if (isWallNode(node) && original.start && original.end) {
          const wallUpdate = calculateWallPositionUpdate(
            original.position,
            newPosition,
            original.start,
            original.end,
          )
          updateNode(nodeId, wallUpdate)
        } else {
          updateNode(nodeId, {
            position: newPosition,
          })
        }
      }
    }

    // Handle grid click to commit
    const handleGridClick = () => {
      const { updateNode } = useEditor.getState()

      // Commit changes: restore preview states but keep new positions
      moveState.originalData.forEach((data, nodeId) => {
        updateNode(nodeId, {
          editor: { preview: data.wasPreview },
        })
      })

      // Cleanup
      moveState.cleanupFunctions.forEach((cleanup) => {
        cleanup()
      })
      moveState.isMoving = false
      moveState.originalData.clear()
      moveState.cleanupFunctions = []
      moveState.initialGridPosition = null
      setIsMoving(false)
    }

    // Handle ESC to cancel
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation() // Prevent global keyboard handler from running

        // Restore original positions and states
        moveState.originalData.forEach((data, nodeId) => {
          const updates: any = {
            position: data.position,
            rotation: data.rotation,
            editor: { preview: data.wasPreview },
          }
          // Restore wall-specific data if present
          if (data.start && data.end) {
            updates.start = data.start
            updates.end = data.end
          }
          updateNode(nodeId, updates)
        })

        // Cleanup
        moveState.cleanupFunctions.forEach((cleanup) => {
          cleanup()
        })
        moveState.isMoving = false
        moveState.originalData.clear()
        moveState.cleanupFunctions = []
        moveState.initialGridPosition = null
        setIsMoving(false)
      }
    }

    // Register listeners
    emitter.on('grid:move', handleGridMove)
    emitter.on('grid:click', handleGridClick)
    // Use capture phase to run before global keyboard handler
    window.addEventListener('keydown', handleKeyDown, { capture: true })

    // Store cleanup functions
    moveState.cleanupFunctions = [
      () => emitter.off('grid:move', handleGridMove),
      () => emitter.off('grid:click', handleGridClick),
      () => window.removeEventListener('keydown', handleKeyDown, { capture: true }),
    ]
  }, [])

  const handleRotateCW = useCallback((e: ThreeMouseEvent) => {
    e.stopPropagation?.()
    const { selectedNodeIds, graph, updateNode } = useEditor.getState()

    // Rotate by -45 degrees (-Math.PI / 4) for clockwise rotation
    const angle = -Math.PI / 4

    for (const nodeId of selectedNodeIds) {
      const handle = graph.getNodeById(nodeId as any)
      if (!handle) continue

      const node = handle.data() as any
      if (!(node && 'rotation' in node)) continue

      // Just update rotation, no position changes
      updateNode(nodeId, {
        rotation: node.rotation + angle,
      })
    }
  }, [])

  const handleRotateCCW = useCallback((e: ThreeMouseEvent) => {
    e.stopPropagation?.()
    const { selectedNodeIds, graph, updateNode } = useEditor.getState()

    // Rotate by 45 degrees (Math.PI / 4) for counter-clockwise rotation
    const angle = Math.PI / 4

    for (const nodeId of selectedNodeIds) {
      const handle = graph.getNodeById(nodeId as any)
      if (!handle) continue

      const node = handle.data() as any
      if (!(node && 'rotation' in node)) continue

      // Just update rotation, no position changes
      updateNode(nodeId, {
        rotation: node.rotation + angle,
      })
    }
  }, [])

  const controlPanelRef = useRef<THREE.Group>(null)
  const { camera } = useThree()

  // Scale control panel based on camera distance to maintain consistent visual size
  useFrame(() => {
    if (controlPanelRef.current && combinedBounds) {
      // Calculate distance from camera to the selection center
      const distance = camera.position.distanceTo(
        new THREE.Vector3(combinedBounds.center.x, combinedBounds.center.y, combinedBounds.center.z),
      )
      // Use distance to calculate appropriate scale
      const scale = distance * 0.12 // Adjust multiplier for desired size
      const finalScale = Math.min(Math.max(scale, 0.5), 2) // Clamp between 0.5 and 2
      controlPanelRef.current.scale.setScalar(finalScale)
    }
  })

  // Don't render anything if nothing is selected
  if (selectedNodeIds.length === 0 || !combinedBounds) return null

  const controlPanelY = combinedBounds.center.y + combinedBounds.size.y / 2 + 0.5 // Position above the box

  return (
    <group>
      {/* Individual bounding boxes for each selected item */}
      {individualBounds.map((bounds, i) => (
        <mesh key={i} position={bounds.center}>
          <boxGeometry args={[bounds.size.x, bounds.size.y, bounds.size.z]} />
          <meshBasicMaterial opacity={0} transparent />
          <Edges color="#00ff00" dashSize={0.1} depthTest={false} gapSize={0.05} linewidth={2} />
        </mesh>
      ))}

      {/* Combined bounding box (only if multiple items selected) */}
      {selectedNodeIds.length > 1 && (
        <mesh position={combinedBounds.center}>
          <boxGeometry args={[combinedBounds.size.x, combinedBounds.size.y, combinedBounds.size.z]} />
          <meshBasicMaterial opacity={0} transparent />
          <Edges color="#ffff00" dashSize={0.1} depthTest={false} gapSize={0.05} linewidth={2} />
        </mesh>
      )}

      {/* Control Panel - positioned at combined bounds center, hidden when moving */}
      {!isMoving && (
        <group
          position={[combinedBounds.center.x, controlPanelY, combinedBounds.center.z]}
          ref={controlPanelRef}
        >
          <Billboard>
            <Container
              alignItems="center"
              backgroundColor={'#21222a'}
              borderRadius={16}
              depthTest={false}
              flexDirection="row"
              gap={8}
              justifyContent="space-between"
              opacity={0.5}
              paddingX={16}
              paddingY={8}
            >
              {/* Rotate Left Button */}
              <Button
                backgroundColor={'#21222a'}
                hover={{
                  backgroundColor: '#111',
                }}
                onClick={handleRotateCCW}
                size="icon"
              >
                <RotateCcw height={16} width={16} />
              </Button>
              {/* Move Button */}
              <Button
                backgroundColor={'#21222a'}
                hover={{
                  backgroundColor: '#111',
                }}
                onClick={handleMove}
                size="icon"
              >
                <Move height={16} width={16} />
              </Button>
              {/* Delete Button */}
              <Button
                backgroundColor={'#21222a'}
                hover={{
                  backgroundColor: '#111',
                }}
                onClick={handleDelete}
                size="icon"
              >
                <Trash2 height={16} width={16} />
              </Button>
              {/* Rotate Right Button */}
              <Button
                backgroundColor={'#21222a'}
                hover={{
                  backgroundColor: '#111',
                }}
                onClick={handleRotateCW}
                size="icon"
              >
                <RotateCw height={16} width={16} />
              </Button>
            </Container>
          </Billboard>
        </group>
      )}
    </group>
  )
}
