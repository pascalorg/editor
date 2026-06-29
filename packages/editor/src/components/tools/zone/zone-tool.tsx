import {
  DEFAULT_ANGLE_STEP,
  emitter,
  type GridEvent,
  type LevelNode,
  snapPointAlongAngleRay,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
import { EDITOR_LAYER } from './../../../lib/constants'
import { sfxEmitter } from './../../../lib/sfx-bus'
import { snapWorldXZForActiveBuilding } from './../../../lib/world-grid-snap'
import useEditor, { isAngleSnapActive, isGridSnapActive } from './../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const Y_OFFSET = 0.02

/**
 * Creates a zone with the given polygon points
 */
const commitZoneDrawing = (levelId: LevelNode['id'], points: Array<[number, number]>) => {
  const { createNode, nodes } = useScene.getState()

  // Count existing zones for naming and color cycling
  const zoneCount = Object.values(nodes).filter((n) => n.type === 'zone').length
  const name = `Zone ${zoneCount + 1}`

  // Default to blue, cycle through palette for subsequent zones
  const color = '#3b82f6'

  const zone = ZoneNode.parse({
    name,
    polygon: points,
    color,
  })

  createNode(zone, levelId)

  // Select the newly created zone
  useViewer.getState().setSelection({ zoneId: zone.id })

  // Play structure build sound
  sfxEmitter.emit('sfx:structure-build')
}

type PreviewState = {
  points: Array<[number, number]>
  cursorPoint: [number, number] | null
  levelY: number
}

// Helper to validate point values (no NaN or Infinity)
const isValidPoint = (pt: [number, number] | null | undefined): pt is [number, number] => {
  if (!pt) return false
  return Number.isFinite(pt[0]) && Number.isFinite(pt[1])
}

export const ZoneTool: React.FC = () => {
  const cursorRef = useRef<Group>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const pointsRef = useRef<Array<[number, number]>>([])
  const previousSnappedPointRef = useRef<[number, number] | null>(null)
  const levelYRef = useRef(0) // Track current level Y position
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const setTool = useEditor((state) => state.setTool)

  // Preview state for reactive rendering (for shape and point markers)
  const [preview, setPreview] = useState<PreviewState>({
    points: [],
    cursorPoint: null,
    levelY: 0,
  })

  useEffect(() => {
    if (!currentLevelId) return

    let cursorPosition: [number, number] = [0, 0]
    let rawCursorPosition: [number, number] = [0, 0]

    // Initialize line geometries
    mainLineRef.current.geometry = new BufferGeometry()
    closingLineRef.current.geometry = new BufferGeometry()

    // Snapping follows the active mode (zone resolves to the 'wall' context):
    // `angles` locks the ray to 15° from the last vertex, `grid` quantizes the
    // distance along it, `lines` / `off` leave the raw cursor. No held-Shift
    // bypass — Shift cycles the mode (see interaction-scope.md).
    const snapDraftPoint = (
      lastPoint: [number, number],
      _gridPoint: [number, number],
      rawPoint: [number, number],
    ): [number, number] => {
      const angleStep = isAngleSnapActive() ? DEFAULT_ANGLE_STEP : 0
      const gridStep = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      if (angleStep === 0 && gridStep === 0) return rawPoint
      const [x, z] = snapPointAlongAngleRay(lastPoint, rawPoint, angleStep, gridStep)
      return [x, z]
    }

    const updateLines = () => {
      const points = pointsRef.current
      const y = levelYRef.current + Y_OFFSET

      if (points.length === 0) {
        mainLineRef.current.visible = false
        closingLineRef.current.visible = false
        return
      }

      // Build main line points
      const linePoints: Vector3[] = points.map(([x, z]) => new Vector3(x, y, z))

      // Add cursor point
      const lastPoint = points[points.length - 1]
      if (lastPoint) {
        const snapped = snapDraftPoint(lastPoint, cursorPosition, rawCursorPosition)
        if (isValidPoint(snapped)) {
          linePoints.push(new Vector3(snapped[0], y, snapped[1]))
        }
      }

      // Update main line geometry
      if (linePoints.length >= 2) {
        mainLineRef.current.geometry.dispose()
        mainLineRef.current.geometry = new BufferGeometry().setFromPoints(linePoints)
        mainLineRef.current.visible = true
      } else {
        mainLineRef.current.visible = false
      }

      // Update closing line (from cursor back to first point)
      const firstPoint = points[0]
      if (points.length >= 2 && lastPoint && isValidPoint(firstPoint)) {
        const snapped = snapDraftPoint(lastPoint, cursorPosition, rawCursorPosition)
        if (isValidPoint(snapped)) {
          const closingPoints = [
            new Vector3(snapped[0], y, snapped[1]),
            new Vector3(firstPoint[0], y, firstPoint[1]),
          ]
          closingLineRef.current.geometry.dispose()
          closingLineRef.current.geometry = new BufferGeometry().setFromPoints(closingPoints)
          closingLineRef.current.visible = true
        }
      } else {
        closingLineRef.current.visible = false
      }
    }

    const updatePreview = () => {
      const points = pointsRef.current
      const lastPoint = points[points.length - 1]

      let cursorPt: [number, number] | null = null
      if (lastPoint) {
        cursorPt = snapDraftPoint(lastPoint, cursorPosition, rawCursorPosition)
      } else if (points.length === 0) {
        cursorPt = cursorPosition
      }

      setPreview({ points: [...points], cursorPoint: cursorPt, levelY: levelYRef.current })
      updateLines()
    }

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return

      // World-grid snap projected into building-local; rotated buildings
      // used to pull the snap off the visible grid lines. Grid quantize only
      // in grid mode; off / lines / angles leave the raw cursor for the first
      // vertex (later vertices snap along the ray in `snapDraftPoint`).
      const [gridX, gridZ] = isGridSnapActive()
        ? snapWorldXZForActiveBuilding(
            event.position[0],
            event.position[2],
            useEditor.getState().gridSnapStep,
          ).local
        : [event.localPosition[0], event.localPosition[2]]
      cursorPosition = [gridX, gridZ]
      rawCursorPosition = [event.localPosition[0], event.localPosition[2]]
      levelYRef.current = event.localPosition[1]

      // If we have points, snap to the 15° ray from the last point
      const lastPoint = pointsRef.current[pointsRef.current.length - 1]
      const displayPoint = lastPoint
        ? snapDraftPoint(lastPoint, cursorPosition, rawCursorPosition)
        : cursorPosition

      // Play snap sound when the snapped position changes during drawing — only
      // when a quantizing mode is active (off / lines move continuously).
      if (
        (isGridSnapActive() || isAngleSnapActive()) &&
        pointsRef.current.length > 0 &&
        previousSnappedPointRef.current &&
        (displayPoint[0] !== previousSnappedPointRef.current[0] ||
          displayPoint[1] !== previousSnappedPointRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }
      previousSnappedPointRef.current = displayPoint

      cursorRef.current.position.set(displayPoint[0], event.localPosition[1], displayPoint[1])

      updatePreview()
    }

    const onGridClick = (event: GridEvent) => {
      if (!currentLevelId) return

      const [gridX, gridZ] = isGridSnapActive()
        ? snapWorldXZForActiveBuilding(
            event.position[0],
            event.position[2],
            useEditor.getState().gridSnapStep,
          ).local
        : [event.localPosition[0], event.localPosition[2]]
      let clickPoint: [number, number] = [gridX, gridZ]

      // Snap to the 15° ray from the last point
      const lastPoint = pointsRef.current[pointsRef.current.length - 1]
      if (lastPoint) {
        clickPoint = snapDraftPoint(lastPoint, clickPoint, [
          event.localPosition[0],
          event.localPosition[2],
        ])
      }

      // Check if clicking on the first point to close the shape
      const firstPoint = pointsRef.current[0]
      if (
        pointsRef.current.length >= 3 &&
        firstPoint &&
        Math.abs(clickPoint[0] - firstPoint[0]) < 0.25 &&
        Math.abs(clickPoint[1] - firstPoint[1]) < 0.25
      ) {
        // Create the zone
        commitZoneDrawing(currentLevelId, pointsRef.current)

        // Reset state
        pointsRef.current = []
        setPreview({ points: [], cursorPoint: null, levelY: levelYRef.current })
        mainLineRef.current.visible = false
        closingLineRef.current.visible = false
      } else {
        // Add point to polygon. Every non-closing vertex is a "start" tick;
        // closing the polygon above fires the structure-build (end) cue.
        sfxEmitter.emit('sfx:structure-build-start')
        pointsRef.current = [...pointsRef.current, clickPoint]
        updatePreview()
      }
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      if (!currentLevelId) return

      // Need at least 3 points to form a polygon
      if (pointsRef.current.length >= 3) {
        commitZoneDrawing(currentLevelId, pointsRef.current)

        // Reset state
        pointsRef.current = []
        setPreview({ points: [], cursorPoint: null, levelY: levelYRef.current })
        mainLineRef.current.visible = false
        closingLineRef.current.visible = false
      }
    }

    // Subscribe to events
    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('grid:double-click', onGridDoubleClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('grid:double-click', onGridDoubleClick)

      // Reset state on unmount
      pointsRef.current = []
    }
  }, [currentLevelId])

  const { points, cursorPoint, levelY } = preview

  // Create preview shape when we have 3+ points
  const previewShape = useMemo(() => {
    if (points.length < 3) return null

    const allPoints = [...points]
    if (isValidPoint(cursorPoint)) {
      allPoints.push(cursorPoint)
    }

    // THREE.Shape is in X-Y plane. After rotation of -PI/2 around X:
    // - Shape X -> World X
    // - Shape Y -> World -Z (so we negate Z to get correct orientation)
    const firstPt = allPoints[0]
    if (!isValidPoint(firstPt)) return null

    const shape = new Shape()
    shape.moveTo(firstPt[0], -firstPt[1])

    for (let i = 1; i < allPoints.length; i++) {
      const pt = allPoints[i]
      if (isValidPoint(pt)) {
        shape.lineTo(pt[0], -pt[1])
      }
    }
    shape.closePath()

    return shape
  }, [points, cursorPoint])

  return (
    <group>
      {/* Cursor */}
      <CursorSphere ref={cursorRef} />

      {/* Preview fill */}
      {previewShape && (
        <mesh
          frustumCulled={false}
          layers={EDITOR_LAYER}
          position={[0, levelY + Y_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#818cf8"
            depthTest={false}
            opacity={0.15}
            side={DoubleSide}
            transparent
          />
        </mesh>
      )}

      {/* Main line - uses native line element with TSL-compatible material */}
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={mainLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial color="#818cf8" depthTest={false} depthWrite={false} linewidth={3} />
      </line>

      {/* Closing line - uses native line element with TSL-compatible material */}
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={closingLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.5}
          transparent
        />
      </line>

      {/* Point markers */}
      {points.map(([x, z], index) =>
        isValidPoint([x, z]) ? (
          <CursorSphere
            color="#818cf8"
            height={0}
            key={index}
            position={[x, levelY + Y_OFFSET + 0.01, z]}
            showTooltip={false}
          />
        ) : null,
      )}
    </group>
  )
}
