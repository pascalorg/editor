import {
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  type LevelNode,
  resolveAlignment,
  StairNode,
  StairSegmentNode,
  useAlignmentGuides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'
import { getFloorStackPreviewPosition } from '../shared/floor-stack-preview'
import {
  DEFAULT_CURVED_STAIR_INNER_RADIUS,
  DEFAULT_CURVED_STAIR_SWEEP_ANGLE,
  DEFAULT_SPIRAL_SHOW_CENTER_COLUMN,
  DEFAULT_SPIRAL_SHOW_STEP_SUPPORTS,
  DEFAULT_SPIRAL_TOP_LANDING_DEPTH,
  DEFAULT_SPIRAL_TOP_LANDING_MODE,
  DEFAULT_STAIR_ATTACHMENT_SIDE,
  DEFAULT_STAIR_FILL_TO_FLOOR,
  DEFAULT_STAIR_HEIGHT,
  DEFAULT_STAIR_LENGTH,
  DEFAULT_STAIR_RAILING_HEIGHT,
  DEFAULT_STAIR_RAILING_MODE,
  DEFAULT_STAIR_STEP_COUNT,
  DEFAULT_STAIR_THICKNESS,
  DEFAULT_STAIR_TYPE,
  DEFAULT_STAIR_WIDTH,
} from './stair-defaults'

const GRID_OFFSET = 0.02
/** Figma-style alignment-snap threshold (meters), matching the move tools. */
const ALIGNMENT_THRESHOLD_M = 0.08

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
 * Creates a default straight stair segment.
 */
function createDefaultStairSegment() {
  return StairSegmentNode.parse({
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
}

function createDefaultStairNode({
  name,
  levelId,
  nextLevelId,
  position,
  rotation,
  segmentId,
}: {
  name: string
  levelId: LevelNode['id']
  nextLevelId: LevelNode['id']
  position: [number, number, number]
  rotation: number
  segmentId: StairSegmentNode['id']
}) {
  return StairNode.parse({
    name,
    position,
    rotation,
    stairType: DEFAULT_STAIR_TYPE,
    fromLevelId: levelId,
    toLevelId: nextLevelId,
    slabOpeningMode: 'destination',
    openingOffset: 0.08,
    width: DEFAULT_STAIR_WIDTH,
    totalRise: DEFAULT_STAIR_HEIGHT,
    stepCount: DEFAULT_STAIR_STEP_COUNT,
    thickness: DEFAULT_STAIR_THICKNESS,
    fillToFloor: DEFAULT_STAIR_FILL_TO_FLOOR,
    innerRadius: DEFAULT_CURVED_STAIR_INNER_RADIUS,
    sweepAngle: DEFAULT_CURVED_STAIR_SWEEP_ANGLE,
    topLandingMode: DEFAULT_SPIRAL_TOP_LANDING_MODE,
    topLandingDepth: DEFAULT_SPIRAL_TOP_LANDING_DEPTH,
    showCenterColumn: DEFAULT_SPIRAL_SHOW_CENTER_COLUMN,
    showStepSupports: DEFAULT_SPIRAL_SHOW_STEP_SUPPORTS,
    railingHeight: DEFAULT_STAIR_RAILING_HEIGHT,
    railingMode: DEFAULT_STAIR_RAILING_MODE,
    children: [segmentId],
  })
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
  const segment = createDefaultStairSegment()

  const sortedLevels = Object.values(nodes)
    .filter((node): node is LevelNode => node.type === 'level')
    .sort((left, right) => left.level - right.level)
  const currentLevelIndex = sortedLevels.findIndex((level) => level.id === levelId)
  const nextLevelId = sortedLevels[currentLevelIndex + 1]?.id ?? levelId

  const stair = createDefaultStairNode({
    name,
    levelId,
    nextLevelId,
    position,
    rotation,
    segmentId: segment.id,
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
  const lastCanonicalPositionRef = useRef<[number, number, number] | null>(null)
  const currentLevelId = useViewer((state) => state.selection.levelId)

  const previewGeometry = useMemo(() => createStairPreviewGeometry(), [])

  useEffect(() => {
    if (!currentLevelId) return

    // Reset rotation when tool activates
    rotationRef.current = 0
    if (previewRef.current) previewRef.current.rotation.y = 0
    lastCanonicalPositionRef.current = null

    const getPreviewPosition = (
      position: [number, number, number],
      rotation: number,
    ): [number, number, number] => {
      const segment = createDefaultStairSegment()
      const stair = createDefaultStairNode({
        name: 'Staircase Preview',
        levelId: currentLevelId,
        nextLevelId: currentLevelId,
        position,
        rotation,
        segmentId: segment.id,
      })
      return getFloorStackPreviewPosition({
        node: stair,
        position,
        rotation,
        levelId: currentLevelId,
        nodes: {
          ...useScene.getState().nodes,
          [stair.id]: stair,
          [segment.id]: segment,
        },
      })
    }

    const applyPreview = (position: [number, number, number], rotation: number) => {
      const visualPosition = getPreviewPosition(position, rotation)
      if (cursorRef.current) {
        cursorRef.current.position.set(
          visualPosition[0],
          visualPosition[1] + GRID_OFFSET,
          visualPosition[2],
        )
      }

      if (previewRef.current) {
        previewRef.current.position.set(...visualPosition)
        previewRef.current.rotation.y = rotation
      }
    }

    // Alignment candidates — anchors of every alignable object; refreshed
    // after each placement. The stair aligns by its ORIGIN point.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', currentLevelId)
    // Snap the stair origin onto another object's nearest real anchor and
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
      const ar = resolveAlignment({
        moving: [{ nodeId: '__stair-draft__', kind: 'corner', x: rawX, z: rawZ }],
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

    const onGridMove = (event: GridEvent) => {
      const [gridX, gridZ] = alignPoint(
        Math.round(event.localPosition[0] * 2) / 2,
        Math.round(event.localPosition[2] * 2) / 2,
        event.localPosition[0],
        event.localPosition[2],
        event.nativeEvent?.altKey === true,
      )
      const position: [number, number, number] = [gridX, 0, gridZ]
      lastCanonicalPositionRef.current = position
      applyPreview(position, rotationRef.current)

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

      const [gridX, gridZ] = alignPoint(
        Math.round(event.localPosition[0] * 2) / 2,
        Math.round(event.localPosition[2] * 2) / 2,
        event.localPosition[0],
        event.localPosition[2],
        event.nativeEvent?.altKey === true,
      )
      commitStairPlacement(currentLevelId, [gridX, 0, gridZ], rotationRef.current)
      alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', currentLevelId)
      useAlignmentGuides.getState().clear()
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
        if (lastCanonicalPositionRef.current) {
          applyPreview(lastCanonicalPositionRef.current, rotationRef.current)
        } else if (previewRef.current) {
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
      useAlignmentGuides.getState().clear()
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
