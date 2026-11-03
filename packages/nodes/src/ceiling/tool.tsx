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
  DimensionInput,
  type DimensionInputState,
  EDITOR_LAYER,
  isAngleSnapActive,
  isGridSnapActive,
  markToolCancelConsumed,
  resolveCeilingPlanPointSnap,
  triggerSFX,
  useDimensionDraftStore,
  useEditor,
  useFloorplanDraftPreview,
  visibleScene,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
import { mix, positionLocal } from 'three/tsl'
import { CeilingNode } from './schema'

/**
 * Phase 5 Stage D — ceiling placement tool (kind-owned via `def.tool`).
 *
 * Multi-click polygon drawing at the ceiling height (2.52m default)
 * with a vertical TSL-gradient connector + ground-shadow lines so the
 * draft is visible against both the ceiling plane and the floor.
 * Supports dynamic dimension input (length & angle) for vertex placement.
 */

const CEILING_HEIGHT = 2.52
const GRID_OFFSET = 0.02

function commitCeilingDrawing(levelId: LevelNode['id'], points: Array<[number, number]>): string {
  const { createNode, nodes } = useScene.getState()
  const ceilingCount = Object.values(nodes).filter((n) => n.type === 'ceiling').length
  const name = `Ceiling ${ceilingCount + 1}`
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
  const dimStore = useDimensionDraftStore()

  // Clear preset-seeded defaults on deactivation so a later manual ceiling draw
  // isn't built with a stale preset's parameters. Unmount-only.
  useEffect(() => () => useEditor.getState().setToolDefaults('ceiling', null), [])

  useEffect(
    () => () => {
      clearCeilingSnapFeedback()
      useDimensionDraftStore.getState().reset()
    },
    [],
  )

  // Publish the live vertex count so the HUD shows "Finish" only at >= 3 points.
  useEffect(() => {
    useEditor.getState().setDraftVertexCount(points.length)
  }, [points.length])
  useEffect(() => () => useEditor.getState().setDraftVertexCount(0), [])

  useEffect(() => {
    useFloorplanDraftPreview.getState().setPolygonDraft('ceiling', points)
  }, [points])
  useEffect(
    () => () => {
      const draftPreview = useFloorplanDraftPreview.getState()
      if (draftPreview.polygonDraftType === 'ceiling') {
        draftPreview.setPolygonDraft(null, [])
      }
      draftPreview.setCursorPoint(null)
    },
    [],
  )

  const handleDimChange = useCallback((state: DimensionInputState) => {
    useDimensionDraftStore.getState().setValues(state.lengthValue, state.angleValue)
  }, [])

  const handleDimCancel = useCallback(() => {
    useDimensionDraftStore.getState().setValues('', '')
  }, [])

  const handleDimConfirm = useCallback(() => {
    const currentDim = useDimensionDraftStore.getState()
    const lastPoint = points.length > 0 ? points[points.length - 1] : null
    if (!lastPoint) return

    const length =
      currentDim.lockedLength ??
      (currentDim.lengthValue ? parseFloat(currentDim.lengthValue) : null)
    if (length === null || Number.isNaN(length) || length <= 0) return

    let angle = currentDim.lockedAngle
    if (angle === null) {
      const curPt = snappedCursorPosition
      const dx = curPt[0] - lastPoint[0]
      const dz = curPt[1] - lastPoint[1]
      angle = dx === 0 && dz === 0 ? 0 : (Math.atan2(dz, dx) * 180) / Math.PI
    }

    const rad = (angle * Math.PI) / 180
    const nextPoint: [number, number] = [
      lastPoint[0] + Math.cos(rad) * length,
      lastPoint[1] + Math.sin(rad) * length,
    ]

    useDimensionDraftStore.setState({
      points: [...points, nextPoint],
      previewPoint: null,
      lengthValue: '',
      angleValue: '',
      lockedLength: null,
      lockedAngle: null,
      fieldType: 'length',
      activeTool: 'ceiling',
    })

    setPoints((prev) => [...prev, nextPoint])
    triggerSFX('sfx:structure-build-start')
  }, [points, snappedCursorPosition])

  const gradientOpacityNode = useMemo(
    () => mix(0.6, 0.0, positionLocal.y.div(CEILING_HEIGHT - GRID_OFFSET).clamp()),
    [],
  )

  useEffect(() => {
    if (!currentLevelId) return

    const planOwnsInput = () => visibleScene(useEditor.getState()) === '2d'

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && gridCursorRef.current) || planOwnsInput()) return
      const rawPoint: [number, number] = [event.localPosition[0], event.localPosition[2]]
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
      let displayPoint = resolveCeilingPlanPointSnap({
        rawPoint,
        fallbackPoint: orthoPoint,
        levelId: currentLevelId,
      }).point

      const currentDim = useDimensionDraftStore.getState()
      if (currentDim.lockedLength !== null && lastPoint) {
        const angle =
          currentDim.lockedAngle !== null
            ? currentDim.lockedAngle
            : (Math.atan2(displayPoint[1] - lastPoint[1], displayPoint[0] - lastPoint[0]) * 180) /
              Math.PI
        const rad = (angle * Math.PI) / 180
        displayPoint = [
          lastPoint[0] + Math.cos(rad) * currentDim.lockedLength,
          lastPoint[1] + Math.sin(rad) * currentDim.lockedLength,
        ]
      }

      useFloorplanDraftPreview.getState().setCursorPoint(displayPoint)
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
      if (!currentLevelId || planOwnsInput()) return
      let clickPoint = previousSnappedPointRef.current ?? cursorPosition
      const currentDim = useDimensionDraftStore.getState()
      if (currentDim.lockedLength !== null && points.length > 0) {
        const lastPoint = points[points.length - 1]
        if (lastPoint) {
          const angle =
            currentDim.lockedAngle !== null
              ? currentDim.lockedAngle
              : (Math.atan2(clickPoint[1] - lastPoint[1], clickPoint[0] - lastPoint[0]) * 180) /
                Math.PI
          const rad = (angle * Math.PI) / 180
          clickPoint = [
            lastPoint[0] + Math.cos(rad) * currentDim.lockedLength,
            lastPoint[1] + Math.sin(rad) * currentDim.lockedLength,
          ]
        }
      }

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
        useDimensionDraftStore.getState().reset()
      } else {
        if (points.length === 0) {
          useDimensionDraftStore.getState().startDraft(clickPoint, 'ceiling')
        }
        triggerSFX('sfx:structure-build-start')
        setPoints((prev) => {
          const next = [...prev, clickPoint]
          useDimensionDraftStore.setState({
            points: next,
            previewPoint: null,
            lengthValue: '',
            angleValue: '',
            lockedLength: null,
            lockedAngle: null,
            fieldType: 'length',
            activeTool: 'ceiling',
          })
          return next
        })
      }
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      if (!currentLevelId || planOwnsInput()) return
      if (points.length >= 3) {
        const ceilingId = commitCeilingDrawing(currentLevelId, points)
        setSelection({ selectedIds: [ceilingId] })
        setPoints([])
        clearCeilingSnapFeedback()
        useDimensionDraftStore.getState().reset()
      }
    }

    const onCancel = () => {
      const dimState = useDimensionDraftStore.getState()
      if (dimState.lengthValue !== '' || dimState.angleValue !== '') {
        useDimensionDraftStore.getState().setValues('', '')
        return
      }
      if (points.length > 0) markToolCancelConsumed()
      setPoints([])
      clearCeilingSnapFeedback()
      useDimensionDraftStore.getState().reset()
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
      useDimensionDraftStore.getState().reset()
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
      groundClosingLineRef.current.geometry = new BufferGeometry().setFromPoints(groundClosingPoints)
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
      <CursorSphere color="#818cf8" height={0} ref={gridCursorRef} showTooltip={false} />
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        geometry={
          new BufferGeometry().setFromPoints([
            new Vector3(0, 0, 0),
            new Vector3(0, CEILING_HEIGHT - GRID_OFFSET, 0),
          ])
        }
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={verticalLineRef}
        renderOrder={1}
      >
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
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

      {/* Floating Dimension Input for Ceiling */}
      {dimStore.points.length > 0 && points.length > 0 && points[points.length - 1] && (
        <Html
          center
          position={[
            points[points.length - 1]![0],
            levelY + CEILING_HEIGHT + 0.3,
            points[points.length - 1]![1],
          ]}
          style={{ pointerEvents: 'auto' }}
          zIndexRange={[100, 0]}
        >
          <DimensionInput
            state={{
              active: true,
              fieldType: dimStore.fieldType,
              lengthValue: dimStore.lengthValue,
              angleValue: dimStore.angleValue,
              lockedLength: dimStore.lockedLength,
              lockedAngle: dimStore.lockedAngle,
            }}
            onChange={handleDimChange}
            onConfirm={handleDimConfirm}
            onCancel={handleDimCancel}
          />
        </Html>
      )}
    </group>
  )
}

export default CeilingTool
