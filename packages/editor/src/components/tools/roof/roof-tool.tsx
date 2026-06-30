import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  type LevelNode,
  RoofNode,
  RoofSegmentNode,
  resolveBuildingForLevel,
  sceneRegistry,
  useScene,
  type WallNode,
  wallSegmentAnchors,
} from '@pascal-app/core'
import { clearSurfacePlanSnapFeedback, resolveSurfacePlanPointSnap } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  type Line,
  Vector3,
} from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { snapWorldXZForActiveBuilding } from '../../../lib/world-grid-snap'
import useEditor, { isGridSnapActive, isMagneticSnapActive } from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const DEFAULT_WALL_HEIGHT = 0.5
const DEFAULT_PITCH_DEG = 40
const GRID_OFFSET = 0.02

// Walls that are direct children of a level.
function getLevelWalls(
  levelId: string | null,
  nodes: Readonly<Record<string, AnyNode>>,
): WallNode[] {
  if (!levelId) return []
  const levelNode = nodes[levelId]
  if (levelNode?.type !== 'level') return []
  return (levelNode as LevelNode).children
    .map((childId) => nodes[childId])
    .filter((node): node is WallNode => node?.type === 'wall')
}

// Walls on the level directly beneath the active one. Levels share the same
// local XZ origin (they only differ in world Y), so these walls live in the
// identical coordinate frame and feed straight into both the alignment pool
// and the magnetic wall-snap pipeline — letting a roof drawn on the upper
// floor snap onto the wall corners of the floor below.
function getBelowLevelWalls(
  currentLevelId: string | null,
  nodes: Readonly<Record<string, AnyNode>>,
): WallNode[] {
  if (!currentLevelId) return []
  const currentLevel = nodes[currentLevelId]
  if (currentLevel?.type !== 'level') return []
  const buildingId = resolveBuildingForLevel(currentLevel.id, nodes)
  if (!buildingId) return []
  const building = nodes[buildingId]
  if (building?.type !== 'building') return []
  const currentIndex = (currentLevel as LevelNode).level
  const belowLevel = (building.children ?? [])
    .map((childId) => nodes[childId])
    .filter((node): node is LevelNode => node?.type === 'level' && node.level < currentIndex)
    .sort((a, b) => b.level - a.level)[0]
  return getLevelWalls(belowLevel?.id ?? null, nodes)
}

// Current-level + floor-below walls — the magnetic snap targets the roof draft
// locks onto (corners, midpoints, crossings, wall bodies), matching the wall
// tool. Same coordinate frame, so no transform is needed.
function getRoofSnapWalls(
  currentLevelId: string | null,
  nodes: Readonly<Record<string, AnyNode>>,
): WallNode[] {
  return [...getLevelWalls(currentLevelId, nodes), ...getBelowLevelWalls(currentLevelId, nodes)]
}

// Current-level alignment anchors plus the floor-below wall corners.
function collectRoofAlignmentAnchors(
  nodes: Readonly<Record<string, AnyNode>>,
  currentLevelId: string | null,
): AlignmentAnchor[] {
  return [
    ...collectAlignmentAnchors(nodes, '', currentLevelId),
    ...getBelowLevelWalls(currentLevelId, nodes).flatMap((wall) =>
      wallSegmentAnchors(wall.id, wall.start, wall.end, wall.thickness),
    ),
  ]
}

/**
 * Creates a roof group with one default gable segment
 */
const commitRoofPlacement = (
  levelId: LevelNode['id'],
  corner1: [number, number, number],
  corner2: [number, number, number],
  selectedIds: string[],
): AnyNode['id'] => {
  const { createNode, createNodes, nodes } = useScene.getState()

  // A placed roof preset seeds `toolDefaults.roof` with the flattened
  // subtree params (roofType, pitch, wallHeight, overhang, materials, …)
  // before the tool activates. The footprint (width/depth) and placement
  // come from the drawn rectangle and always win; the segment carries the
  // shape/material params, the roof container picks up the materials.
  const defaults = useEditor.getState().toolDefaults.roof ?? {}

  const centerX = (corner1[0] + corner2[0]) / 2
  const centerZ = (corner1[2] + corner2[2]) / 2

  const width = Math.max(Math.abs(corner2[0] - corner1[0]), 1)
  const depth = Math.max(Math.abs(corner2[2] - corner1[2]), 1)

  // Determine if there is an active roof node we should add to
  let targetRoofId: RoofNode['id'] | null = null
  const selectedId = selectedIds[0]
  if (selectedIds.length === 1 && selectedId) {
    const selectedNode = nodes[selectedId as AnyNodeId]
    if (selectedNode?.type === 'roof') {
      targetRoofId = selectedNode.id
    } else if (selectedNode?.type === 'roof-segment' && selectedNode.parentId) {
      targetRoofId = selectedNode.parentId as RoofNode['id']
    }
  }

  if (targetRoofId) {
    const targetRoof = nodes[targetRoofId] as RoofNode
    let localX = centerX
    let localZ = centerZ

    // Convert world coordinates to the local space of the parent roof
    const targetObj = sceneRegistry.nodes.get(targetRoofId)
    if (targetObj) {
      const worldVec = new THREE.Vector3(centerX, 0, centerZ)
      targetObj.worldToLocal(worldVec)
      localX = worldVec.x
      localZ = worldVec.z
    } else {
      // Math fallback if mesh isn't ready
      const dx = centerX - targetRoof.position[0]
      const dz = centerZ - targetRoof.position[2]
      const angle = -targetRoof.rotation
      localX = dx * Math.cos(angle) - dz * Math.sin(angle)
      localZ = dx * Math.sin(angle) + dz * Math.cos(angle)
    }

    const segment = RoofSegmentNode.parse({
      wallHeight: DEFAULT_WALL_HEIGHT,
      pitch: DEFAULT_PITCH_DEG,
      roofType: 'gable',
      ...defaults,
      width,
      depth,
      position: [localX, 0, localZ],
    })

    createNode(segment, targetRoofId as AnyNode['id'])
    sfxEmitter.emit('sfx:structure-build')
    return segment.id // Returns segment ID so it can be selected immediately
  }

  // Count existing roofs for naming
  const roofCount = Object.values(nodes).filter((n) => n.type === 'roof').length
  const name = `Roof ${roofCount + 1}`

  // Create the segment first (centered in its new parent)
  const segment = RoofSegmentNode.parse({
    wallHeight: DEFAULT_WALL_HEIGHT,
    pitch: DEFAULT_PITCH_DEG,
    roofType: 'gable',
    ...defaults,
    width,
    depth,
    position: [0, 0, 0],
  })

  // Create the roof container. Segment-shaped params (roofType, pitch, …) are
  // dropped by the RoofNode schema; surface materials in `defaults` carry over.
  const roof = RoofNode.parse({
    ...defaults,
    name,
    position: [centerX, 0, centerZ],
    children: [segment.id],
  })

  // Create roof first (so segment can be parented to it), then segment
  createNodes([
    { node: roof, parentId: levelId },
    { node: segment, parentId: roof.id },
  ])

  sfxEmitter.emit('sfx:structure-build')
  return roof.id
}

type PreviewState = {
  corner1: [number, number, number] | null
  cursorPosition: [number, number, number]
  levelY: number
}

function buildRoofGhostGeometry(
  width: number,
  depth: number,
  wallHeight: number,
  pitchDeg: number,
) {
  const safeWidth = Math.max(width, 0.1)
  const safeDepth = Math.max(depth, 0.1)
  const halfWidth = safeWidth / 2
  const halfDepth = safeDepth / 2
  const ridgeHeight = wallHeight + Math.tan((pitchDeg * Math.PI) / 180) * halfDepth

  const vertices = [
    // Front slope
    -halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    ridgeHeight,
    0,

    -halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    ridgeHeight,
    0,
    -halfWidth,
    ridgeHeight,
    0,

    // Back slope
    -halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    wallHeight,
    halfDepth,

    -halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    wallHeight,
    halfDepth,
    -halfWidth,
    wallHeight,
    halfDepth,

    // Left gable
    -halfWidth,
    wallHeight,
    -halfDepth,
    -halfWidth,
    ridgeHeight,
    0,
    -halfWidth,
    wallHeight,
    halfDepth,

    // Right gable
    halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    wallHeight,
    halfDepth,
    halfWidth,
    ridgeHeight,
    0,
  ]

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

function buildRoofGhostEdges(width: number, depth: number, wallHeight: number, pitchDeg: number) {
  const safeWidth = Math.max(width, 0.1)
  const safeDepth = Math.max(depth, 0.1)
  const halfWidth = safeWidth / 2
  const halfDepth = safeDepth / 2
  const ridgeHeight = wallHeight + Math.tan((pitchDeg * Math.PI) / 180) * halfDepth

  const vertices = [
    // Base rectangle
    -halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    wallHeight,
    halfDepth,
    halfWidth,
    wallHeight,
    halfDepth,
    -halfWidth,
    wallHeight,
    halfDepth,
    -halfWidth,
    wallHeight,
    halfDepth,
    -halfWidth,
    wallHeight,
    -halfDepth,

    // Ridge + gable edges
    -halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    ridgeHeight,
    0,
    -halfWidth,
    wallHeight,
    -halfDepth,
    -halfWidth,
    ridgeHeight,
    0,
    -halfWidth,
    ridgeHeight,
    0,
    -halfWidth,
    wallHeight,
    halfDepth,
    halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    wallHeight,
    halfDepth,
  ]

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  return geometry
}

export const RoofTool: React.FC = () => {
  const cursorRef = useRef<Group>(null)
  const outlineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const setSelection = useViewer((state) => state.setSelection)

  const selectedIdsRef = useRef(selectedIds)
  useEffect(() => {
    selectedIdsRef.current = selectedIds
  }, [selectedIds])

  // Clear preset-seeded defaults on deactivation so a later manual roof draw
  // isn't built with a stale preset's parameters. Unmount-only.
  useEffect(() => () => useEditor.getState().setToolDefaults('roof', null), [])

  const corner1Ref = useRef<[number, number, number] | null>(null)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const [preview, setPreview] = useState<PreviewState>({
    corner1: null,
    cursorPosition: [0, 0, 0],
    levelY: 0,
  })

  useEffect(() => {
    if (!currentLevelId) return

    outlineRef.current.geometry = new BufferGeometry()

    // Alignment candidates — anchors of every alignable object on the active
    // level plus the wall corners of the floor directly below, so a roof drawn
    // on the upper floor aligns to the walls beneath it. Refreshed after each
    // roof commits. Both corners of the rectangle align.
    let alignmentCandidates = collectRoofAlignmentAnchors(useScene.getState().nodes, currentLevelId)

    // Resolve a grid:move/click into the drafted corner via the shared surface
    // snap pipeline: magnetic lock onto wall corners / midpoints / crossings /
    // bodies on the active level + floor below (raising the green beacon),
    // falling back to alignment guides, then to the world-grid snap. The same
    // path the slab/ceiling tools use, so the beacon and coloring match. The
    // pipeline reads the snapping mode itself (Shift bypass, magnetic on/off),
    // so this tool never inspects the flags. `levelId` is intentionally omitted
    // so the explicit floor-below `walls` aren't filtered back out.
    const resolveDraftPoint = (event: GridEvent): [number, number] => {
      const rawPoint: [number, number] = [event.localPosition[0], event.localPosition[2]]
      const gridFallback: [number, number] = isGridSnapActive()
        ? snapWorldXZForActiveBuilding(
            event.position[0],
            event.position[2],
            useEditor.getState().gridSnapStep,
          ).local
        : rawPoint
      const nodes = useScene.getState().nodes
      return resolveSurfacePlanPointSnap({
        rawPoint,
        fallbackPoint: gridFallback,
        walls: getRoofSnapWalls(currentLevelId, nodes),
        candidates: alignmentCandidates,
        movingId: '__roof-draft__',
        highlightWalls: true,
      }).point
    }

    const updateOutline = (
      corner1: [number, number, number],
      corner2: [number, number, number],
    ) => {
      const gridY = corner1[1] + GRID_OFFSET

      const groundPoints = [
        new Vector3(corner1[0], gridY, corner1[2]),
        new Vector3(corner2[0], gridY, corner1[2]),
        new Vector3(corner2[0], gridY, corner2[2]),
        new Vector3(corner1[0], gridY, corner2[2]),
        new Vector3(corner1[0], gridY, corner1[2]),
      ]

      outlineRef.current.geometry.dispose()
      outlineRef.current.geometry = new BufferGeometry().setFromPoints(groundPoints)
      outlineRef.current.visible = true
    }

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return

      const [gridX, gridZ] = resolveDraftPoint(event)
      const y = event.localPosition[1]

      const cursorPosition: [number, number, number] = [gridX, y, gridZ]
      const gridY = y + GRID_OFFSET

      cursorRef.current.position.set(gridX, gridY, gridZ)

      if (
        (isGridSnapActive() || isMagneticSnapActive()) &&
        corner1Ref.current &&
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]

      setPreview({
        corner1: corner1Ref.current,
        cursorPosition,
        levelY: y,
      })

      if (corner1Ref.current) {
        updateOutline(corner1Ref.current, cursorPosition)
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (!currentLevelId) return

      const [gridX, gridZ] = resolveDraftPoint(event)
      const y = event.localPosition[1]

      if (corner1Ref.current) {
        const roofId = commitRoofPlacement(
          currentLevelId,
          corner1Ref.current,
          [gridX, y, gridZ],
          selectedIdsRef.current,
        )

        setSelection({ selectedIds: [roofId as AnyNode['id']] })

        corner1Ref.current = null
        outlineRef.current.visible = false
        alignmentCandidates = collectRoofAlignmentAnchors(useScene.getState().nodes, currentLevelId)
        clearSurfacePlanSnapFeedback()
      } else {
        corner1Ref.current = [gridX, y, gridZ]
        sfxEmitter.emit('sfx:structure-build-start')
        setPreview((prev) => ({
          ...prev,
          corner1: corner1Ref.current,
        }))
      }
    }

    const onCancel = () => {
      if (corner1Ref.current) {
        markToolCancelConsumed()
        corner1Ref.current = null
        outlineRef.current.visible = false
        setPreview((prev) => ({ ...prev, corner1: null }))
      }
      clearSurfacePlanSnapFeedback()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      clearSurfacePlanSnapFeedback()

      corner1Ref.current = null
    }
  }, [currentLevelId, setSelection])

  const { corner1, cursorPosition, levelY } = preview

  const previewDimensions = useMemo(() => {
    if (!corner1) return null
    const length = Math.abs(cursorPosition[0] - corner1[0])
    const width = Math.abs(cursorPosition[2] - corner1[2])
    const centerX = (corner1[0] + cursorPosition[0]) / 2
    const centerZ = (corner1[2] + cursorPosition[2]) / 2
    return { length, width, centerX, centerZ }
  }, [corner1, cursorPosition])

  const roofGhostGeometry = useMemo(() => {
    if (!previewDimensions) return null
    return buildRoofGhostGeometry(
      previewDimensions.length,
      previewDimensions.width,
      DEFAULT_WALL_HEIGHT,
      DEFAULT_PITCH_DEG,
    )
  }, [previewDimensions])

  const roofGhostEdges = useMemo(() => {
    if (!previewDimensions) return null
    return buildRoofGhostEdges(
      previewDimensions.length,
      previewDimensions.width,
      DEFAULT_WALL_HEIGHT,
      DEFAULT_PITCH_DEG,
    )
  }, [previewDimensions])

  useEffect(
    () => () => {
      roofGhostGeometry?.dispose()
      roofGhostEdges?.dispose()
    },
    [roofGhostEdges, roofGhostGeometry],
  )

  return (
    <group>
      <CursorSphere ref={cursorRef} />

      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={outlineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.3}
          transparent
        />
      </line>

      {corner1 && (
        <CursorSphere
          color="#818cf8"
          position={[corner1[0], levelY + GRID_OFFSET, corner1[2]]}
          showTooltip={false}
        />
      )}

      {previewDimensions && previewDimensions.length > 0.1 && previewDimensions.width > 0.1 && (
        <group
          layers={EDITOR_LAYER}
          position={[previewDimensions.centerX, levelY + GRID_OFFSET, previewDimensions.centerZ]}
        >
          {roofGhostGeometry && (
            <mesh geometry={roofGhostGeometry} layers={EDITOR_LAYER} renderOrder={1}>
              <meshBasicMaterial
                color="#818cf8"
                depthTest={false}
                depthWrite={false}
                opacity={0.16}
                side={DoubleSide}
                transparent
              />
            </mesh>
          )}
          {roofGhostEdges && (
            <lineSegments geometry={roofGhostEdges} layers={EDITOR_LAYER} renderOrder={2}>
              <lineBasicMaterial
                color="#818cf8"
                depthTest={false}
                depthWrite={false}
                opacity={0.5}
                transparent
              />
            </lineSegments>
          )}
        </group>
      )}
    </group>
  )
}
