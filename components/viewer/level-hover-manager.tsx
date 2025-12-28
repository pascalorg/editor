'use client'

import { Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Intersection, Object3D } from 'three'
import * as THREE from 'three'
import { Box3, Mesh, Plane, Raycaster, Vector2, Vector3 } from 'three'
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

/**
 * Gradient shader material for highlight box walls
 * Fades from transparent at bottom to semi-transparent at top
 * Uses geometry bounds attribute to compute normalized height in vertex shader
 */
const HighlightGradientMaterial = ({
  color,
  opacity,
}: {
  color: string
  opacity: number
}) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    }),
    [],
  )

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uColor.value.set(color)
      materialRef.current.uniforms.uOpacity.value = opacity
    }
  }, [color, opacity])

  return (
    <shaderMaterial
      depthTest={false}
      depthWrite={false}
      fragmentShader={`
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;

        void main() {
          gl_FragColor = vec4(uColor, vAlpha * uOpacity);
        }
      `}
      ref={materialRef}
      side={THREE.DoubleSide}
      transparent
      uniforms={uniforms}
      vertexShader={`
        attribute float normalizedHeight;
        varying float vAlpha;

        void main() {
          // Use pre-computed normalized height (0 at bottom, 1 at top)
          vAlpha = normalizedHeight * normalizedHeight; // Quadratic falloff
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `}
    />
  )
}

function HighlightBox({ box, color }: HighlightBoxProps) {
  const points = useMemo(() => getBoxEdgePoints(box), [box])

  // Create wall geometry for the box - only walls, no top/bottom caps
  const wallGeometry = useMemo(() => {
    const min = box.min
    const max = box.max

    // Create 4 wall planes manually for cleaner geometry
    const geometry = new THREE.BufferGeometry()

    // Define the 4 walls as quads (2 triangles each)
    // Wall vertices: each wall has 4 corners
    // Pattern per wall: bottom-left, bottom-right, top-right, top-left
    const vertices = new Float32Array([
      // Front wall (min.z side)
      min.x, min.y, min.z,
      max.x, min.y, min.z,
      max.x, max.y, min.z,
      min.x, max.y, min.z,
      // Back wall (max.z side)
      max.x, min.y, max.z,
      min.x, min.y, max.z,
      min.x, max.y, max.z,
      max.x, max.y, max.z,
      // Left wall (min.x side)
      min.x, min.y, max.z,
      min.x, min.y, min.z,
      min.x, max.y, min.z,
      min.x, max.y, max.z,
      // Right wall (max.x side)
      max.x, min.y, min.z,
      max.x, min.y, max.z,
      max.x, max.y, max.z,
      max.x, max.y, min.z,
    ])

    // Normalized height attribute: 0 at bottom, 1 at top
    // Pattern per wall: 0, 0, 1, 1 (bottom vertices = 0, top vertices = 1)
    const normalizedHeight = new Float32Array([
      // Front wall
      0, 0, 1, 1,
      // Back wall
      0, 0, 1, 1,
      // Left wall
      0, 0, 1, 1,
      // Right wall
      0, 0, 1, 1,
    ])

    // Indices for 4 walls (2 triangles per wall)
    const indices = new Uint16Array([
      // Front wall
      0, 1, 2, 0, 2, 3,
      // Back wall
      4, 5, 6, 4, 6, 7,
      // Left wall
      8, 9, 10, 8, 10, 11,
      // Right wall
      12, 13, 14, 12, 14, 15,
    ])

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    geometry.setAttribute('normalizedHeight', new THREE.BufferAttribute(normalizedHeight, 1))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.computeVertexNormals()

    return geometry
  }, [box])

  return (
    <group>
      {/* Gradient fill walls */}
      <mesh geometry={wallGeometry} renderOrder={997}>
        <HighlightGradientMaterial color={color} opacity={0.3} />
      </mesh>

      {/* Edge lines */}
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
    </group>
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
    const hasNodes =
      state.selectedNodeIds.length > 0 && !state.selectedNodeIds.includes(buildingId!)

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

  const transitionToNode = useCallback((nodeId: string, keepZone: boolean) => {
    const nodeData = useEditor
      .getState()
      .graph.getNodeById(nodeId as any)
      ?.data()
    emitter.emit('interaction:click', { type: 'node', id: nodeId, data: nodeData })
    useEditor.setState({
      selectedZoneId: keepZone ? useEditor.getState().selectedZoneId : null,
      selectedNodeIds: [nodeId],
    })
  }, [])

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

  // Ground plane for raycasting (y = 0)
  const groundPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), [])

  // Check if ray intersects the ground within a bounding box (XZ projection)
  const rayIntersectsGroundInBox = (raycaster: Raycaster, box: Box3): boolean => {
    const intersection = new Vector3()
    const hit = raycaster.ray.intersectPlane(groundPlane, intersection)
    if (!hit) return false

    // Check if the intersection point is within the box's XZ bounds
    return (
      intersection.x >= box.min.x &&
      intersection.x <= box.max.x &&
      intersection.z >= box.min.z &&
      intersection.z <= box.max.z
    )
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
          // Can only hover building (including ground within building bounds)
          if (buildingId) {
            const buildingObject = scene.getObjectByName(buildingId)
            if (buildingObject) {
              const box = calculateBoundsExcludingImages(buildingObject)
              if (box && !box.isEmpty()) {
                // Check if hovering building meshes OR ground within building footprint
                const intersects = raycasterRef.current.intersectObject(buildingObject, true)
                if (intersects.length > 0 || rayIntersectsGroundInBox(raycasterRef.current, box)) {
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
          // Can hover levels (including ground within level bounds)
          // Find the closest level by intersection distance
          let closestLevelId: string | null = null
          let closestLevelBox: Box3 | null = null
          let closestDistance = Number.POSITIVE_INFINITY

          for (const levelId of levelIds) {
            const levelObject = scene.getObjectByName(levelId)
            if (levelObject) {
              const box = calculateBoundsExcludingImages(levelObject)
              if (box && !box.isEmpty()) {
                const intersects = raycasterRef.current.intersectObject(levelObject, true)
                if (intersects.length > 0 && intersects[0].distance < closestDistance) {
                  closestDistance = intersects[0].distance
                  closestLevelId = levelId
                  closestLevelBox = box
                } else if (
                  closestDistance === Number.POSITIVE_INFINITY &&
                  rayIntersectsGroundInBox(raycasterRef.current, box)
                ) {
                  // Ground click within level bounds - only use if no mesh hit yet
                  closestLevelId = levelId
                  closestLevelBox = box
                }
              }
            }
          }

          if (closestLevelId && closestLevelBox) {
            setHoveredBox(closestLevelBox)
            setHoverMode('level')
            return
          }

          setHoveredBox(null)
          setHoverMode(null)
          break
        }

        case 'level': {
          // When a level is selected, don't allow hovering other levels
          // User must go back (Escape or click void) to switch levels
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
          // Click building (including ground within building bounds) -> transition to building
          if (buildingId) {
            const buildingObject = scene.getObjectByName(buildingId)
            if (buildingObject) {
              const box = calculateBoundsExcludingImages(buildingObject)
              if (box && !box.isEmpty()) {
                const intersects = raycasterRef.current.intersectObject(buildingObject, true)
                if (intersects.length > 0 || rayIntersectsGroundInBox(raycasterRef.current, box)) {
                  transitionToBuilding()
                  // Auto-select level if only one
                  if (shouldSkipLevelSelection) {
                    transitionToLevel(levelIds[0])
                  }
                  return
                }
              }
            }
          }
          break
        }

        case 'building': {
          // Click level (including ground within level bounds) -> transition to level
          let clickedLevelId: string | null = null
          let clickedLevelDistance = Number.POSITIVE_INFINITY

          for (const levelId of levelIds) {
            const levelObject = scene.getObjectByName(levelId)
            if (levelObject) {
              const box = calculateBoundsExcludingImages(levelObject)
              if (box && !box.isEmpty()) {
                const intersects = raycasterRef.current.intersectObject(levelObject, true)
                if (intersects.length > 0 && intersects[0].distance < clickedLevelDistance) {
                  clickedLevelDistance = intersects[0].distance
                  clickedLevelId = levelId
                } else if (
                  clickedLevelDistance === Number.POSITIVE_INFINITY &&
                  rayIntersectsGroundInBox(raycasterRef.current, box)
                ) {
                  // Ground click within level bounds - use a large distance so mesh clicks take priority
                  clickedLevelId = levelId
                }
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

          // Check if clicked on a zone within the current level
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

          // Click anywhere else -> go back (no level switching allowed)
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
