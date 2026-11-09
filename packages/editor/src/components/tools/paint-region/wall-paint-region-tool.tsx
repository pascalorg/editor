'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  sceneRegistry,
  useScene,
  type WallFace,
  type WallNode,
} from '@pascal-app/core'
import { getSceneTheme, setSurfaceRaycastLayers, useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  type Camera,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  Matrix4,
  type Mesh,
  type Object3D,
  Raycaster,
  Vector2,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import { formatLinearMeasurement } from '../../../lib/measurements'
import { paintRegionTargets, usePaintRegionMode } from '../../../lib/paint-region-mode'
import { isTypingTarget } from '../../../lib/typing-target'
import {
  activeWallRegionGesture,
  activeWallRegionTarget,
  cancelWallRegion,
  dragWallRegion,
  hoverWallRegion,
  pressWallRegion,
  releaseWallRegion,
  useWallPaintRegionSession,
  type WallRegionHit,
  type WallRegionPreview,
} from '../../../lib/wall-paint-region-session'
import {
  type FaceSpan,
  facePoint,
  faceSpanStrips,
  faceStripOutline,
  faceStripTriangles,
  projectLocalRayToFace,
  resolveWallFaceBase,
  wallFaceExtent,
  wallFaceFrame,
  wallHitFaceUV,
} from '../../../lib/wall-region-face'
import {
  DEFAULT_LINE_SNAP_TOLERANCE,
  faceBaseAt,
  resolveWallRegionSnapMode,
  type WallRegionSnap,
} from '../../../lib/wall-region-snap'
import useEditor, { isGridSnapActive, isMagneticSnapActive } from '../../../store/use-editor'
import { DraftMeasurementLabel } from '../shared/draft-measurement-label'
import { usePaintTint } from './use-paint-tint'

const DRAFT_COLOR = '#818cf8'
const CORNER_HALF_SIZE = 0.04
const FILL_OFFSET = 0.004
const LINE_OFFSET = 0.006

const noRaycast = () => {}
const overlayMaterial = (opacity: number) =>
  new MeshBasicNodeMaterial({
    color: DRAFT_COLOR,
    depthWrite: false,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: DoubleSide,
    transparent: true,
  })
const fillMaterial = overlayMaterial(0.35)
const lineMaterial = overlayMaterial(0.95)
const outlineMaterial = new LineBasicNodeMaterial({
  color: DRAFT_COLOR,
  depthWrite: false,
  transparent: true,
})

function wallRegionActive(): boolean {
  return paintRegionTargets(usePaintRegionMode.getState().mode).wall
}

function visibleSurface(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent)
    if (!node.visible || node.userData.wallHidden === true) return false
  return true
}

type PointerSample = Pick<PointerEvent, 'clientX' | 'clientY' | 'target' | 'altKey'>

const sample = (event: PointerSample): PointerSample => ({
  clientX: event.clientX,
  clientY: event.clientY,
  target: event.target,
  altKey: event.altKey,
})

function pointerRaycaster(event: PointerSample, canvas: HTMLCanvasElement, camera: Camera) {
  const bounds = canvas.getBoundingClientRect()
  const raycaster = new Raycaster()
  raycaster.setFromCamera(
    new Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    ),
    camera,
  )
  setSurfaceRaycastLayers(raycaster.layers)
  return raycaster
}

function regionHit(
  wall: WallNode,
  mesh: Mesh,
  face: WallFace,
  u: number,
  v: number,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): WallRegionHit {
  const faceBase = resolveWallFaceBase(wall, mesh.geometry, nodes)
  return {
    wallId: wall.id,
    face,
    u,
    v,
    length: Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]),
    extent: wallFaceExtent(wall, face, mesh.geometry),
    runs: faceBase?.[face] ?? null,
  }
}

/** The nearest visible wall face of the current level under the pointer. */
function hoverHit(raycaster: Raycaster): WallRegionHit | null {
  const levelId = useViewer.getState().selection.levelId
  const nodes = useScene.getState().nodes
  const level = levelId ? nodes[levelId as AnyNodeId] : undefined
  if (level?.type !== 'level') return null
  let best: {
    wall: WallNode
    mesh: Mesh
    distance: number
    hit: ReturnType<Raycaster['intersectObject']>[number]
  } | null = null
  for (const childId of level.children) {
    const wall = nodes[childId as AnyNodeId]
    if (wall?.type !== 'wall') continue
    const mesh = sceneRegistry.nodes.get(wall.id) as Mesh | undefined
    if (!(mesh?.isMesh && visibleSurface(mesh))) continue
    const hit = raycaster.intersectObject(mesh, false)[0]
    if (!hit || (best && hit.distance >= best.distance)) continue
    best = { wall, mesh, distance: hit.distance, hit }
  }
  if (!best) return null
  const local = best.mesh.worldToLocal(best.hit.point.clone())
  const normal = best.hit.face?.normal
  const faceBase = resolveWallFaceBase(best.wall, best.mesh.geometry, nodes)
  const uv = wallHitFaceUV(
    best.wall,
    [local.x, local.y, local.z],
    normal ? [normal.x, normal.y, normal.z] : undefined,
    faceBase,
  )
  // Below the face base the ray has already passed through the floor, which
  // the floor region gesture owns.
  if (!uv || uv.v < -0.01) return null
  return regionHit(best.wall, best.mesh, uv.face, uv.u, uv.v, nodes)
}

/** The pointer projected onto the pressed face, wherever it wanders. */
function dragHit(raycaster: Raycaster, target: { wallId: string; face: WallFace }) {
  const nodes = useScene.getState().nodes
  const wall = nodes[target.wallId as AnyNodeId]
  const mesh = sceneRegistry.nodes.get(target.wallId) as Mesh | undefined
  if (wall?.type !== 'wall' || !mesh) return null
  mesh.updateWorldMatrix(true, false)
  const ray = raycaster.ray.clone().applyMatrix4(new Matrix4().copy(mesh.matrixWorld).invert())
  const point = projectLocalRayToFace(
    wallFaceFrame(wall, target.face),
    [ray.origin.x, ray.origin.y, ray.origin.z],
    [ray.direction.x, ray.direction.y, ray.direction.z],
  )
  if (!point) return null
  const runs = resolveWallFaceBase(wall, mesh.geometry, nodes)?.[target.face] ?? null
  return regionHit(wall, mesh, target.face, point.u, point.y - faceBaseAt(runs, point.u), nodes)
}

function currentSnap(event: { altKey: boolean }): WallRegionSnap {
  return {
    mode: resolveWallRegionSnapMode({
      grid: isGridSnapActive(),
      magnetic: isMagneticSnapActive(),
      alt: event.altKey,
    }),
    gridStep: useEditor.getState().gridSnapStep,
    tolerance: DEFAULT_LINE_SNAP_TOLERANCE,
  }
}

/**
 * Pointer and keyboard wiring. Hover previews on every (frame-coalesced) move;
 * a left press on a wall face claims the pointer, drags on window listeners so
 * the gesture follows the pointer off the wall, and commits on release. Escape
 * (and ⌘Z) mid-gesture cancel it through `tool:cancel` without a write.
 */
function useWallRegionPointer(canvas: HTMLCanvasElement, camera: Camera) {
  useEffect(() => {
    let pressed: { pointerId: number } | null = null
    let frame = 0
    let pending: PointerEvent | null = null
    let last: PointerSample | null = null
    const dropPending = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      pending = null
    }
    const apply = (event: PointerSample) => {
      last = event
      if (!wallRegionActive()) return
      const raycaster = pointerRaycaster(event, canvas, camera)
      if (pressed) {
        const target = activeWallRegionTarget()
        const hit = target ? dragHit(raycaster, target) : null
        if (hit) dragWallRegion(hit, currentSnap(event))
        return
      }
      const idle = event.target === canvas && !useViewer.getState().cameraDragging
      hoverWallRegion(idle ? hoverHit(raycaster) : null, currentSnap(event))
    }
    const flush = () => {
      frame = 0
      const event = pending
      pending = null
      if (event) apply(sample(event))
    }
    const onMove = (event: PointerEvent) => {
      if (pressed && event.pointerId !== pressed.pointerId) return
      pending = event
      if (!frame) frame = requestAnimationFrame(flush) || 0
    }
    // Pointer capture is the gesture owner's; it releases it however the gesture ends.
    const endPress = () => {
      if (!pressed) return
      pressed = null
      dropPending()
      // The click the browser synthesizes from this release belongs to the gesture.
      setTimeout(() => useViewer.getState().setInputDragging(false), 0)
    }
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.target !== canvas || pressed) return
      if (useViewer.getState().cameraDragging) return
      if (!wallRegionActive()) return
      const hit = hoverHit(pointerRaycaster(event, canvas, camera))
      if (!hit) return
      event.preventDefault()
      event.stopPropagation()
      dropPending()
      if (!pressWallRegion(hit, currentSnap(event), endPress)) return
      pressed = { pointerId: event.pointerId }
      activeWallRegionGesture()?.capturePointer(canvas, event.pointerId)
      useViewer.getState().setInputDragging(true)
    }
    const onUp = (event: PointerEvent) => {
      if (!pressed || event.pointerId !== pressed.pointerId) return
      const final = pending
      dropPending()
      if (final) apply(sample(final))
      event.preventDefault()
      event.stopPropagation()
      endPress()
      releaseWallRegion()
      // Show what the next press would do without waiting for a move.
      if (last) apply(last)
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (!pressed || event.pointerId !== pressed.pointerId) return
      cancelWallRegion()
    }
    const onToolCancel = () => {
      if (!cancelWallRegion()) return
      markToolCancelConsumed()
    }
    // Alt frees the snap; pressing or letting go re-evaluates where the pointer is.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Alt' || isTypingTarget(event.target) || !last) return
      apply({ ...sample(last), altKey: event.type === 'keydown' })
    }
    canvas.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    emitter.on('tool:cancel', onToolCancel)
    return () => {
      cancelWallRegion()
      dropPending()
      useWallPaintRegionSession.setState({ preview: null })
      canvas.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onPointerCancel, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      emitter.off('tool:cancel', onToolCancel)
    }
  }, [canvas, camera])
}

function positions(array: Float32Array) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(array, 3))
  return geometry
}

type PreviewGeometry = {
  fill: BufferGeometry | null
  outline: BufferGeometry | null
  corner: BufferGeometry | null
  label: { position: [number, number, number]; values: number[] } | null
}

function buildPreviewGeometry(preview: WallRegionPreview, wall: WallNode): PreviewGeometry | null {
  const mesh = sceneRegistry.nodes.get(wall.id) as Mesh | undefined
  if (!mesh) return null
  const nodes = useScene.getState().nodes
  const frame = wallFaceFrame(wall, preview.face)
  const other = wallFaceFrame(wall, preview.face === 'a' ? 'b' : 'a')
  const extent = wallFaceExtent(wall, preview.face, mesh.geometry)
  const runs = resolveWallFaceBase(wall, mesh.geometry, nodes)?.[preview.face] ?? null
  const strips = (span: FaceSpan) => faceSpanStrips(frame, extent, runs, span)
  const fillStrips = preview.bounds ? strips(preview.bounds) : []
  // Where the box starts: the press point on hover, the pressed corner while dragging.
  const [cu, cv] = preview.corner
  const cornerStrips = strips({
    u0: cu - CORNER_HALF_SIZE,
    u1: cu + CORNER_HALF_SIZE,
    v0: Math.max(0, cv - CORNER_HALF_SIZE),
    v1: cv + CORNER_HALF_SIZE,
  })
  const { measure } = preview
  return {
    fill: fillStrips.length
      ? positions(faceStripTriangles(frame, other, fillStrips, FILL_OFFSET))
      : null,
    outline: fillStrips.length
      ? positions(faceStripOutline(frame, other, fillStrips, LINE_OFFSET))
      : null,
    corner: cornerStrips.length
      ? positions(faceStripTriangles(frame, other, cornerStrips, LINE_OFFSET))
      : null,
    label: measure?.values.every((value) => value > 0.005)
      ? {
          position: facePoint(
            frame,
            other,
            measure.u,
            faceBaseAt(runs, measure.u) + measure.v,
            0.05,
          ),
          values: measure.values,
        }
      : null,
  }
}

function WallRegionPreview3D() {
  const preview = useWallPaintRegionSession((state) => state.preview)
  const wall = useScene((state) => (preview ? state.nodes[preview.wallId as AnyNodeId] : undefined))
  const tint = usePaintTint(DRAFT_COLOR)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  const root = useRef<Group>(null)
  const geometry = useMemo(
    () => (preview && wall?.type === 'wall' ? buildPreviewGeometry(preview, wall) : null),
    [preview, wall],
  )
  useEffect(
    () => () => {
      geometry?.fill?.dispose()
      geometry?.outline?.dispose()
      geometry?.corner?.dispose()
    },
    [geometry],
  )
  useEffect(() => {
    fillMaterial.color.set(tint)
  }, [tint])
  useFrame(() => {
    const mesh = preview ? sceneRegistry.nodes.get(preview.wallId) : undefined
    if (!root.current) return
    root.current.visible = !!mesh
    if (mesh) {
      mesh.updateWorldMatrix(true, false)
      root.current.matrix.copy(mesh.matrixWorld)
    }
  })
  if (!geometry) return null
  const label = geometry.label
  const text = label
    ? label.values.map((value) => formatLinearMeasurement(value, unit, metricNotation)).join(' × ')
    : null
  return (
    <group matrixAutoUpdate={false} ref={root}>
      {geometry.fill && (
        <mesh
          geometry={geometry.fill}
          layers={EDITOR_LAYER}
          material={fillMaterial}
          raycast={noRaycast}
          renderOrder={100}
        />
      )}
      {geometry.outline && (
        <lineSegments
          geometry={geometry.outline}
          layers={EDITOR_LAYER}
          material={outlineMaterial}
          raycast={noRaycast}
          renderOrder={101}
        />
      )}
      {geometry.corner && (
        <mesh
          geometry={geometry.corner}
          layers={EDITOR_LAYER}
          material={lineMaterial}
          raycast={noRaycast}
          renderOrder={102}
        />
      )}
      {label && text && (
        <DraftMeasurementLabel
          color={isDark ? '#ffffff' : '#111111'}
          label={text}
          position={label.position}
          shadowColor={isDark ? '#111111' : '#ffffff'}
        />
      )}
    </group>
  )
}

/**
 * "Paint part of a surface" in 3D: a rectangle pressed anywhere on a wall face
 * of the current level and dragged to its opposite corner, while the paint
 * tool's Rectangle sub-mode is on.
 */
export function WallPaintRegionTool() {
  const { gl, camera } = useThree()
  useWallRegionPointer(gl.domElement, camera)
  return <WallRegionPreview3D />
}
