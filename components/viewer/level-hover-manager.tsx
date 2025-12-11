'use client'

import { Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Intersection, Object3D } from 'three'
import { Box3, Mesh, Raycaster, Vector2 } from 'three'
import { useShallow } from 'zustand/shallow'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { Collection } from '@/lib/scenegraph/schema/collections'
import type { LevelNode } from '@/lib/scenegraph/schema/nodes/level'

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
 * 1. Levels (when no floor is selected OR clicking on a level to switch) - blue highlight, click to select level
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
  const [hoverMode, setHoverMode] = useState<'level' | 'room' | 'node' | 'building' | null>(null)

  const raycasterRef = useRef(new Raycaster())
  const isDrag = useRef(false)
  const downPos = useRef({ x: 0, y: 0 })

  // Get building ID
  const buildingId = useEditor(
    useShallow((state: StoreState) => {
      const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
      return building?.id
    }),
  )

  // Get all level IDs from the scene
  const levelIds = useEditor(
    useShallow((state: StoreState) => {
      const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
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

  // Helper: calculate bounding box for an object excluding image nodes
  const calculateBoundsExcludingImages = (object: Object3D): Box3 | null => {
    const box = new Box3()
    const graph = useEditor.getState().graph
    let hasContent = false

    object.traverse((child) => {
      if (child instanceof Mesh && child.geometry) {
        // Check if this mesh belongs to an image node
        let current: Object3D | null = child
        let isImage = false
        while (current && current !== object) {
          if (current.userData?.nodeId) {
            const node = graph.getNodeById(current.userData.nodeId as any)?.data()
            if (node?.type === 'reference-image') {
              isImage = true
              break
            }
          }
          current = current.parent
        }

        if (isImage) return

        const childBox = new Box3().setFromObject(child)
        if (!childBox.isEmpty()) {
          box.union(childBox)
          hasContent = true
        }
      }
    })

    return hasContent ? box : null
  }

  // Helper: calculate bounding box for a room collection
  const calculateRoomBounds = (collection: Collection): Box3 | null => {
    const combinedBox = new Box3()
    const graph = useEditor.getState().graph

    for (const nodeId of collection.nodeIds) {
      // Skip image nodes
      const node = graph.getNodeById(nodeId as any)?.data()
      if (node?.type === 'reference-image') continue

      const object = scene.getObjectByName(nodeId)
      if (object) {
        // Use setFromObject but we should really filter children too if room contains images
        // Assuming room collection nodes are top-level and we checked type above.
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
  const isBackgroundElement = (nodeId: string): boolean =>
    nodeId.startsWith('level_') || nodeId.startsWith('ceiling_') || nodeId.startsWith('slab_')

  // Helper: get the first selectable node from intersections (skipping background elements)
  const getSelectableNodeFromIntersections = (intersects: Intersection[]): string | null => {
    for (const hit of intersects) {
      const nodeId = getNodeIdFromIntersection(hit.object)
      if (nodeId && !isBackgroundElement(nodeId)) {
        // Skip image nodes
        const graph = useEditor.getState().graph
        const node = graph.getNodeById(nodeId as any)?.data()
        if (node?.type === 'reference-image') continue

        return nodeId
      }
    }
    return null
  }

  // Set up event listeners
  useEffect(() => {
    const canvas = gl.domElement

    const onPointerDown = (event: PointerEvent) => {
      isDrag.current = false
      downPos.current = { x: event.clientX, y: event.clientY }
    }

    const onPointerMove = (event: PointerEvent) => {
      const state = useEditor.getState()
      const currentFloorId = state.selectedFloorId
      const currentCollectionId = state.selectedCollectionId
      const isBuildingSelected = buildingId ? state.selectedNodeIds.includes(buildingId) : false

      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(new Vector2(x, y), camera)

      // MODE 0: Building Selection (Top priority if building not selected)
      if (buildingId && !isBuildingSelected) {
        const buildingObject = scene.getObjectByName(buildingId)
        if (buildingObject) {
          const intersects = raycasterRef.current.intersectObject(buildingObject, true)
          if (intersects.length > 0) {
            // Hit building
            const box = calculateBoundsExcludingImages(buildingObject)
            if (box && !box.isEmpty()) {
              setHoveredBox(box)
              setHoverMode('building')
              return
            }
          }
        }
        setHoveredBox(null)
        setHoverMode(null)
        return
      }

      // MODE 1: No floor selected - hover over levels
      // ALSO CHECK: If floor selected, but we hover over OTHER visible levels
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
            // Use custom bounds calculation to exclude images
            const box = calculateBoundsExcludingImages(levelObject)
            if (box && !box.isEmpty()) {
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

      // Check interactions on the current floor first
      const levelObject = scene.getObjectByName(currentFloorId)

      // If the current floor object exists, check for node/room interactions
      if (levelObject) {
        // MODE 3: Room collection selected - hover over any individual node in the level
        // MODE 4: Individual nodes selected (after clicking from room) - continue node hover mode
        // Note: Exclude building ID from "node selection" check so we don't block room hover
        const hasNodeSelection =
          state.selectedNodeIds.length > 0 && !state.selectedNodeIds.includes(buildingId!)

        if (currentCollectionId || hasNodeSelection) {
          const intersects = raycasterRef.current.intersectObject(levelObject, true)

          if (intersects.length > 0) {
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
          }
          // Fall through if no node hit
        } else {
          // MODE 2: Floor selected - hover over room collections
          // Get current room collections for this level
          const currentRoomCollections = (state.scene.collections || []).filter(
            (c) => c.type === 'room' && c.levelId === currentFloorId,
          )

          if (currentRoomCollections.length > 0) {
            const intersects = raycasterRef.current.intersectObject(levelObject, true)

            if (intersects.length > 0) {
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
            }
          }
        }
      }

      // If we didn't hit any interactive elements on the current floor,
      // check if we are hovering over OTHER visible levels (to allow switching)
      for (const levelId of levelIds) {
        // Skip current floor as we already checked logic above
        if (currentFloorId && levelId === currentFloorId) continue

        const otherLevelObject = scene.getObjectByName(levelId)
        if (otherLevelObject) {
          const intersects = raycasterRef.current.intersectObject(otherLevelObject, true)
          if (intersects.length > 0) {
            // Found another level
            const box = calculateBoundsExcludingImages(otherLevelObject)
            if (box && !box.isEmpty()) {
              setHoveredBox(box)
              setHoverMode('level')
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

      // Check for drag
      const dist = Math.hypot(event.clientX - downPos.current.x, event.clientY - downPos.current.y)
      if (dist > 5) return // Ignore drags (panning)

      const state = useEditor.getState()
      const currentFloorId = state.selectedFloorId
      const currentCollectionId = state.selectedCollectionId
      const isBuildingSelected = buildingId ? state.selectedNodeIds.includes(buildingId) : false

      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(new Vector2(x, y), camera)

      // Handle Building Click (Top priority if building not selected)
      if (buildingId && !isBuildingSelected) {
        const buildingObject = scene.getObjectByName(buildingId)
        if (buildingObject) {
          const intersects = raycasterRef.current.intersectObject(buildingObject, true)
          if (intersects.length > 0) {
            useEditor.setState({
              selectedNodeIds: [buildingId],
              levelMode: 'exploded',
              viewMode: 'full',
            })
            return
          }
        }
        // Clicked outside building when building not selected
        return
      }

      // If building IS selected, allow selecting levels/nodes
      if (isBuildingSelected) {
        // Logic for interactions on the CURRENT selected floor
        if (currentFloorId) {
          const levelObject = scene.getObjectByName(currentFloorId)
          if (levelObject) {
            // Check if we hit the current floor (to validate node/room clicks)
            const intersects = raycasterRef.current.intersectObject(levelObject, true)

            if (intersects.length > 0) {
              // MODE 3/4: Node selection
              const hasNodeSelection =
                state.selectedNodeIds.length > 0 && !state.selectedNodeIds.includes(buildingId!)
              const hasModifierKey = event.shiftKey || event.metaKey || event.ctrlKey

              if (currentCollectionId || hasNodeSelection) {
                const nodeId = getSelectableNodeFromIntersections(intersects)

                if (nodeId) {
                  // Check if we should preserve the current collection selection
                  let preserveCollection = false
                  if (currentCollectionId && !hasModifierKey) {
                    const currentCollection = roomCollections.find(
                      (c) => c.id === currentCollectionId,
                    )
                    if (currentCollection) {
                      const bounds = calculateRoomBounds(currentCollection)
                      // Find the exact hit point for this node
                      const hit = intersects.find(
                        (h) => getNodeIdFromIntersection(h.object) === nodeId,
                      )
                      if (bounds && hit && bounds.containsPoint(hit.point)) {
                        preserveCollection = true
                      }
                    }
                  }

                  // Node selection logic...
                  if (hasModifierKey) {
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
                    useEditor.setState({
                      selectedCollectionId: preserveCollection ? currentCollectionId : null,
                      selectedNodeIds: [nodeId],
                    })
                  }
                  return // Handled node click
                }

                if (hasModifierKey) return // Don't fall through
              }

              // MODE 2: Room selection
              const currentRoomCollections = (state.scene.collections || []).filter(
                (c) => c.type === 'room' && c.levelId === currentFloorId,
              )

              if (currentRoomCollections.length > 0) {
                for (const hit of intersects) {
                  const nodeId = getNodeIdFromIntersection(hit.object)
                  if (nodeId) {
                    const room = findRoomForNode(nodeId, currentRoomCollections)
                    if (room) {
                      // Match Menu behavior: just select the collection.
                      // Store handles clearing node selection/switching floor if needed.
                      useEditor.getState().selectCollection(room.id)
                      return // Handled room click
                    }
                  }
                }
              }
            }
          }
        }

        // Global Level Check: Did we click ANY level?
        let clickedLevelId: string | null = null
        let clickedLevelDistance = Number.POSITIVE_INFINITY

        for (const levelId of levelIds) {
          const levelObject = scene.getObjectByName(levelId)
          if (levelObject) {
            const intersects = raycasterRef.current.intersectObject(levelObject, true)
            if (intersects.length > 0 && intersects[0].distance < clickedLevelDistance) {
              clickedLevelDistance = intersects[0].distance
              clickedLevelId = levelId
            }
          }
        }

        // If we haven't handled a node/room click:
        // Check if we clicked a level (either the current one background, or another one)
        if (clickedLevelId) {
          // Match Menu behavior:
          // 1. Clear collection/node selection if present (clicking empty floor area)
          let handled = false
          if (state.selectedCollectionId) {
            useEditor.getState().selectCollection(null)
            handled = true
          }
          if (state.selectedNodeIds.length > 0 && !state.selectedNodeIds.includes(buildingId!)) {
            useEditor.setState({ selectedNodeIds: [] })
            handled = true
          }

          // If we cleared a selection, stop here (progressive unselection)
          if (handled) return

          // 2. Toggle floor selection (if clicking same floor, unselect)
          // Note: Drag check at start of onClick ensures this doesn't trigger on pan
          if (state.selectedFloorId === clickedLevelId) {
            useEditor.getState().selectFloor(null)
            // Restore building selection
            useEditor.setState({ selectedNodeIds: [buildingId!] })
          } else {
            useEditor.getState().selectFloor(clickedLevelId)
          }
          return
        }
      }

      // Clicked on empty space (no level hit) - progressive unselection?
      // User requirement: "click outside of the building ... defaults back to stacked"
      // This implies a full reset when clicking void.
      if (state.selectedNodeIds.length > 0 || state.selectedCollectionId || state.selectedFloorId) {
        useEditor.setState({
          selectedNodeIds: [],
          selectedCollectionId: null,
          selectedFloorId: null,
          levelMode: 'stacked',
          viewMode: 'full',
        })
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('click', onClick)

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
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
  if (!(hoveredBox && hoverMode)) return null

  // Use different colors for each hover mode
  const colorMap = {
    level: '#3b82f6', // Blue for level
    room: '#f59e0b', // Amber for room
    node: '#22c55e', // Green for individual node
    building: '#ffffff', // White for building
  }
  const color = colorMap[hoverMode]

  return <HighlightBox box={hoveredBox} color={color} />
}
