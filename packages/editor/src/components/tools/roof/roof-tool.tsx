import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  type LevelNode,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { BufferGeometry, DoubleSide, type Group, type Line, Vector3 } from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const DEFAULT_WALL_HEIGHT = 0.5
const DEFAULT_ROOF_HEIGHT = 2.5
const GRID_OFFSET = 0.02

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
      width,
      depth,
      wallHeight: DEFAULT_WALL_HEIGHT,
      roofHeight: DEFAULT_ROOF_HEIGHT,
      roofType: 'gable',
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
    width,
    depth,
    wallHeight: DEFAULT_WALL_HEIGHT,
    roofHeight: DEFAULT_ROOF_HEIGHT,
    roofType: 'gable',
    position: [0, 0, 0],
  })

  // Create the roof container
  const roof = RoofNode.parse({
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

export const RoofTool: React.FC = () => {
  const cursorRef = useRef<Group>(null)
  const outlineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const setSelection = useViewer((state) => state.setSelection)
  const setTool = useEditor((state) => state.setTool)
  const setMode = useEditor((state) => state.setMode)

  const selectedIdsRef = useRef(selectedIds)
  useEffect(() => {
    selectedIdsRef.current = selectedIds
  }, [selectedIds])

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

      const gridX = Math.round(event.localPosition[0] * 2) / 2
      const gridZ = Math.round(event.localPosition[2] * 2) / 2
      const y = event.localPosition[1]

      const cursorPosition: [number, number, number] = [gridX, y, gridZ]
      const gridY = y + GRID_OFFSET

      cursorRef.current.position.set(gridX, gridY, gridZ)

      if (
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

      const gridX = Math.round(event.localPosition[0] * 2) / 2
      const gridZ = Math.round(event.localPosition[2] * 2) / 2
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
      } else {
        corner1Ref.current = [gridX, y, gridZ]
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
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)

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
        <mesh
          layers={EDITOR_LAYER}
          position={[previewDimensions.centerX, levelY + GRID_OFFSET, previewDimensions.centerZ]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[previewDimensions.length, previewDimensions.width]} />
          <meshBasicMaterial
            color="#818cf8"
            depthTest={false}
            depthWrite={false}
            opacity={0.1}
            side={DoubleSide}
            transparent
          />
        </mesh>
      )}
    </group>
  )
}
