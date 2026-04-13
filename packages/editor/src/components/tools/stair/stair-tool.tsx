import {
  type AnyNode,
  emitter,
  type GridEvent,
  type LevelNode,
  StairNode,
  StairSegmentNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'
import {
  DEFAULT_STAIR_ATTACHMENT_SIDE,
  DEFAULT_STAIR_FILL_TO_FLOOR,
  DEFAULT_STAIR_HEIGHT,
  DEFAULT_STAIR_LENGTH,
  DEFAULT_STAIR_RAILING_HEIGHT,
  DEFAULT_STAIR_RAILING_MODE,
  DEFAULT_STAIR_STEP_COUNT,
  DEFAULT_STAIR_THICKNESS,
  DEFAULT_STAIR_WIDTH,
} from './stair-defaults'

const GRID_OFFSET = 0.02

/**
 * Generates the step-profile geometry for the ghost preview.
 * Same algorithm as StairSystem's generateStairSegmentGeometry.
 */
function createStairPreviewGeometry(): THREE.BufferGeometry {
  const riserHeight = DEFAULT_STAIR_HEIGHT / DEFAULT_STAIR_STEP_COUNT
  const treadDepth = DEFAULT_STAIR_LENGTH / DEFAULT_STAIR_STEP_COUNT

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)

  for (let i = 0; i < DEFAULT_STAIR_STEP_COUNT; i++) {
    shape.lineTo(i * treadDepth, (i + 1) * riserHeight)
    shape.lineTo((i + 1) * treadDepth, (i + 1) * riserHeight)
  }

  // Fill to floor (absoluteHeight = 0)
  shape.lineTo(DEFAULT_STAIR_LENGTH, 0)
  shape.lineTo(0, 0)

  const geometry = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth: DEFAULT_STAIR_WIDTH,
    bevelEnabled: false,
  })

  // Rotate so extrusion is along X (width), shape profile in XZ plane
  const matrix = new THREE.Matrix4()
  matrix.makeRotationY(-Math.PI / 2)
  matrix.setPosition(DEFAULT_STAIR_WIDTH / 2, 0, 0)
  geometry.applyMatrix4(matrix)

  return geometry
}

/**
 * Creates a stair group with one default stair segment at the given position/rotation.
 */
function commitStairPlacement(
  levelId: LevelNode['id'],
  position: [number, number, number],
  rotation: number,
): void {
  const { createNodes, nodes } = useScene.getState()

  const stairCount = Object.values(nodes).filter((n) => n.type === 'stair').length
  const name = `Staircase ${stairCount + 1}`

  const segment = StairSegmentNode.parse({
    segmentType: 'stair',
    width: DEFAULT_STAIR_WIDTH,
    length: DEFAULT_STAIR_LENGTH,
    height: DEFAULT_STAIR_HEIGHT,
    stepCount: DEFAULT_STAIR_STEP_COUNT,
    attachmentSide: DEFAULT_STAIR_ATTACHMENT_SIDE,
    fillToFloor: DEFAULT_STAIR_FILL_TO_FLOOR,
    thickness: DEFAULT_STAIR_THICKNESS,
    position: [0, 0, 0],
  })

  const stair = StairNode.parse({
    name,
    position,
    rotation,
    railingHeight: DEFAULT_STAIR_RAILING_HEIGHT,
    railingMode: DEFAULT_STAIR_RAILING_MODE,
    children: [segment.id],
  })

  createNodes([
    { node: stair, parentId: levelId },
    { node: segment, parentId: stair.id },
  ])

  sfxEmitter.emit('sfx:structure-build')
}

export const StairTool: React.FC = () => {
  const cursorRef = useRef<THREE.Group>(null)
  const previewRef = useRef<THREE.Group>(null)
  const rotationRef = useRef(0)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const currentLevelId = useViewer((state) => state.selection.levelId)

  const previewGeometry = useMemo(() => createStairPreviewGeometry(), [])

  useEffect(() => {
    if (!currentLevelId) return

    // Reset rotation when tool activates
    rotationRef.current = 0
    if (previewRef.current) previewRef.current.rotation.y = 0

    const onGridMove = (event: GridEvent) => {
      const gridX = Math.round(event.localPosition[0] * 2) / 2
      const gridZ = Math.round(event.localPosition[2] * 2) / 2
      const y = event.localPosition[1]

      if (cursorRef.current) {
        cursorRef.current.position.set(gridX, y + GRID_OFFSET, gridZ)
      }

      if (previewRef.current) {
        previewRef.current.position.set(gridX, y, gridZ)
      }

      if (
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]
    }

    const onGridClick = (event: GridEvent) => {
      if (!currentLevelId) return

      const gridX = Math.round(event.localPosition[0] * 2) / 2
      const gridZ = Math.round(event.localPosition[2] * 2) / 2
      const y = event.localPosition[1]

      commitStairPlacement(currentLevelId, [gridX, y, gridZ], rotationRef.current)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const ROTATION_STEP = Math.PI / 4
      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        sfxEmitter.emit('sfx:item-rotate')
        rotationRef.current += rotationDelta
        if (previewRef.current) {
          previewRef.current.rotation.y = rotationRef.current
        }
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [currentLevelId])

  return (
    <group>
      <CursorSphere ref={cursorRef} />

      {/* 3D ghost preview — position/rotation updated imperatively */}
      <group ref={previewRef}>
        <mesh castShadow geometry={previewGeometry}>
          <meshStandardMaterial color="#818cf8" depthWrite={false} opacity={0.35} transparent />
        </mesh>
      </group>
    </group>
  )
}
