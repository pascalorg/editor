'use client'

import { Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { Intersection, Object3D } from 'three'
import { Box3, Raycaster, Vector2 } from 'three'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { Collection } from '@/lib/scenegraph/schema/collections'

/**
 * Generate edge line points for a box
 */
function getBoxEdgePoints(box: Box3): [number, number, number][] {
  const min = box.min
  const max = box.max

  return [
    // Bottom face edges
    [min.x, min.y, min.z],
    [max.x, min.y, min.z],
    [max.x, min.y, min.z],
    [max.x, min.y, max.z],
    [max.x, min.y, max.z],
    [min.x, min.y, max.z],
    [min.x, min.y, max.z],
    [min.x, min.y, min.z],
    // Top face edges
    [min.x, max.y, min.z],
    [max.x, max.y, min.z],
    [max.x, max.y, min.z],
    [max.x, max.y, max.z],
    [max.x, max.y, max.z],
    [min.x, max.y, max.z],
    [min.x, max.y, max.z],
    [min.x, max.y, min.z],
    // Vertical edges
    [min.x, min.y, min.z],
    [min.x, max.y, min.z],
    [max.x, min.y, min.z],
    [max.x, max.y, min.z],
    [max.x, min.y, max.z],
    [max.x, max.y, max.z],
    [min.x, min.y, max.z],
    [min.x, max.y, max.z],
  ]
}

interface HighlightBoxProps {
  box: Box3
  color: string
}

function HighlightBox({ box, color }: HighlightBoxProps) {
  const points = useMemo(() => getBoxEdgePoints(box), [box])

  return (
    <Line
      color={color}
      depthTest={false}
      depthWrite={false}
      lineWidth={2}
      points={points}
      renderOrder={998}
      segments
      transparent
    />
  )
}

/**
 * LevelHoverManager - handles hover detection and click-to-select for:
 * 1. Levels (when no floor is selected) - blue highlight, click to select level
 * 2. Room collections (when floor selected, no room/nodes selected) - amber highlight, click to select + zoom
 * 3. Individual nodes (when room selected) - green highlight
 *    - Click without modifier: selects node, enters node selection mode
 *    - Shift/ctrl/cmd+click: adds node to selection
 * 4. Node selection mode (nodes already selected) - green highlight
 *    - Click without modifier: selects the room containing that node + zooms (exits node mode)
 *    - Shift/ctrl/cmd+click: adds/toggles node in selection
 */
export function LevelHoverManager() {
  const { scene, camera, gl } = useThree()
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedCollectionId = useEditor((state) => state.selectedCollectionId)

  const [hoveredBox, setHoveredBox] = useState<Box3 | null>(null)
  const [hoverMode, setHoverMode] = useState<'level' | 'room' | 'node' | null>(null)

  const raycasterRef = useRef(new Raycaster())

  // Get all level IDs from the scene
  const levelIds = useEditor(
    useShallow((state: StoreState) => {
      const building = state.scene.root.children?.[0]?.children.find(
        (c) => c.type === 'building',
      )
      if (!building) return []
      return building.children.filter((c) => c.type === 'level').map((l) => l.id)
    }),
  )

  // Get room collections for the current level
  const roomCollections = useEditor(
    useShallow((state: StoreState) => {
      if (!state.selectedFloorId) return []
      return (state.scene.collections || []).filter(
        (c) => c.type === 'room' && c.levelId === state.selectedFloorId,
      )
    }),
  )

  // Get the node IDs in the selected collection
  const selectedCollectionNodeIds = useEditor(
    useShallow((state: StoreState) => {
      if (!state.selectedCollectionId) return []
      const collection = (state.scene.collections || []).find(
        (c) => c.id === state.selectedCollectionId,
      )
      return collection?.nodeIds || []
    }),
  )

  // Helper: find which room collection contains a hit node
  const findRoomForNode = (nodeId: string, collections: Collection[]): Collection | null => {
    for (const collection of collections) {
      if (collection.nodeIds.includes(nodeId)) {
        return collection
      }
    }
    return null
  }

  // Helper: calculate bounding box for a room collection
  const calculateRoomBounds = (collection: Collection): Box3 | null => {
    const combinedBox = new Box3()
    for (const nodeId of collection.nodeIds) {
      const object = scene.getObjectByName(nodeId)
      if (object) {
        const objectBox = new Box3().setFromObject(object)
        combinedBox.union(objectBox)
      }
    }
    return combinedBox.isEmpty() ? null : combinedBox
  }

  // Helper: get nodeId from intersection
  const getNodeIdFromIntersection = (object: Object3D): string | null => {
    let current: Object3D | null = object
    while (current) {
      if (current.userData?.nodeId) {
        return current.userData.nodeId
      }
      current = current.parent
    }
    return null
  }

  // Helper: check if a nodeId is a "background" element that shouldn't block selection
  const isBackgroundElement = (nodeId: string): boolean => {
    return (
      nodeId.startsWith('level_') ||
      nodeId.startsWith('ceiling_') ||
      nodeId.startsWith('slab_')
    )
  }

  // Helper: get the first selectable node from intersections (skipping background elements)
  const getSelectableNodeFromIntersections = (
    intersects: Intersection[],
  ): string | null => {
    for (const hit of intersects) {
      const nodeId = getNodeIdFromIntersection(hit.object)
      if (nodeId && !isBackgroundElement(nodeId)) {
        return nodeId
      }
    }
    return null
  }

  // Set up event listeners
  useEffect(() => {
    const canvas = gl.domElement

    const onPointerMove = (event: PointerEvent) => {
      const state = useEditor.getState()
      const currentFloorId = state.selectedFloorId
      const currentCollectionId = state.selectedCollectionId

      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(new Vector2(x, y), camera)

      // MODE 1: No floor selected - hover over levels
      if (!currentFloorId) {
        let foundLevelId: string | null = null
        for (const levelId of levelIds) {
          const levelObject = scene.getObjectByName(levelId)
          if (levelObject) {
            const intersects = raycasterRef.current.intersectObject(levelObject, true)
            if (intersects.length > 0) {
              foundLevelId = levelId
              break
            }
          }
        }

        if (foundLevelId) {
          const levelObject = scene.getObjectByName(foundLevelId)
          if (levelObject) {
            const box = new Box3().setFromObject(levelObject)
            if (!box.isEmpty()) {
              setHoveredBox(box)
              setHoverMode('level')
              return
            }
          }
        }
        setHoveredBox(null)
        setHoverMode(null)
        return
      }

      // MODE 3: Room collection selected - hover over any individual node in the level
      // MODE 4: Individual nodes selected (after clicking from room) - continue node hover mode
      const hasNodeSelection = state.selectedNodeIds.length > 0
      if (currentCollectionId || hasNodeSelection) {
        // Raycast against the current level
        const levelObject = scene.getObjectByName(currentFloorId)
        if (!levelObject) {
          setHoveredBox(null)
          setHoverMode(null)
          return
        }

        const intersects = raycasterRef.current.intersectObject(levelObject, true)
        if (intersects.length === 0) {
          setHoveredBox(null)
          setHoverMode(null)
          return
        }

        // Find the first selectable node (skipping background elements like slabs, ceilings)
        const nodeId = getSelectableNodeFromIntersections(intersects)
        if (nodeId) {
          const nodeObject = scene.getObjectByName(nodeId)
          if (nodeObject) {
            const box = new Box3().setFromObject(nodeObject)
            if (!box.isEmpty()) {
              setHoveredBox(box)
              setHoverMode('node')
              return
            }
          }
        }

        setHoveredBox(null)
        setHoverMode(null)
        return
      }

      // MODE 2: Floor selected - hover over room collections
      // Get current room collections for this level
      const currentRoomCollections = (state.scene.collections || []).filter(
        (c) => c.type === 'room' && c.levelId === currentFloorId,
      )

      if (currentRoomCollections.length === 0) {
        setHoveredBox(null)
        setHoverMode(null)
        return
      }

      // Raycast against the current level
      const levelObject = scene.getObjectByName(currentFloorId)
      if (!levelObject) {
        setHoveredBox(null)
        setHoverMode(null)
        return
      }

      const intersects = raycasterRef.current.intersectObject(levelObject, true)
      if (intersects.length === 0) {
        setHoveredBox(null)
        setHoverMode(null)
        return
      }

      // Find which room collection the hit node belongs to
      for (const hit of intersects) {
        const nodeId = getNodeIdFromIntersection(hit.object)
        if (nodeId) {
          const room = findRoomForNode(nodeId, currentRoomCollections)
          if (room) {
            const box = calculateRoomBounds(room)
            if (box) {
              setHoveredBox(box)
              setHoverMode('room')
              return
            }
          }
        }
      }

      setHoveredBox(null)
      setHoverMode(null)
    }

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return // Only left click

      const state = useEditor.getState()
      const currentFloorId = state.selectedFloorId
      const currentCollectionId = state.selectedCollectionId

      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(new Vector2(x, y), camera)

      // MODE 1: No floor selected - click to select level
      if (!currentFloorId) {
        for (const levelId of levelIds) {
          const levelObject = scene.getObjectByName(levelId)
          if (levelObject) {
            const intersects = raycasterRef.current.intersectObject(levelObject, true)
            if (intersects.length > 0) {
              useEditor.getState().selectFloor(levelId)
              return
            }
          }
        }
        return
      }

      // MODE 3: Room collection selected - click to select any individual node in the level
      // MODE 4: Individual nodes selected - continue node selection mode
      const hasNodeSelection = state.selectedNodeIds.length > 0
      const hasModifierKey = event.shiftKey || event.metaKey || event.ctrlKey
      
      // Check for node selection if we have a collection selected OR any nodes selected
      if (currentCollectionId || hasNodeSelection) {
        // Raycast against the current level
        const levelObject = scene.getObjectByName(currentFloorId)
        if (levelObject) {
          const intersects = raycasterRef.current.intersectObject(levelObject, true)
          if (intersects.length > 0) {
            // Find the first selectable node (skipping background elements like slabs, ceilings)
            const nodeId = getSelectableNodeFromIntersections(intersects)
            
            if (nodeId) {
              if (hasModifierKey) {
                // Shift/Ctrl/Cmd+click: use handleNodeSelect for toggle/add behavior
                const editorState = useEditor.getState()
                if (editorState.selectedCollectionId) {
                  useEditor.setState({ selectedCollectionId: null })
                }
                editorState.handleNodeSelect(nodeId, {
                  shiftKey: event.shiftKey,
                  metaKey: event.metaKey,
                  ctrlKey: event.ctrlKey,
                })
              } else {
                // Click without modifier: select just this node (clear collection and any previous selection)
                useEditor.setState({
                  selectedCollectionId: null,
                  selectedNodeIds: [nodeId],
                })
              }
              return
            }
          }
        }
        
        // If we have a modifier key but didn't hit a node, don't fall through to room selection
        if (hasModifierKey) return
      }

      // MODE 2: Floor selected - click to select room collection
      // Also handles: clicking without modifier in MODE 4 → selects room (zoom + pan)
      // Get current room collections for this level
      const currentRoomCollections = (state.scene.collections || []).filter(
        (c) => c.type === 'room' && c.levelId === currentFloorId,
      )

      if (currentRoomCollections.length === 0) return

      // Raycast against the current level
      const levelObject = scene.getObjectByName(currentFloorId)
      if (!levelObject) return

      const intersects = raycasterRef.current.intersectObject(levelObject, true)
      if (intersects.length === 0) return

      // Find which room collection the hit node belongs to
      for (const hit of intersects) {
        const nodeId = getNodeIdFromIntersection(hit.object)
        if (nodeId) {
          const room = findRoomForNode(nodeId, currentRoomCollections)
          if (room) {
            // Clear any node selection before selecting the room (ensures camera zoom triggers)
            if (state.selectedNodeIds.length > 0) {
              useEditor.setState({ selectedNodeIds: [] })
            }
            useEditor.getState().selectCollection(room.id)
            return
          }
        }
      }

      // If we reached here and have a selection, clear it (clicked empty space)
      if (currentCollectionId || state.selectedNodeIds.length > 0) {
        // Only clear if not holding modifier keys
        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
            useEditor.setState({
                selectedCollectionId: null,
                selectedNodeIds: [],
            })
        }
      }
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('click', onClick)

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('click', onClick)
    }
  }, [camera, gl, scene, levelIds, roomCollections, selectedCollectionNodeIds])

  // Clear hover when selection changes
  useEffect(() => {
    setHoveredBox(null)
    setHoverMode(null)
  }, [selectedFloorId, selectedCollectionId])

  // Don't render anything if nothing is hovered
  if (!hoveredBox || !hoverMode) return null

  // Use different colors for each hover mode
  const colorMap = {
    level: '#3b82f6', // Blue for level
    room: '#f59e0b', // Amber for room
    node: '#22c55e', // Green for individual node
  }
  const color = colorMap[hoverMode]

  return <HighlightBox box={hoveredBox} color={color} />
}
