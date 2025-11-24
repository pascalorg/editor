import type { ThreeMouseEvent } from '@pmndrs/uikit/dist/events'
import { Billboard, Edges } from '@react-three/drei'
import { Container } from '@react-three/uikit'
import { Badge, Button, Card } from '@react-three/uikit-default'
import { Move, RotateCcw, RotateCw, Trash2 } from '@react-three/uikit-lucide'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { emitter, type GridEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'

interface SelectionBoxProps {
  group: React.RefObject<THREE.Group | null>
}

interface MoveState {
  isMoving: boolean
  originalData: Map<
    string,
    {
      position: [number, number]
      rotation: number
      wasPreview: boolean
    }
  >
  cleanupFunctions: Array<() => void>
  initialGridPosition: [number, number] | null
}

export function SelectionBox({ group }: SelectionBoxProps) {
  const [size, setSize] = useState<THREE.Vector3 | null>(null)
  const [center, setCenter] = useState<THREE.Vector3 | null>(null)
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

  useEffect(() => {
    if (!group.current) return

    const updateBounds = () => {
      const innerGroup = group.current!

      // Force update of world matrices to ensure accurate calculation
      innerGroup.updateMatrixWorld(true)

      // Calculate bounding box in local space by manually computing it
      const box = new THREE.Box3()
      let hasContent = false

      innerGroup.traverse((child) => {
        if (child === innerGroup) return

        // For meshes with geometry
        if (child instanceof THREE.Mesh && child.geometry) {
          const geometry = child.geometry

          if (!geometry.boundingBox) {
            geometry.computeBoundingBox()
          }

          if (geometry.boundingBox) {
            hasContent = true
            // Get the geometry bounds in local space
            const localBox = geometry.boundingBox.clone()

            // Transform by the mesh's matrix (relative to inner group)
            // We need the transform from inner group to this child
            const relativeMatrix = new THREE.Matrix4()
            relativeMatrix.copy(child.matrix)

            // If child has a parent chain within innerGroup, accumulate their matrices
            let current = child.parent
            while (current && current !== innerGroup) {
              relativeMatrix.premultiply(current.matrix)
              current = current.parent
            }

            localBox.applyMatrix4(relativeMatrix)
            box.union(localBox)
          }
        }
      })

      if (!hasContent || box.isEmpty()) return

      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      setSize(size)
      setCenter(center)
    }

    updateBounds()
  }, [group])

  const handleDelete = useCallback((e: ThreeMouseEvent) => {
    e.stopPropagation?.()
    const selectedNodeIds = useEditor.getState().selectedNodeIds
    useEditor.getState().deleteNodes(selectedNodeIds)
  }, [])

  const handleMove = useCallback((e: ThreeMouseEvent) => {
    e.stopPropagation?.()
    const { selectedNodeIds, graph, updateNode } = useEditor.getState()
    const moveState = moveStateRef.current

    // If already moving, cancel move mode
    if (moveState.isMoving) {
      // Restore original positions and preview states
      moveState.originalData.forEach((data, nodeId) => {
        updateNode(nodeId, {
          position: data.position,
          rotation: data.rotation,
          editor: { preview: data.wasPreview },
        })
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

      // Save original state
      moveState.originalData.set(nodeId, {
        position: [...node.position] as [number, number],
        rotation: node.rotation || 0,
        wasPreview: node.editor?.preview,
      })

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

        updateNode(nodeId, {
          position: [original.position[0] + finalDeltaX, original.position[1] + finalDeltaY] as [
            number,
            number,
          ],
        })
      }
    }

    // Handle grid click to commit
    const handleGridClick = () => {
      const { commandManager, graph, updateNode } = useEditor.getState()

      // Commit changes: restore preview states but keep new positions
      moveState.originalData.forEach((data, nodeId) => {
        const handle = graph.getNodeById(nodeId as any)
        if (!handle) return

        const currentNode = handle.data() as any
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
          updateNode(nodeId, {
            position: data.position,
            rotation: data.rotation,
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

  if (!(size && center)) return null

  const controlPanelY = center.y + size.y / 2 + 0.5 // Position above the box

  return (
    <group>
      {/* Selection Box */}
      <mesh position={center}>
        <boxGeometry args={[size.x, size.y, size.z]} />
        <meshBasicMaterial opacity={0} transparent />
        <Edges color="#00ff00" dashSize={0.1} depthTest={false} gapSize={0.05} linewidth={2} />
      </mesh>

      {/* Control Panel using uikit - hidden when moving */}
      {!isMoving && (
        <group position={[center.x, controlPanelY, center.z]}>
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
              pixelSize={0.01}
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
