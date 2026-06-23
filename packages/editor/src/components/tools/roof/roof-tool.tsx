import {
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  createDefaultRidgeVentsForSegment,
  emitter,
  type GridEvent,
  getActiveRoofHeight,
  type LevelNode,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  snapScalar,
  useScene,
} from '@pascal-app/core'
import { useAlignmentGuides } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { BufferGeometry, DoubleSide, type Group, type Line, Vector3 } from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import {
  resolveAlignmentForActiveBuilding,
  snapWorldXZForActiveBuilding,
} from '../../../lib/world-grid-snap'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const DEFAULT_WALL_HEIGHT = 0.5
const DEFAULT_PITCH_DEG = 40
const GRID_OFFSET = 0.02
/** Figma-style alignment-snap threshold (meters), matching the move tools. */
const ALIGNMENT_THRESHOLD_M = 0.08
const ROOF_GHOST_COLOR = '#818cf8'

function snapToActiveGrid(value: number): number {
  return snapScalar(value, useEditor.getState().gridSnapStep)
}

type RoofDraftGeometry = {
  solid: BufferGeometry
  lines: BufferGeometry
}

function createRoofDraftGeometry(node: RoofSegmentNode): RoofDraftGeometry {
  const faces = getRoofDraftFaces(node)
  const positions: number[] = []
  const indices: number[] = []
  const linePoints: Vector3[] = []
  let vertexIndex = 0

  for (const face of faces) {
    if (face.length < 3) continue

    const faceStart = vertexIndex
    for (const point of face) {
      positions.push(point.x, point.y, point.z)
      vertexIndex++
    }

    for (let i = 1; i < face.length - 1; i++) {
      indices.push(faceStart, faceStart + i, faceStart + i + 1)
    }

    for (let i = 0; i < face.length; i++) {
      linePoints.push(face[i]!, face[(i + 1) % face.length]!)
    }
  }

  const solid = new BufferGeometry()
  solid.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  solid.setIndex(indices)
  solid.computeVertexNormals()

  const lines = new BufferGeometry().setFromPoints(linePoints)
  return { solid, lines }
}

function getRoofDraftFaces(node: RoofSegmentNode): Vector3[][] {
  const width = Math.max(0.01, node.width)
  const depth = Math.max(0.01, node.depth)
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const wallHeight = Math.max(0.01, node.wallHeight)
  const peakY = wallHeight + getActiveRoofHeight(node)
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

  const b1 = v(-halfWidth, 0, halfDepth)
  const b2 = v(halfWidth, 0, halfDepth)
  const b3 = v(halfWidth, 0, -halfDepth)
  const b4 = v(-halfWidth, 0, -halfDepth)
  const e1 = v(-halfWidth, wallHeight, halfDepth)
  const e2 = v(halfWidth, wallHeight, halfDepth)
  const e3 = v(halfWidth, wallHeight, -halfDepth)
  const e4 = v(-halfWidth, wallHeight, -halfDepth)

  const faces: Vector3[][] = [
    [b1, b2, e2, e1],
    [b2, b3, e3, e2],
    [b3, b4, e4, e3],
    [b4, b1, e1, e4],
  ]

  const pushHip = () => {
    if (Math.abs(width - depth) < 0.01) {
      const peak = v(0, peakY, 0)
      faces.push([e4, e1, peak], [e1, e2, peak], [e2, e3, peak], [e3, e4, peak])
    } else if (width >= depth) {
      const r1 = v(-halfWidth + halfDepth, peakY, 0)
      const r2 = v(halfWidth - halfDepth, peakY, 0)
      faces.push([e4, e1, r1], [e2, e3, r2], [e1, e2, r2, r1], [e3, e4, r1, r2])
    } else {
      const r1 = v(0, peakY, halfDepth - halfWidth)
      const r2 = v(0, peakY, -halfDepth + halfWidth)
      faces.push([e1, e2, r1], [e3, e4, r2], [e2, e3, r2, r1], [e4, e1, r1, r2])
    }
  }

  if (node.roofType === 'flat' || peakY <= wallHeight) {
    faces.push([e1, e2, e3, e4])
    return faces
  }

  switch (node.roofType) {
    case 'gable': {
      const r1 = v(-halfWidth, peakY, 0)
      const r2 = v(halfWidth, peakY, 0)
      faces.push([e4, e1, r1], [e2, e3, r2], [e1, e2, r2, r1], [e3, e4, r1, r2])
      break
    }
    case 'shed': {
      const t1 = v(-halfWidth, peakY, -halfDepth)
      const t2 = v(halfWidth, peakY, -halfDepth)
      faces.push([e1, e2, t2, t1], [e2, e3, t2], [e3, e4, t1, t2], [e4, e1, t1])
      break
    }
    case 'hip':
      pushHip()
      break
    case 'gambrel': {
      const midZ = halfDepth * node.gambrelLowerWidthRatio
      const midY = wallHeight + (peakY - wallHeight) * node.gambrelLowerHeightRatio
      const m1 = v(-halfWidth, midY, midZ)
      const m2 = v(halfWidth, midY, midZ)
      const m3 = v(halfWidth, midY, -midZ)
      const m4 = v(-halfWidth, midY, -midZ)
      const r1 = v(-halfWidth, peakY, 0)
      const r2 = v(halfWidth, peakY, 0)
      faces.push(
        [e4, e1, m1, r1, m4],
        [e2, e3, m3, r2, m2],
        [e1, e2, m2, m1],
        [m1, m2, r2, r1],
        [e3, e4, m4, m3],
        [m3, m4, r1, r2],
      )
      break
    }
    case 'mansard': {
      const inset = Math.min(width, depth) * node.mansardSteepWidthRatio
      if (halfWidth - inset <= 0.02 || halfDepth - inset <= 0.02) {
        pushHip()
        break
      }
      const midY = wallHeight + (peakY - wallHeight) * node.mansardSteepHeightRatio
      const w1 = v(-halfWidth + inset, midY, halfDepth - inset)
      const w2 = v(halfWidth - inset, midY, halfDepth - inset)
      const w3 = v(halfWidth - inset, midY, -halfDepth + inset)
      const w4 = v(-halfWidth + inset, midY, -halfDepth + inset)
      faces.push([e1, e2, w2, w1], [e2, e3, w3, w2], [e3, e4, w4, w3], [e4, e1, w1, w4])
      if (width >= depth) {
        const r1 = v(-halfWidth + halfDepth, peakY, 0)
        const r2 = v(halfWidth - halfDepth, peakY, 0)
        faces.push([w4, w1, r1], [w2, w3, r2], [w1, w2, r2, r1], [w3, w4, r1, r2])
      } else {
        const r1 = v(0, peakY, halfDepth - halfWidth)
        const r2 = v(0, peakY, -halfDepth + halfWidth)
        faces.push([w1, w2, r1], [w3, w4, r2], [w2, w3, r2, r1], [w4, w1, r1, r2])
      }
      break
    }
    case 'dutch': {
      const inset = Math.min(width, depth) * node.dutchHipWidthRatio
      if (halfWidth - inset <= 0.02 || halfDepth - inset <= 0.02) {
        pushHip()
        break
      }
      const midY = wallHeight + (peakY - wallHeight) * node.dutchHipHeightRatio
      const w1 = v(-halfWidth + inset, midY, halfDepth - inset)
      const w2 = v(halfWidth - inset, midY, halfDepth - inset)
      const w3 = v(halfWidth - inset, midY, -halfDepth + inset)
      const w4 = v(-halfWidth + inset, midY, -halfDepth + inset)
      faces.push([e1, e2, w2, w1], [e2, e3, w3, w2], [e3, e4, w4, w3], [e4, e1, w1, w4])
      if (width >= depth) {
        const r1 = v(-halfWidth + inset, peakY, 0)
        const r2 = v(halfWidth - inset, peakY, 0)
        faces.push([w4, w1, r1], [w2, w3, r2], [w1, w2, r2, r1], [w3, w4, r1, r2])
      } else {
        const r1 = v(0, peakY, halfDepth - inset)
        const r2 = v(0, peakY, -halfDepth + inset)
        faces.push([w1, w2, r1], [w3, w4, r2], [w2, w3, r2, r1], [w4, w1, r1, r2])
      }
      break
    }
    default:
      pushHip()
      break
  }

  return faces
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
  const { createNodes, nodes } = useScene.getState()

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
    const ridgeVents = createDefaultRidgeVentsForSegment(segment)

    createNodes([
      { node: segment, parentId: targetRoofId as AnyNode['id'] },
      ...ridgeVents.map((ridgeVent) => ({
        node: ridgeVent,
        parentId: segment.id as AnyNode['id'],
      })),
    ])
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
  const ridgeVents = createDefaultRidgeVentsForSegment(segment)

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
    ...ridgeVents.map((ridgeVent) => ({
      node: ridgeVent,
      parentId: segment.id as AnyNode['id'],
    })),
  ])

  sfxEmitter.emit('sfx:structure-build')
  return roof.id
}

type PreviewState = {
  corner1: [number, number, number] | null
  cursorPosition: [number, number, number]
  levelY: number
}

export const RoofTool: React.FC = () => {
  const cursorRef = useRef<Group>(null)
  const outlineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const setSelection = useViewer((state) => state.setSelection)
  const setTool = useEditor((state) => state.setTool)
  const setMode = useEditor((state) => state.setMode)
  const roofDefaults = useEditor((state) => state.toolDefaults.roof)

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

    // Alignment candidates — anchors of every alignable object; refreshed
    // after each roof commits. Both corners of the rectangle align.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', currentLevelId)
    // Snap the drafted corner onto another object's nearest real anchor and
    // publish the guide. The probe is the RAW cursor, NOT the 0.5m-grid-snapped
    // point: resolving against the grid point would only ever catch anchors
    // that happen to sit on a grid line, so off-grid items (furniture, angled
    // walls) would never surface a guide. The matched axis locks exactly to the
    // candidate's coordinate; the other axis keeps its grid snap. Alt bypasses.
    const alignPoint = (
      gridX: number,
      gridZ: number,
      rawX: number,
      rawZ: number,
      bypass: boolean,
    ): [number, number] => {
      if (bypass || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return [gridX, gridZ]
      }
      const ar = resolveAlignmentForActiveBuilding({
        moving: [{ nodeId: '__roof-draft__', kind: 'corner', x: rawX, z: rawZ }],
        candidates: alignmentCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      if (ar.guides.length === 0) {
        useAlignmentGuides.getState().clear()
        return [gridX, gridZ]
      }
      useAlignmentGuides.getState().set(ar.guides)
      let x = gridX
      let z = gridZ
      for (const guide of ar.guides) {
        if (guide.axis === 'x') x = guide.coord
        else z = guide.coord
      }
      return [x, z]
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

      // World-grid snap projected into building-local; rotated buildings
      // used to drag every roof corner off the visible grid.
      const bypassSnap = event.nativeEvent?.shiftKey === true
      const snapped: [number, number] = bypassSnap
        ? [event.localPosition[0], event.localPosition[2]]
        : snapWorldXZForActiveBuilding(
            event.position[0],
            event.position[2],
            useEditor.getState().gridSnapStep,
          ).local
      const [gridX, gridZ] = alignPoint(
        snapped[0],
        snapped[1],
        event.localPosition[0],
        event.localPosition[2],
        event.nativeEvent?.altKey === true || bypassSnap,
      )
      const y = event.localPosition[1]

      const cursorPosition: [number, number, number] = [gridX, y, gridZ]
      const gridY = y + GRID_OFFSET

      cursorRef.current.position.set(gridX, gridY, gridZ)

      if (
        !bypassSnap &&
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

      // World-grid snap projected into building-local; rotated buildings
      // used to drag every roof corner off the visible grid.
      const bypassSnap = event.nativeEvent?.shiftKey === true
      const snapped: [number, number] = bypassSnap
        ? [event.localPosition[0], event.localPosition[2]]
        : snapWorldXZForActiveBuilding(
            event.position[0],
            event.position[2],
            useEditor.getState().gridSnapStep,
          ).local
      const [gridX, gridZ] = alignPoint(
        snapped[0],
        snapped[1],
        event.localPosition[0],
        event.localPosition[2],
        event.nativeEvent?.altKey === true || bypassSnap,
      )
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
        alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', currentLevelId)
        useAlignmentGuides.getState().clear()
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
      useAlignmentGuides.getState().clear()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      useAlignmentGuides.getState().clear()

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

  const previewGeometry = useMemo(() => {
    if (!(previewDimensions && previewDimensions.length > 0.1 && previewDimensions.width > 0.1)) {
      return null
    }

    const segment = RoofSegmentNode.parse({
      wallHeight: DEFAULT_WALL_HEIGHT,
      pitch: DEFAULT_PITCH_DEG,
      roofType: 'gable',
      ...roofDefaults,
      width: previewDimensions.length,
      depth: previewDimensions.width,
      position: [0, 0, 0],
    })

    return createRoofDraftGeometry(segment)
  }, [previewDimensions, roofDefaults])

  useEffect(() => {
    return () => {
      previewGeometry?.solid.dispose()
      previewGeometry?.lines.dispose()
    }
  }, [previewGeometry])

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

      {previewDimensions && previewGeometry && (
        <group
          position={[previewDimensions.centerX, levelY + GRID_OFFSET, previewDimensions.centerZ]}
        >
          <mesh
            geometry={previewGeometry.solid}
            layers={EDITOR_LAYER}
            raycast={() => {}}
            renderOrder={2}
          >
            <meshBasicMaterial
              color={ROOF_GHOST_COLOR}
              depthTest={false}
              depthWrite={false}
              opacity={0.15}
              side={DoubleSide}
              transparent
            />
          </mesh>
          <lineSegments
            frustumCulled={false}
            geometry={previewGeometry.lines}
            layers={EDITOR_LAYER}
            raycast={() => {}}
            renderOrder={3}
          >
            <lineBasicNodeMaterial
              color={ROOF_GHOST_COLOR}
              depthTest={false}
              depthWrite={false}
              opacity={0.5}
              transparent
            />
          </lineSegments>
        </group>
      )}
    </group>
  )
}
