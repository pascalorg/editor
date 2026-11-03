'use client'

import {
  DEFAULT_ANGLE_STEP,
  emitter,
  parseDimension,
  type GridEvent,
  type LevelNode,
  resolveSlabPlacementElevation,
  snapPointAlongAngleRay,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  clearPlacementSurface,
  clearSlabSnapFeedback,
  DimensionInput,
  LocalizedHtml as Html,
  type DimensionInputState,
  EDITOR_LAYER,
  type HorizontalConstructionPlane,
  isAngleSnapActive,
  isGridSnapActive,
  isTypingTarget,
  markToolCancelConsumed,
  publishHorizontalConstructionPlane,
  publishPlacementSurface,
  resampleTerrainConstructionPlane,
  resolveEventConstructionPlane,
  resolveLevelConstructionPlane,
  resolvePointerSupportSurface,
  resolveSlabPlanPointSnap,
  triggerSFX,
  useDimensionDraftStore,
  useEditor,
  useFloorplanDraftPreview,
  visibleScene,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
import { type SlabCompletionTrigger, shouldRegistryCommitSlab } from './placement-ownership'
import { SlabNode } from './schema'

/**
 * Phase 5 Stage D — slab placement tool (kind-owned via `def.tool`).
 *
 * Multi-click polygon drawing: each click adds a vertex; clicking near
 * the first vertex (or double-clicking) closes the polygon and creates
 * the slab. Shift-modifier defeats the 15° angle snap during drag.
 * Supports dynamic dimension input (length & angle) for precise vertex placement.
 */

const Y_OFFSET = 0.02
const SURFACE_UP = new Vector3(0, 1, 0)
const surfacePointScratch = new Vector3()

function commitSlabDrawing(
  levelId: LevelNode['id'],
  points: Array<[number, number]>,
  baseElevation: number | null,
): string {
  const { createNode, nodes } = useScene.getState()
  const slabCount = Object.values(nodes).filter((n) => n.type === 'slab').length
  const name = `Slab ${slabCount + 1}`
  const defaults = useEditor.getState().toolDefaults.slab ?? {}
  const authored = SlabNode.parse({ ...defaults, name, polygon: points })
  const slab = {
    ...authored,
    elevation: resolveSlabPlacementElevation(authored, baseElevation),
  }
  createNode(slab, levelId)
  triggerSFX('sfx:structure-build')
  return slab.id
}

export const SlabTool: React.FC = () => {
  const cursorRef = useRef<Group>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((s) => s.selection.levelId)
  const setSelection = useViewer((s) => s.setSelection)
  const slabDefaults = useEditor((s) => s.toolDefaults.slab)
  const isRecessed = slabDefaults?.recessed === true
  const camera = useThree((state) => state.camera)
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  const [points, setPoints] = useState<Array<[number, number]>>([])
  const [cursorPosition, setCursorPosition] = useState<[number, number]>([0, 0])
  const [snappedCursorPosition, setSnappedCursorPosition] = useState<[number, number]>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const previousSnappedPointRef = useRef<[number, number] | null>(null)
  const constructionPlaneRef = useRef<HorizontalConstructionPlane | null>(null)
  const dimStore = useDimensionDraftStore()

  // Clear preset-seeded defaults on deactivation so a later manual slab draw
  // isn't built with a stale preset's parameters. Unmount-only.
  useEffect(() => () => useEditor.getState().setToolDefaults('slab', null), [])

  useEffect(
    () => () => {
      clearSlabSnapFeedback()
      clearPlacementSurface()
      useDimensionDraftStore.getState().reset()
    },
    [],
  )

  // Publish the live vertex count so the HUD shows "Finish" only at ≥ 3 points.
  useEffect(() => {
    useEditor.getState().setDraftVertexCount(points.length)
  }, [points.length])
  useEffect(() => () => useEditor.getState().setDraftVertexCount(0), [])

  useEffect(() => {
    useFloorplanDraftPreview.getState().setPolygonDraft('slab', points)
  }, [points])
  useEffect(
    () => () => {
      const draftPreview = useFloorplanDraftPreview.getState()
      if (draftPreview.polygonDraftType === 'slab') {
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
      (currentDim.lengthValue ? parseDimension(currentDim.lengthValue) : null)
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
      activeTool: 'slab',
    })

    setPoints((prev) => [...prev, nextPoint])
    triggerSFX('sfx:structure-build-start')
  }, [points, snappedCursorPosition])

  useEffect(() => {
    if (!currentLevelId) return

    const pointedSurfaceFor = (event: GridEvent) =>
      event.nativeEvent?.target instanceof HTMLCanvasElement
        ? resolvePointerSupportSurface(cameraRef.current, event.position)
        : null

    const resetDraft = () => {
      setPoints([])
      constructionPlaneRef.current = null
      previousSnappedPointRef.current = null
      clearSlabSnapFeedback()
      clearPlacementSurface()
      useDimensionDraftStore.getState().reset()
    }

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return
      const pointed = points.length === 0 && !isRecessed ? pointedSurfaceFor(event) : null
      const plane =
        constructionPlaneRef.current ?? (isRecessed ? resolveLevelConstructionPlane() : null)
      if (plane) {
        publishHorizontalConstructionPlane(event, plane)
      } else if (pointed) {
        publishPlacementSurface(
          surfacePointScratch.set(event.position[0], pointed.worldY, event.position[2]),
          SURFACE_UP,
        )
      }

      const localPosition = pointed?.localPoint ?? event.localPosition
      const rawPoint: [number, number] = [localPosition[0], localPosition[2]]
      const gridStep = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const gridPosition: [number, number] = [...snapPointToGrid(rawPoint, gridStep)]
      setCursorPosition(gridPosition)
      const lastPoint = points[points.length - 1]
      const orthoPoint: [number, number] =
        isAngleSnapActive() && lastPoint
          ? [...snapPointAlongAngleRay(lastPoint, rawPoint, DEFAULT_ANGLE_STEP, gridStep)]
          : gridPosition
      let displayPoint = resolveSlabPlanPointSnap({
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

      const hoverPlane =
        plane ??
        resampleTerrainConstructionPlane(
          resolveEventConstructionPlane(event, pointed),
          displayPoint,
        )
      setLevelY(hoverPlane.localY)
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
      cursorRef.current.position.set(displayPoint[0], hoverPlane.localY, displayPoint[1])
    }

    const onGridClick = (event: GridEvent) => {
      if (!currentLevelId) return
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
        if (shouldRegistryCommitSlab(visibleScene(useEditor.getState()), 'grid')) {
          const slabId = commitSlabDrawing(
            currentLevelId,
            points,
            constructionPlaneRef.current?.elevation ?? null,
          )
          setSelection({ selectedIds: [slabId] })
        }
        resetDraft()
      } else {
        if (points.length === 0) {
          const plane = isRecessed
            ? (resolveLevelConstructionPlane() ?? resolveEventConstructionPlane(event, null))
            : resampleTerrainConstructionPlane(
                resolveEventConstructionPlane(event, pointedSurfaceFor(event)),
                clickPoint,
              )
          constructionPlaneRef.current = plane
          setLevelY(plane.localY)
          publishHorizontalConstructionPlane(event, plane)
          useDimensionDraftStore.getState().startDraft(clickPoint, 'slab')
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
            activeTool: 'slab',
          })
          return next
        })
      }
    }

    const finishDrawing = (trigger: SlabCompletionTrigger) => {
      if (points.length < 3) return
      if (shouldRegistryCommitSlab(visibleScene(useEditor.getState()), trigger)) {
        const slabId = commitSlabDrawing(
          currentLevelId,
          points,
          constructionPlaneRef.current?.elevation ?? null,
        )
        setSelection({ selectedIds: [slabId] })
      }
      resetDraft()
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      finishDrawing('grid')
    }

    const onCancel = () => {
      const dimState = useDimensionDraftStore.getState()
      if (dimState.lengthValue !== '' || dimState.angleValue !== '') {
        useDimensionDraftStore.getState().setValues('', '')
        return
      }
      if (points.length > 0) markToolCancelConsumed()
      resetDraft()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (e.key === 'Enter') {
        e.preventDefault()
        finishDrawing('keyboard')
      }
    }
    document.addEventListener('keydown', onKeyDown)

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('grid:double-click', onGridDoubleClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('grid:double-click', onGridDoubleClick)
      emitter.off('tool:cancel', onCancel)
      useDimensionDraftStore.getState().reset()
    }
  }, [currentLevelId, points, cursorPosition, isRecessed, setSelection])

  useEffect(() => {
    if (!(mainLineRef.current && closingLineRef.current)) return
    if (points.length === 0) {
      mainLineRef.current.visible = false
      closingLineRef.current.visible = false
      return
    }
    const y = levelY + Y_OFFSET
    const snappedCursor = snappedCursorPosition
    const linePoints: Vector3[] = points.map(([x, z]) => new Vector3(x, y, z))
    linePoints.push(new Vector3(snappedCursor[0], y, snappedCursor[1]))
    if (linePoints.length >= 2) {
      mainLineRef.current.geometry.dispose()
      mainLineRef.current.geometry = new BufferGeometry().setFromPoints(linePoints)
      mainLineRef.current.visible = true
    } else {
      mainLineRef.current.visible = false
    }
    const firstPoint = points[0]
    if (points.length >= 2 && firstPoint) {
      const closingPoints = [
        new Vector3(snappedCursor[0], y, snappedCursor[1]),
        new Vector3(firstPoint[0], y, firstPoint[1]),
      ]
      closingLineRef.current.geometry.dispose()
      closingLineRef.current.geometry = new BufferGeometry().setFromPoints(closingPoints)
      closingLineRef.current.visible = true
    } else {
      closingLineRef.current.visible = false
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
      {points.map(([x, z], index) => (
        <CursorSphere
          color="#818cf8"
          height={0}
          key={index}
          position={[x, levelY + Y_OFFSET + 0.01, z]}
          showTooltip={false}
        />
      ))}

      {/* Floating Dimension Input for Slab */}
      {typeof document !== 'undefined' && typeof document.createElement === 'function' && dimStore.points.length > 0 && points.length > 0 && points[points.length - 1] && (
        <Html
          center
          position={[
            points[points.length - 1]![0],
            levelY + Y_OFFSET + 0.3,
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

export default SlabTool
