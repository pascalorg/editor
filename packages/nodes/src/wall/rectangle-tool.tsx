'use client'
import {
  emitter,
  type GridEvent,
  useScene,
  type WallNode,
  type WallPlanPoint,
  wallRectangleCorners,
} from '@pascal-app/core'
import {
  CursorSphere,
  clearPlacementSurface,
  DRAFT_LABEL_Y_OFFSET,
  DraftMeasurementLabel,
  EDITOR_LAYER,
  formatLinearMeasurement,
  isMagneticSnapActive,
  markToolCancelConsumed,
  NO_RAYCAST,
  publishHorizontalConstructionPlane,
  resolveEventConstructionPlane,
  snapWallDraftPointDetailed,
  triggerSFX,
  useEditor,
  useInteractionScope,
  useLinearDisplay,
  useRegistryToolContext,
  useWallSnapIndicator,
} from '@pascal-app/editor'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { DoubleSide } from 'three'
import { createWallRectangle } from './rectangle-command'

export default function RectangleWallTool() {
  const { activeLevelId, isCameraDragging } = useRegistryToolContext()
  const canvas = useThree((s) => s.gl.domElement)
  const { isImperial } = useLinearDisplay('m', 2)
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  const measurementColor = isDark ? '#ffffff' : '#111111'
  const measurementShadowColor = isDark ? '#111111' : '#ffffff'
  const defaults = useEditor((s) => s.toolDefaults.wall)
  const [draft, setDraft] = useState<{
    start: WallPlanPoint
    end: WallPlanPoint
    y: number
  } | null>(null)
  const [message, setMessage] = useState('')
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)
  const levelHeight = useScene((s) =>
    activeLevelId && s.nodes[activeLevelId]?.type === 'level' ? s.nodes[activeLevelId].height : 3,
  )
  const height = typeof defaults?.height === 'number' ? defaults.height : (levelHeight ?? 3)
  const thickness = typeof defaults?.thickness === 'number' ? defaults.thickness : 0.1
  useEffect(() => {
    if (!activeLevelId) return
    setDraft(null)
    setMessage('')
    let start: WallPlanPoint | null = null
    let plane: ReturnType<typeof resolveEventConstructionPlane> | null = null
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'wall' })
    const pointFor = (e: GridEvent) => {
      const result = snapWallDraftPointDetailed({
        point: [e.localPosition[0], e.localPosition[2]],
        walls: Object.values(useScene.getState().nodes).filter(
          (n): n is WallNode => n.type === 'wall' && n.parentId === activeLevelId,
        ),
        magnetic: isMagneticSnapActive(),
      })
      useWallSnapIndicator.getState().set(
        result.snap
          ? {
              x: result.point[0],
              z: result.point[1],
              kind: result.snap,
              wallIds: result.targetWallIds,
            }
          : null,
      )
      return result.point
    }
    const move = (e: GridEvent) => {
      if (e.nativeEvent.target !== canvas || isCameraDragging()) return
      const point = pointFor(e)
      const hoverPlane = plane ?? resolveEventConstructionPlane(e, null)
      if (plane) publishHorizontalConstructionPlane(e, plane)
      setCursor([point[0], hoverPlane.localY, point[1]])
      setMessage('')
      if (start) setDraft({ start, end: point, y: hoverPlane.localY })
    }
    const leave = () => {
      setCursor(null)
      useWallSnapIndicator.getState().clear()
    }
    const cancel = () => {
      if (start) markToolCancelConsumed()
      start = null
      plane = null
      setDraft(null)
      setMessage('')
      leave()
      clearPlacementSurface()
    }
    const click = (e: GridEvent) => {
      if (e.nativeEvent.target !== canvas || e.nativeEvent.button !== 0 || isCameraDragging())
        return
      const point = pointFor(e)
      if (!start) {
        start = point
        plane = resolveEventConstructionPlane(e, null)
        publishHorizontalConstructionPlane(e, plane)
        setCursor([point[0], plane.localY, point[1]])
        setDraft({ start, end: point, y: plane.localY })
        setMessage('')
        return
      }
      try {
        createWallRectangle(
          activeLevelId,
          start,
          point,
          useEditor.getState().toolDefaults.wall ?? {},
          {
            constructionElevation: plane?.elevation,
            preferredSupportSlabId: plane?.supportSlabId,
            constructionHeight: height,
          },
        )
        cancel()
        triggerSFX('sfx:structure-build')
      } catch (error) {
        setMessage((error as Error).message)
      }
    }
    emitter.on('grid:move', move)
    emitter.on('grid:click', click)
    emitter.on('tool:cancel', cancel)
    canvas.addEventListener('pointerleave', leave)
    return () => {
      emitter.off('grid:move', move)
      emitter.off('grid:click', click)
      emitter.off('tool:cancel', cancel)
      canvas.removeEventListener('pointerleave', leave)
      useWallSnapIndicator.getState().clear()
      clearPlacementSurface()
      useInteractionScope.getState().endIf((s) => s.kind === 'drafting' && s.tool === 'wall')
    }
  }, [activeLevelId, height, canvas, isCameraDragging])
  const corners = draft ? wallRectangleCorners(draft.start, draft.end) : []
  const unit = isImperial ? 'imperial' : 'metric'
  // Label the two sides meeting at the cursor corner, as the floor plan does.
  const cursorIndex = draft
    ? corners.findIndex(([x, z]) => x === draft.end[0] && z === draft.end[1])
    : -1
  const sideLabels =
    draft && cursorIndex >= 0
      ? [cursorIndex + 3, cursorIndex].map((side) => {
          const a = corners[side % 4]!
          const b = corners[(side + 1) % 4]!
          return {
            label: formatLinearMeasurement(Math.hypot(b[0] - a[0], b[1] - a[1]), unit),
            position: [
              (a[0] + b[0]) / 2,
              draft.y + height + DRAFT_LABEL_Y_OFFSET,
              (a[1] + b[1]) / 2,
            ] as [number, number, number],
          }
        })
      : []
  return (
    <group>
      <CursorSphere
        name="rectangle-wall-cursor"
        height={height}
        position={cursor ?? [0, 0, 0]}
        visible={!!cursor}
      />
      {corners.map((a, i) => {
        const b = corners[(i + 1) % 4]!
        return (
          <mesh
            key={i}
            layers={EDITOR_LAYER}
            raycast={NO_RAYCAST}
            renderOrder={1}
            position={[(a[0] + b[0]) / 2, draft!.y + height / 2, (a[1] + b[1]) / 2]}
            rotation={[0, -Math.atan2(b[1] - a[1], b[0] - a[0]), 0]}
          >
            <boxGeometry args={[Math.hypot(b[0] - a[0], b[1] - a[1]), height, thickness]} />
            <meshBasicMaterial
              color={message ? '#ef4444' : '#818cf8'}
              depthTest={false}
              depthWrite={false}
              opacity={0.5}
              side={DoubleSide}
              transparent
            />
          </mesh>
        )
      })}
      {draft && message ? (
        <DraftMeasurementLabel
          color="#ef4444"
          label={message}
          position={[draft.end[0], draft.y + height + DRAFT_LABEL_Y_OFFSET, draft.end[1]]}
          shadowColor={measurementShadowColor}
        />
      ) : (
        sideLabels.map((side, index) => (
          <DraftMeasurementLabel
            color={measurementColor}
            key={index}
            label={side.label}
            position={side.position}
            shadowColor={measurementShadowColor}
          />
        ))
      )}
    </group>
  )
}
