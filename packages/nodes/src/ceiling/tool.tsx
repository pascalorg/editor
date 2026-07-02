'use client'

import {
  DEFAULT_ANGLE_STEP,
  emitter,
  type GridEvent,
  type LevelNode,
  snapPointAlongAngleRay,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  clearCeilingSnapFeedback,
  EDITOR_LAYER,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isGridSnapActive,
  markToolCancelConsumed,
  resolveCeilingPlanPointSnap,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
import { mix, positionLocal } from 'three/tsl'
import { CeilingNode } from './schema'

/**
 * Phase 5 Stage D — ceiling placement tool (kind-owned via `def.tool`).
 *
 * Multi-click polygon drawing at the ceiling height (2.52m default)
 * with a vertical TSL-gradient connector + ground-shadow lines so the
 * draft is visible against both the ceiling plane and the floor.
 */

const CEILING_HEIGHT = 2.52
const GRID_OFFSET = 0.02

function commitCeilingDrawing(levelId: LevelNode['id'], points: Array<[number, number]>): string {
  const { createNode, nodes } = useScene.getState()
  const ceilingCount = Object.values(nodes).filter((n) => n.type === 'ceiling').length
  const name = `Ceiling ${ceilingCount + 1}`
  // A placed ceiling preset seeds `toolDefaults.ceiling` (thickness, height,
  // material, …) before the tool activates; the drawn polygon always wins.
  const defaults = useEditor.getState().toolDefaults.ceiling ?? {}
  const ceiling = CeilingNode.parse({ ...defaults, name, polygon: points })
  createNode(ceiling, levelId)
  triggerSFX('sfx:structure-build')
  return ceiling.id
}

export const CeilingTool: React.FC = () => {
  const cursorRef = useRef<Group>(null)
  const gridCursorRef = useRef<Group>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const groundMainLineRef = useRef<Line>(null!)
  const groundClosingLineRef = useRef<Line>(null!)
  const verticalLineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((s) => s.selection.levelId)
  const setSelection = useViewer((s) => s.setSelection)

  const [points, setPoints] = useState<Array<[number, number]>>([])
  const [cursorPosition, setCursorPosition] = useState<[number, number]>([0, 0])
  const [snappedCursorPosition, setSnappedCursorPosition] = useState<[number, number]>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const previousSnappedPointRef = useRef<[number, number] | null>(null)

  // Clear preset-seeded defaults on deactivation so a later manual ceiling
  // draw isn't built with a stale preset's parameters. Unmount-only.
  useEffect(() => () => useEditor.getState().setToolDefaults('ceiling', null), [])

  useEffect(() => () => clearCeilingSnapFeedback(), [])

  // Publish the live vertex count so the HUD shows "Finish" only at ≥ 3 points.
  useEffect(() => {
    useEditor.getState().setDraftVertexCount(points.length)
  }, [points.length])
  useEffect(() => () => useEditor.getState().setDraftVertexCount(0), [])

  const verticalGeo = useMemo(
    () =>
      new BufferGeometry().setFromPoints([
        new Vector3(0, 0, 0),
        new Vector3(0, CEILING_HEIGHT - GRID_OFFSET, 0),
      ]),
    [],
  )

  const gradientOpacityNode = useMemo(
    () => mix(0.6, 0.0, positionLocal.y.div(CEILING_HEIGHT - GRID_OFFSET).clamp()),
    [],
  )

  useEffect(() => {
    if (!currentLevelId) return

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && gridCursorRef.current)) return
      const rawPoint: [number, number] = [event.localPosition[0], event.localPosition[2]]
      // Honour the active snapping mode: grid lattice + 15° angle lock are each
      // gated on the mode (off / lines → free), like the slab tool.
      const gridStep = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const gridPosition: [number, number] = [...snapPointToGrid(rawPoint, gridStep)]
      setCursorPosition(gridPosition)
      setLevelY(event.localPosition[1])
      const ceilingY = event.localPosition[1] + CEILING_HEIGHT
      const gridY = event.localPosition[1] + GRID_OFFSET
      const lastPoint = points[points.length - 1]
      const orthoPoint: [number, number] =
        isAngleSnapActive() && lastPoint
          ? [...snapPointAlongAngleRay(lastPoint, rawPoint, DEFAULT_ANGLE_STEP, gridStep)]
          : gridPosition
      const displayPoint = resolveCeilingPlanPointSnap({
        rawPoint,
        fallbackPoint: orthoPoint,
        levelId: currentLevelId,
        altKey: !isAlignmentGuideActive(),
      }).point
      setSnappedCursorPosition(displayPoint)
      if (
        points.length > 0 &&
        previousSnappedPointRef.current &&
        (displayPoint[0] !== previousSnappedPointRef.current[0] ||
          displayPoint[1] !== previousSnappedPointRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousSnappedPointRef.current = displayPoint
      cursorRef.current.position.set(displayPoint[0], ceilingY, displayPoint[1])
      gridCursorRef.current.position.set(displayPoint[0], gridY, displayPoint[1])
      if (verticalLineRef.current) {
        verticalLineRef.current.position.set(displayPoint[0], gridY, displayPoint[1])
      }
    }

    const onGridClick = (_event: GridEvent) => {
      if (!currentLevelId) return
      const clickPoint = previousSnappedPointRef.current ?? cursorPosition
      const firstPoint = points[0]
      if (
        points.length >= 3 &&
        firstPoint &&
        Math.abs(clickPoint[0] - firstPoint[0]) < 0.25 &&
        Math.abs(clickPoint[1] - firstPoint[1]) < 0.25
      ) {
        const ceilingId = commitCeilingDrawing(currentLevelId, points)
        setSelection({ selectedIds: [ceilingId] })
        setPoints([])
        clearCeilingSnapFeedback()
      } else {
        // Every non-closing vertex is a "start" tick; the closing click above
        // fires the structure-build (end) cue.
        triggerSFX('sfx:structure-build-start')
        setPoints([...points, clickPoint])
      }
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      if (!currentLevelId) return
      if (points.length >= 3) {
        const ceilingId = commitCeilingDrawing(currentLevelId, points)
        setSelection({ selectedIds: [ceilingId] })
        setPoints([])
        clearCeilingSnapFeedback()
      }
    }

    const onCancel = () => {
      if (points.length > 0) markToolCancelConsumed()
      setPoints([])
      clearCeilingSnapFeedback()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('grid:double-click', onGridDoubleClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('grid:double-click', onGridDoubleClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [currentLevelId, points, cursorPosition, setSelection])

  useEffect(() => {
    if (!(mainLineRef.current && closingLineRef.current)) return
    if (points.length === 0) {
      mainLineRef.current.visible = false
      closingLineRef.current.visible = false
      if (groundMainLineRef.current) groundMainLineRef.current.visible = false
      if (groundClosingLineRef.current) groundClosingLineRef.current.visible = false
      return
    }
    const ceilingY = levelY + CEILING_HEIGHT
    const snappedCursor = snappedCursorPosition
    const linePoints: Vector3[] = points.map(([x, z]) => new Vector3(x, ceilingY, z))
    linePoints.push(new Vector3(snappedCursor[0], ceilingY, snappedCursor[1]))
    const gridY = levelY + GRID_OFFSET
    const groundLinePoints: Vector3[] = points.map(([x, z]) => new Vector3(x, gridY, z))
    groundLinePoints.push(new Vector3(snappedCursor[0], gridY, snappedCursor[1]))
    if (linePoints.length >= 2) {
      mainLineRef.current.geometry.dispose()
      mainLineRef.current.geometry = new BufferGeometry().setFromPoints(linePoints)
      mainLineRef.current.visible = true
      groundMainLineRef.current.geometry.dispose()
      groundMainLineRef.current.geometry = new BufferGeometry().setFromPoints(groundLinePoints)
      groundMainLineRef.current.visible = true
    } else {
      mainLineRef.current.visible = false
      groundMainLineRef.current.visible = false
    }
    const firstPoint = points[0]
    if (points.length >= 2 && firstPoint) {
      const closingPoints = [
        new Vector3(snappedCursor[0], ceilingY, snappedCursor[1]),
        new Vector3(firstPoint[0], ceilingY, firstPoint[1]),
      ]
      closingLineRef.current.geometry.dispose()
      closingLineRef.current.geometry = new BufferGeometry().setFromPoints(closingPoints)
      closingLineRef.current.visible = true
      const groundClosingPoints = [
        new Vector3(snappedCursor[0], gridY, snappedCursor[1]),
        new Vector3(firstPoint[0], gridY, firstPoint[1]),
      ]
      groundClosingLineRef.current.geometry.dispose()
      groundClosingLineRef.current.geometry = new BufferGeometry().setFromPoints(
        groundClosingPoints,
      )
      groundClosingLineRef.current.visible = true
    } else {
      closingLineRef.current.visible = false
      groundClosingLineRef.current.visible = false
    }
  }, [points, snappedCursorPosition, levelY])

  const previewShape = useMemo(() => {
    if (points.length < 3) return null
    const snappedCursor = snappedCursorPosition
    const allPoints = [...points, snappedCursor]
    const firstPt = allPoints[0]
    if (!firstPt) return null
    const shape = new Shape()
    shape.moveTo(firstPt[0], -firstPt[1])
    for (let i = 1; i < allPoints.length; i++) {
      const pt = allPoints[i]
      if (pt) shape.lineTo(pt[0], -pt[1])
    }
    shape.closePath()
    return shape
  }, [points, snappedCursorPosition])

  return (
    <group>
      <CursorSphere ref={cursorRef} />
      <mesh
        layers={EDITOR_LAYER}
        ref={gridCursorRef}
        renderOrder={2}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.15, 0.2, 32]} />
        <meshBasicMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={true}
          opacity={0.5}
          side={DoubleSide}
          transparent
        />
      </mesh>
      {/* @ts-ignore */}
      <line geometry={verticalGeo} layers={EDITOR_LAYER} ref={verticalLineRef} renderOrder={1}>
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          opacityNode={gradientOpacityNode}
          transparent
        />
      </line>
      {previewShape && (
        <mesh
          frustumCulled={false}
          layers={EDITOR_LAYER}
          position={[0, levelY + CEILING_HEIGHT, 0]}
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
      {previewShape && (
        <mesh
          frustumCulled={false}
          layers={EDITOR_LAYER}
          position={[0, levelY + GRID_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#818cf8"
            depthTest={false}
            opacity={0.1}
            side={DoubleSide}
            transparent
          />
        </mesh>
      )}
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
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={groundMainLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={3}
          opacity={0.3}
          transparent
        />
      </line>
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={groundClosingLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.15}
          transparent
        />
      </line>
      {points.map(([x, z], index) => (
        <CursorSphere
          color="#818cf8"
          key={index}
          position={[x, levelY + CEILING_HEIGHT + 0.01, z]}
          showTooltip={false}
        />
      ))}
    </group>
  )
}

export default CeilingTool
