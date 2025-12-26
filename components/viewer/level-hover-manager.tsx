'use client'

import { Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Intersection, Object3D } from 'three'
import { Box3, Mesh, Raycaster, Vector2 } from 'three'
import { useShallow } from 'zustand/shallow'
import { GRID_SIZE, TILE_SIZE } from '@/components/editor'
import { emitter } from '@/events/bus'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { Zone } from '@/lib/scenegraph/schema/zones'

/**
 * FSM States for viewer navigation
 */
type ViewerState = 'idle' | 'building' | 'level' | 'zone' | 'node'

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
 * LevelHoverManager - FSM-based navigation for viewer mode
 *
 * States:
 * - idle: Nothing selected, hover/click building to enter building state
 * - building: Building selected, hover/click levels (or auto-select if only one)
 * - level: Level selected, hover/click zones
 * - zone: Zone selected, hover/click nodes
 * - node: Node(s) selected
 *
 * Transitions:
 * - idle -> building: Click on building
 * - building -> level: Click on level (or auto if single level)
 * - building -> idle: Click void
 * - level -> zone: Click on zone
 * - level -> building: Click void (or auto if single level -> idle)
 * - zone -> node: Click on node
 * - zone -> level: Click outside zone (or building if single level)
 * - node -> zone: Click outside node but inside zone
 * - node -> level: Click outside zone (or building if single level)
 */
export function LevelHoverManager() {
  const { scene, camera, gl } = useThree()

  const [hoveredBox, setHoveredBox] = useState<Box3 | null>(null)
  const [hoverMode, setHoverMode] = useState<'level' | 'node' | 'building' | null>(null)

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

  // Get all visible level IDs from the scene
  const levelIds = useEditor(
    useShallow((state: StoreState) => {
      const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
      if (!building) return []
      return building.children
        .filter((c) => c.type === 'level' && c.visible !== false)
        .map((l) => l.id)
    }),
  )

  // Derive current FSM state from editor state
  const deriveState = useCallback((): ViewerState => {
    const state = useEditor.getState()
    const hasBuilding = buildingId && state.selectedNodeIds.includes(buildingId)
    const hasFloor = !!state.selectedFloorId
    const hasZone = !!state.selectedZoneId
    const hasNodes = state.selectedNodeIds.length > 0 && !state.selectedNodeIds.includes(buildingId!)

    if (hasNodes) return 'node'
    if (hasZone) return 'zone'
    if (hasFloor) return 'level'
    if (hasBuilding) return 'building'
    return 'idle'
  }, [buildingId])

  // Check if we should skip level selection (only one visible level)
  const shouldSkipLevelSelection = levelIds.length === 1

  // Get the selected zone's polygon for boundary checking
  const selectedZonePolygon = useEditor(
    useShallow((state: StoreState) => {
      if (!state.selectedZoneId) return null
      const zone = (state.scene.zones || []).find((c) => c.id === state.selectedZoneId)
      return zone?.polygon || null
    }),
  )

  // Initialize viewer state on mount
  useEffect(() => {
    useEditor.setState({
      selectedFloorId: null,
      selectedZoneId: null,
      selectedNodeIds: [],
      viewMode: 'full',
      levelMode: 'stacked',
    })
  }, [])

  // --- State Transition Functions ---

  const transitionToIdle = useCallback(() => {
    emitter.emit('interaction:click', { type: 'void', id: null })
    useEditor.setState({
      selectedNodeIds: [],
      selectedZoneId: null,
      selectedFloorId: null,
      levelMode: 'stacked',
      viewMode: 'full',
    })
  }, [])

  const transitionToBuilding = useCallback(() => {
    if (!buildingId) return
    emitter.emit('interaction:click', { type: 'building', id: buildingId })
    useEditor.setState({
      selectedNodeIds: [buildingId],
      selectedZoneId: null,
      selectedFloorId: null,
      levelMode: 'exploded',
      viewMode: 'full',
    })
  }, [buildingId])

  const transitionToLevel = useCallback(
    (levelId: string) => {
      if (!buildingId) return
      emitter.emit('interaction:click', { type: 'level', id: levelId })
      useEditor.setState({
        selectedNodeIds: [buildingId],
        selectedZoneId: null,
        selectedFloorId: levelId,
      })
    },
    [buildingId],
  )

  const transitionToZone = useCallback((zoneId: string, zone: Zone) => {
    emitter.emit('interaction:click', { type: 'zone', id: zoneId, data: zone })
    useEditor.getState().selectZone(zoneId)
  }, [])

  const transitionToNode = useCallback(
    (nodeId: string, keepZone: boolean) => {
      const nodeData = useEditor.getState().graph.getNodeById(nodeId as any)?.data()
      emitter.emit('interaction:click', { type: 'node', id: nodeId, data: nodeData })
      useEditor.setState({
        selectedZoneId: keepZone ? useEditor.getState().selectedZoneId : null,
        selectedNodeIds: [nodeId],
      })
    },
    [],
  )

  // Go back one step in the hierarchy, respecting single-level skip
  const goBack = useCallback(() => {
    const currentState = deriveState()

    switch (currentState) {
      case 'node':
        // Node -> Zone (clear node selection, keep zone)
        // If no zone was selected and single level, go back to building
        if (useEditor.getState().selectedZoneId) {
          useEditor.setState({ selectedNodeIds: [] })
        } else if (shouldSkipLevelSelection) {
          transitionToBuilding()
        } else {
          useEditor.setState({ selectedNodeIds: [] })
        }
        break

      case 'zone':
        // Zone -> Level (to select other zones)
        useEditor.setState({ selectedZoneId: null })
        break

      case 'level':
        // Level -> Building, or Idle if single level (skip building)
        if (shouldSkipLevelSelection) {
          transitionToIdle()
        } else {
          transitionToBuilding()
        }
        break

      case 'building':
        // Building -> Idle
        transitionToIdle()
        break
    }
  }, [deriveState, shouldSkipLevelSelection, transitionToBuilding, transitionToIdle])

  // --- Helper Functions ---

  const findRoomForPoint = (x: number, z: number, zones: Zone[]): Zone | null => {
    for (const zone of zones) {
      if (isPointInPolygon(x, z, zone.polygon)) {
        return zone
      }
    }
    return null
  }

  const isPointInPolygon = (x: number, z: number, polygon: [number, number][]): boolean => {
    if (!polygon || polygon.length < 3) return false
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0],
        zi = polygon[i][1]
      const xj = polygon[j][0],
        zj = polygon[j][1]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
        inside = !inside
      }
    }
    return inside
  }

  const isWorldPointInSelectedPolygon = (worldX: number, worldZ: number): boolean => {
    if (!selectedZonePolygon || selectedZonePolygon.length < 3) return true
    const localX = worldX + GRID_SIZE / 2
    const localZ = worldZ + GRID_SIZE / 2
    const gridX = localX / TILE_SIZE
    const gridZ = localZ / TILE_SIZE
    return isPointInPolygon(gridX, gridZ, selectedZonePolygon)
  }

  const calculateBoundsExcludingImages = (object: Object3D): Box3 | null => {
    const box = new Box3()
    const graph = useEditor.getState().graph
    let hasContent = false

    object.updateWorldMatrix(true, true)

    object.traverse((child) => {
      if (child instanceof Mesh && child.geometry) {
        if (child.name === '__infinite_grid__' || child.name === '__proximity_grid__') {
          return
        }

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

  const isBackgroundElement = (nodeId: string): boolean =>
    nodeId.startsWith('level_') || nodeId.startsWith('ceiling_') || nodeId.startsWith('slab_')

  // --- Event Handlers ---

  useEffect(() => {
    const canvas = gl.domElement

    const onPointerDown = (event: PointerEvent) => {
      isDrag.current = false
      downPos.current = { x: event.clientX, y: event.clientY }
    }

    const onPointerMove = (event: PointerEvent) => {
      const currentState = deriveState()
      const state = useEditor.getState()

      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(new Vector2(x, y), camera)

      // Hover logic based on current state
      switch (currentState) {
        case 'idle': {
          // Can only hover building
          if (buildingId) {
            const buildingObject = scene.getObjectByName(buildingId)
            if (buildingObject) {
              const intersects = raycasterRef.current.intersectObject(buildingObject, true)
              if (intersects.length > 0) {
                const box = calculateBoundsExcludingImages(buildingObject)
                if (box && !box.isEmpty()) {
                  setHoveredBox(box)
                  setHoverMode('building')
                  return
                }
              }
            }
          }
          setHoveredBox(null)
          setHoverMode(null)
          break
        }

        case 'building': {
          // Can hover levels
          for (const levelId of levelIds) {
            const levelObject = scene.getObjectByName(levelId)
            if (levelObject) {
              const intersects = raycasterRef.current.intersectObject(levelObject, true)
              if (intersects.length > 0) {
                const box = calculateBoundsExcludingImages(levelObject)
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
          break
        }

        case 'level': {
          // Can hover other levels (for switching)
          const currentFloorId = state.selectedFloorId
          if (!currentFloorId) break

          for (const levelId of levelIds) {
            if (levelId === currentFloorId) continue
            const otherLevelObject = scene.getObjectByName(levelId)
            if (otherLevelObject) {
              const otherIntersects = raycasterRef.current.intersectObject(otherLevelObject, true)
              if (otherIntersects.length > 0) {
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
          break
        }

        case 'zone':
        case 'node': {
          // Can hover nodes within zone
          const currentFloorId = state.selectedFloorId
          const currentZoneId = state.selectedZoneId
          if (!currentFloorId) break

          const levelObject = scene.getObjectByName(currentFloorId)
          if (!levelObject) break

          const intersects = raycasterRef.current.intersectObject(levelObject, true)
          if (intersects.length > 0) {
            for (const hit of intersects) {
              const nodeId = getNodeIdFromIntersection(hit.object)
              if (nodeId && !isBackgroundElement(nodeId)) {
                const graph = useEditor.getState().graph
                const node = graph.getNodeById(nodeId as any)?.data()
                if (node?.type === 'reference-image') continue

                if (currentZoneId && !isWorldPointInSelectedPolygon(hit.point.x, hit.point.z)) {
                  continue
                }

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
          }

          setHoveredBox(null)
          setHoverMode(null)
          break
        }
      }
    }

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return

      const dist = Math.hypot(event.clientX - downPos.current.x, event.clientY - downPos.current.y)
      if (dist > 5) return

      const currentState = deriveState()
      const state = useEditor.getState()
      const hasModifierKey = event.shiftKey || event.metaKey || event.ctrlKey

      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(new Vector2(x, y), camera)

      switch (currentState) {
        case 'idle': {
          // Click building -> transition to building (and maybe auto to level)
          if (buildingId) {
            const buildingObject = scene.getObjectByName(buildingId)
            if (buildingObject) {
              const intersects = raycasterRef.current.intersectObject(buildingObject, true)
              if (intersects.length > 0) {
                transitionToBuilding()
                // Auto-select level if only one
                if (shouldSkipLevelSelection) {
                  transitionToLevel(levelIds[0])
                }
                return
              }
            }
          }
          break
        }

        case 'building': {
          // Click level -> transition to level
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

          if (clickedLevelId) {
            transitionToLevel(clickedLevelId)
            return
          }

          // Click void -> back to idle
          transitionToIdle()
          break
        }

        case 'level': {
          const currentFloorId = state.selectedFloorId
          if (!currentFloorId) break

          const levelObject = scene.getObjectByName(currentFloorId)

          // Check if clicked on a zone
          if (levelObject) {
            const intersects = raycasterRef.current.intersectObject(levelObject, true)
            if (intersects.length > 0) {
              const currentRoomZones = (state.scene.zones || []).filter(
                (c) => c.levelId === currentFloorId,
              )

              if (currentRoomZones.length > 0) {
                const hit = intersects[0]
                const room = findRoomForPoint(hit.point.x, hit.point.z, currentRoomZones)
                if (room) {
                  transitionToZone(room.id, room)
                  return
                }
              }
            }
          }

          // Check if clicked on another level
          let clickedLevelId: string | null = null
          let clickedLevelDistance = Number.POSITIVE_INFINITY

          for (const levelId of levelIds) {
            const lvlObject = scene.getObjectByName(levelId)
            if (lvlObject) {
              const intersects = raycasterRef.current.intersectObject(lvlObject, true)
              if (intersects.length > 0 && intersects[0].distance < clickedLevelDistance) {
                clickedLevelDistance = intersects[0].distance
                clickedLevelId = levelId
              }
            }
          }

          if (clickedLevelId) {
            if (clickedLevelId === currentFloorId) {
              // Clicked same level background -> go back
              goBack()
            } else {
              // Clicked different level -> switch
              transitionToLevel(clickedLevelId)
            }
            return
          }

          // Click void -> go back
          goBack()
          break
        }

        case 'zone': {
          const currentFloorId = state.selectedFloorId
          const currentZoneId = state.selectedZoneId
          if (!currentFloorId) break

          const levelObject = scene.getObjectByName(currentFloorId)
          if (!levelObject) break

          const intersects = raycasterRef.current.intersectObject(levelObject, true)

          if (intersects.length > 0) {
            // Check if clicked on a node within zone
            for (const hit of intersects) {
              const nodeId = getNodeIdFromIntersection(hit.object)
              if (nodeId && !isBackgroundElement(nodeId)) {
                const graph = useEditor.getState().graph
                const node = graph.getNodeById(nodeId as any)?.data()
                if (node?.type === 'reference-image') continue

                if (currentZoneId && !isWorldPointInSelectedPolygon(hit.point.x, hit.point.z)) {
                  continue
                }

                if (hasModifierKey) {
                  state.handleNodeSelect(nodeId, {
                    shiftKey: event.shiftKey,
                    metaKey: event.metaKey,
                    ctrlKey: event.ctrlKey,
                  })
                } else {
                  transitionToNode(nodeId, true)
                }
                return
              }
            }

            // Check if clicked on a different zone
            const currentRoomZones = (state.scene.zones || []).filter(
              (c) => c.levelId === currentFloorId,
            )
            const hit = intersects[0]
            const room = findRoomForPoint(hit.point.x, hit.point.z, currentRoomZones)

            if (room) {
              if (room.id !== currentZoneId) {
                // Clicked different zone -> switch
                transitionToZone(room.id, room)
              }
              // Clicked same zone background -> stay
              return
            }
          }

          // Clicked outside all zones -> go back
          goBack()
          break
        }

        case 'node': {
          const currentFloorId = state.selectedFloorId
          const currentZoneId = state.selectedZoneId
          if (!currentFloorId) break

          const levelObject = scene.getObjectByName(currentFloorId)
          if (!levelObject) break

          const intersects = raycasterRef.current.intersectObject(levelObject, true)

          if (intersects.length > 0) {
            // Check if clicked on another node
            for (const hit of intersects) {
              const nodeId = getNodeIdFromIntersection(hit.object)
              if (nodeId && !isBackgroundElement(nodeId)) {
                const graph = useEditor.getState().graph
                const node = graph.getNodeById(nodeId as any)?.data()
                if (node?.type === 'reference-image') continue

                if (currentZoneId && !isWorldPointInSelectedPolygon(hit.point.x, hit.point.z)) {
                  continue
                }

                if (hasModifierKey) {
                  state.handleNodeSelect(nodeId, {
                    shiftKey: event.shiftKey,
                    metaKey: event.metaKey,
                    ctrlKey: event.ctrlKey,
                  })
                } else {
                  transitionToNode(nodeId, true)
                }
                return
              }
            }

            // Check if clicked inside zone but not on node
            if (currentZoneId) {
              const hit = intersects[0]
              if (isWorldPointInSelectedPolygon(hit.point.x, hit.point.z)) {
                // Clicked zone background -> go back to zone
                useEditor.setState({ selectedNodeIds: [] })
                return
              }
            }
          }

          // Clicked outside zone -> go back
          goBack()
          break
        }
      }
    }

    const throttledOnPointerMove = throttle(onPointerMove, 16)

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', throttledOnPointerMove)
    canvas.addEventListener('click', onClick)

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', throttledOnPointerMove)
      canvas.removeEventListener('click', onClick)
    }
  }, [
    camera,
    gl,
    scene,
    levelIds,
    buildingId,
    deriveState,
    goBack,
    shouldSkipLevelSelection,
    transitionToBuilding,
    transitionToIdle,
    transitionToLevel,
    transitionToNode,
    transitionToZone,
  ])

  // Clear hover when relevant state changes
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedZoneId = useEditor((state) => state.selectedZoneId)

  useEffect(() => {
    setHoveredBox(null)
    setHoverMode(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally trigger on state changes
  }, [selectedFloorId, selectedZoneId])

  if (!(hoveredBox && hoverMode)) return null

  const colorMap = {
    level: '#3b82f6',
    node: '#22c55e',
    building: '#ffffff',
  }
  const color = colorMap[hoverMode]

  return <HighlightBox box={hoveredBox} color={color} />
}

function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let lastCall = 0

  return (...args: Parameters<T>) => {
    const now = Date.now()

    if (now - lastCall >= delay) {
      lastCall = now
      fn(...args)
    }
  }
}
