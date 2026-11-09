'use client'
import { type AnyNode, getWallThickness, sceneRegistry, useScene } from '@pascal-app/core'
import {
  DRAFT_LABEL_Y_OFFSET,
  DraftMeasurementLabel,
  EDITOR_LAYER,
  formatLinearMeasurement,
  NO_RAYCAST,
} from '@pascal-app/editor'
import { BATCHED_LAYER, getSceneTheme, SCENE_LAYER, useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Group, type Mesh, Raycaster, Vector2 } from 'three'
import { bindWallSplitPointer } from './split-pointer'
import { wallSplitDistance, wallSplitMarkerColor, wallSplitSegmentLabels } from './split-preview'
import { useWallSplit } from './split-store'

/**
 * The wall's `split` affordance (3D): cut markers, segment lengths and the
 * pointer binding. The session (`split-session.ts`) owns the scope and draft;
 * the plan layer renders the same draft.
 */
export default function WallSplitTool(_props: { node: AnyNode }) {
  const draft = useWallSplit((s) => s.draft)
  const wallId = draft?.wallId
  const wall = useScene((s) => (draft ? s.nodes[draft.wallId] : undefined))
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const isDark = useViewer((s) => getSceneTheme(s.sceneTheme).appearance === 'dark')
  const { gl, camera } = useThree()
  const root = useRef<Group>(null)
  const column = useRef<Group>(null)
  const top = useRef<Group>(null)
  const base = useRef<Group>(null)
  useEffect(() => {
    if (!wallId) return
    const surface = gl.domElement
    const raycaster = new Raycaster()
    raycaster.layers.set(SCENE_LAYER)
    raycaster.layers.enable(BATCHED_LAYER)
    const pointer = new Vector2()
    return bindWallSplitPointer(surface, (event) => {
      if (event.target !== surface) return null
      const current = useScene.getState().nodes[wallId]
      const object = sceneRegistry.nodes.get(wallId)
      if (current?.type !== 'wall' || !object?.parent) return null
      const rect = surface.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      )
      raycaster.setFromCamera(pointer, camera)
      object.updateWorldMatrix(true, true)
      const hit = raycaster.intersectObject(object, true)[0]
      if (!hit) return null
      const local = object.parent.worldToLocal(hit.point.clone())
      return wallSplitDistance(current, [local.x, local.z])
    })
  }, [wallId, gl, camera])
  useFrame(() => {
    if (!(root.current && column.current && top.current && base.current)) return
    if (wall?.type !== 'wall' || !draft) return
    const object = sceneRegistry.nodes.get(wall.id) as Mesh | undefined
    if (!object?.parent || !object.geometry) {
      root.current.visible = false
      return
    }
    root.current.visible = true
    object.updateWorldMatrix(true, false)
    root.current.matrix.copy(object.parent.matrixWorld)
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
    const bounds = object.geometry.boundingBox
    const bottom = object.position.y + (bounds?.min.y ?? 0)
    const height = bounds ? bounds.max.y - bounds.min.y : (wall.height ?? 3)
    column.current.position.y = bottom + height / 2
    column.current.scale.y = Math.max(0.05, height + 0.05)
    top.current.position.y = bottom + height + DRAFT_LABEL_Y_OFFSET
    base.current.position.y = bottom + 0.01
  })
  if (!draft || wall?.type !== 'wall') return null
  const { preview, snap } = draft
  const thickness = getWallThickness(wall)
  const color = wallSplitMarkerColor(preview.valid)
  const cut = preview.frames[0]?.point
  const guide =
    snap?.kind === 'alignment' && cut
      ? {
          x: (snap.anchor[0] + cut.x) / 2,
          z: (snap.anchor[1] + cut.y) / 2,
          length: Math.hypot(cut.x - snap.anchor[0], cut.y - snap.anchor[1]),
          angle: -Math.atan2(cut.y - snap.anchor[1], cut.x - snap.anchor[0]),
        }
      : null
  return (
    <group ref={root} matrixAutoUpdate={false}>
      <group ref={column}>
        {preview.frames.map(({ point, tangent }, index) => (
          <group
            key={index}
            position={[point.x, 0, point.y]}
            rotation={[0, -Math.atan2(tangent.y, tangent.x), 0]}
            userData={{ testId: 'pascal-split-marker', valid: preview.valid }}
          >
            <mesh
              layers={EDITOR_LAYER}
              raycast={NO_RAYCAST}
              renderOrder={8900}
              scale={[0.074, 1, thickness + 0.12]}
            >
              <boxGeometry />
              <meshBasicMaterial
                color={preview.valid ? '#f7f3ed' : '#faece9'}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            <mesh
              layers={EDITOR_LAYER}
              raycast={NO_RAYCAST}
              renderOrder={8910}
              scale={[0.026, 1.001, thickness + 0.07]}
            >
              <boxGeometry />
              <meshBasicMaterial
                color={color}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={top}>
        {/* Why a cut can't commit shows at the mark, where the HUD used to say it. */}
        {!preview.valid && cut ? (
          <DraftMeasurementLabel
            color={color}
            label={preview.message}
            position={[cut.x, 0, cut.y]}
            shadowColor={isDark ? '#111111' : '#ffffff'}
          />
        ) : (
          wallSplitSegmentLabels(wall, preview).map((segment, index) => (
            <DraftMeasurementLabel
              color={isDark ? '#ffffff' : '#111111'}
              key={index}
              label={`${formatLinearMeasurement(segment.length, unit, metricNotation)}${segment.count > 1 ? ` × ${segment.count}` : ''}`}
              position={[segment.midpoint[0], 0, segment.midpoint[1]]}
              shadowColor={isDark ? '#111111' : '#ffffff'}
            />
          ))
        )}
      </group>
      <group ref={base}>
        {guide && (
          <mesh
            layers={EDITOR_LAYER}
            position={[guide.x, 0, guide.z]}
            raycast={NO_RAYCAST}
            renderOrder={8890}
            rotation={[0, guide.angle, 0]}
            scale={[guide.length, 0.01, 0.02]}
          >
            <boxGeometry />
            <meshBasicMaterial
              color="#818cf8"
              depthTest={false}
              depthWrite={false}
              opacity={0.8}
              toneMapped={false}
              transparent
            />
          </mesh>
        )}
      </group>
    </group>
  )
}
