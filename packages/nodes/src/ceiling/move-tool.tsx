'use client'

import {
  type AnyNodeId,
  type CeilingNode,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  polygonAnchors,
  resolveAlignment,
  sceneRegistry,
  snapScalar,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  consumePlacementDragRelease,
  isAlignmentGuideActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import { BufferGeometry, DoubleSide, Path, Shape, ShapeGeometry, Vector3 } from 'three'

/**
 * Phase 5 Stage D — ceiling whole-move tool.
 *
 * Live-drag pattern: translate the ceiling MESH visually via
 * `sceneRegistry.nodes.get(id).position` + a mirror in
 * `useLiveTransforms`. No `scene.update` during the drag — polygon CSG
 * with holes isn't rebuilt per tick. On commit we write the translated
 * polygon to the scene once; the legacy `CeilingSystem` resets the
 * mesh's X/Z position on rebuild (`mesh.position.x = 0`,
 * `mesh.position.z = 0`) so the visual transitions smoothly.
 *
 * Snaps to the editor's configured grid step.
 */
function snap(value: number) {
  return snapScalar(value, useEditor.getState().gridSnapStep)
}

/** Figma-style alignment-snap threshold (meters), matching the other tools. */
const ALIGNMENT_THRESHOLD_M = 0.08

function translatePolygon(
  polygon: Array<[number, number]>,
  deltaX: number,
  deltaZ: number,
): Array<[number, number]> {
  return polygon.map(([x, z]) => [x + deltaX, z + deltaZ] as [number, number])
}

function getPolygonCenter(polygon: Array<[number, number]>): [number, number] {
  if (polygon.length === 0) return [0, 0]
  let sumX = 0
  let sumZ = 0
  for (const [x, z] of polygon) {
    sumX += x
    sumZ += z
  }
  return [sumX / polygon.length, sumZ / polygon.length]
}

function setMeshOffset(id: AnyNodeId, deltaX: number, deltaZ: number, height: number): void {
  const mesh = sceneRegistry.nodes.get(id) as THREE.Object3D | undefined
  // CeilingSystem positions the mesh at height−0.01 on rebuild; we
  // preserve the Y while offsetting X/Z during the drag.
  if (mesh) mesh.position.set(deltaX, height - 0.01, deltaZ)
}

/**
 * Distinguish 3D-canvas grid events (this tool) from 2D floor-plan
 * grid events (`ceilingFloorplanMoveTarget` + `FloorplanRegistryMoveOverlay`
 * Path 1). See the equivalent helper in `slab/move-tool.tsx` for the
 * full rationale.
 */
function isFloorplanSourcedEvent(event: GridEvent): boolean {
  const native: unknown = event.nativeEvent
  const candidate =
    (native as { target?: unknown; nativeEvent?: { target?: unknown } } | null) ?? null
  const target =
    (candidate?.target as Element | null | undefined) ??
    (candidate?.nativeEvent as { target?: Element | null } | undefined)?.target ??
    null
  if (!target || typeof (target as Element).closest !== 'function') return false
  return (target as Element).closest('[data-floorplan-scene]') != null
}

export const MoveCeilingTool: React.FC<{ node: CeilingNode }> = ({ node }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const originalPolygonRef = useRef(node.polygon.map(([x, z]) => [x, z] as [number, number]))
  const originalHolesRef = useRef(
    (node.holes ?? []).map((hole) => hole.map(([x, z]) => [x, z] as [number, number])),
  )
  const originalCenterRef = useRef(getPolygonCenter(originalPolygonRef.current))
  const heightRef = useRef(node.height ?? 2.5)
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const deltaRef = useRef<[number, number]>([0, 0])

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const c = originalCenterRef.current
    return [c[0], heightRef.current, c[1]]
  })

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    const originalPolygon = originalPolygonRef.current
    const originalHoles = originalHolesRef.current
    const originalCenter = originalCenterRef.current
    const height = heightRef.current
    const ceilingId = node.id

    // Alignment candidates — every other alignable object's anchors,
    // gathered once (the scene graph is stable during the drag).
    const alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, ceilingId)

    let wasCommitted = false

    const applyPreview = (deltaX: number, deltaZ: number) => {
      deltaRef.current = [deltaX, deltaZ]
      setMeshOffset(ceilingId as AnyNodeId, deltaX, deltaZ, height)
      // Aligned with slab/fence: the delta matches the direct mesh
      // mutation. CeilingRenderer also consumes this store so external
      // movers can preview ceilings without rebuilding the polygon.
      useLiveTransforms.getState().set(ceilingId, {
        position: [deltaX, 0, deltaZ],
        rotation: 0,
      })
      setCursorLocalPos([originalCenter[0] + deltaX, height, originalCenter[1] + deltaZ])
    }

    const clearPreview = () => {
      const mesh = sceneRegistry.nodes.get(ceilingId as AnyNodeId) as THREE.Object3D | undefined
      if (mesh) {
        mesh.position.x = 0
        mesh.position.z = 0
        // Leave Y at whatever the CeilingSystem set it to.
      }
      useLiveTransforms.getState().clear(ceilingId)
    }

    const onGridMove = (event: GridEvent) => {
      if (isFloorplanSourcedEvent(event)) return
      const localX = snap(event.localPosition[0])
      const localZ = snap(event.localPosition[2])

      if (
        previousGridPosRef.current &&
        (localX !== previousGridPosRef.current[0] || localZ !== previousGridPosRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousGridPosRef.current = [localX, localZ]

      const anchor = dragAnchorRef.current ?? [localX, localZ]
      dragAnchorRef.current = anchor

      let deltaX = localX - anchor[0]
      let deltaZ = localZ - anchor[1]

      // Figma-style alignment snap: align the ceiling's translated polygon
      // vertices to other objects' anchors and publish a guide. Guides are
      // DISPLAYED in every snapping mode (isAlignmentGuideActive); the magnetic
      // pull into the delta applies only in 'lines' mode (isMagneticSnapActive).
      if (isAlignmentGuideActive() && alignmentCandidates.length > 0) {
        const result = resolveAlignment({
          moving: polygonAnchors(ceilingId, translatePolygon(originalPolygon, deltaX, deltaZ)),
          candidates: alignmentCandidates,
          threshold: ALIGNMENT_THRESHOLD_M,
        })
        if (result.snap && isMagneticSnapActive()) {
          deltaX += result.snap.dx
          deltaZ += result.snap.dz
        }
        useAlignmentGuides.getState().set(result.guides)
      } else {
        useAlignmentGuides.getState().clear()
      }

      applyPreview(deltaX, deltaZ)
    }

    const onGridClick = (event: GridEvent) => {
      if (wasCommitted) return
      if (isFloorplanSourcedEvent(event)) return
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const [deltaX, deltaZ] = deltaRef.current
      wasCommitted = true

      if (deltaX !== 0 || deltaZ !== 0) {
        useScene.getState().updateNode(ceilingId, {
          polygon: translatePolygon(originalPolygon, deltaX, deltaZ),
          holes: originalHoles.map((h) => translatePolygon(h, deltaX, deltaZ)),
        })
        useScene.getState().markDirty(ceilingId as AnyNodeId)
      }
      useLiveTransforms.getState().clear(ceilingId)
      useAlignmentGuides.getState().clear()

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [ceilingId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      activatedAtRef.current = 0
      onGridClick({ nativeEvent: event } as unknown as GridEvent)
    }

    const onCancel = () => {
      clearPreview()
      useAlignmentGuides.getState().clear()
      useViewer.getState().setSelection({ selectedIds: [ceilingId] })
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      useAlignmentGuides.getState().clear()
      if (!wasCommitted) {
        clearPreview()
      } else {
        useLiveTransforms.getState().clear(ceilingId)
      }
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
    }
  }, [exitMoveMode, node.id])

  return (
    <CeilingMovePreview
      ceilingId={node.id}
      cursorLocalPos={cursorLocalPos}
      height={node.height ?? 2.5}
      originalHoles={originalHolesRef.current}
      originalPolygon={originalPolygonRef.current}
    />
  )
}

/**
 * Translucent fill + bright outline showing where the ceiling will land
 * during the drag. Mirrors the legacy `MoveCeilingTool` overlay so the
 * 3D viewer has a visible cue from above (the ceiling's child grid mesh
 * is hidden by default — without this preview the only mesh that shows
 * from above is the (translated) translucent ceiling itself, which is
 * easy to miss). Works for both the 3D `grid:move` path (this tool
 * writes `useLiveTransforms.position = [Δx, 0, Δz]` directly) and the
 * 2D floor-plan move path (`slab/ceiling/floorplan-move.ts` writes the
 * same value); we subscribe to that store so the preview tracks the
 * current delta regardless of which mover is driving it.
 */
function CeilingMovePreview({
  ceilingId,
  cursorLocalPos,
  height,
  originalHoles,
  originalPolygon,
}: {
  ceilingId: AnyNodeId
  cursorLocalPos: [number, number, number]
  height: number
  originalHoles: Array<Array<[number, number]>>
  originalPolygon: Array<[number, number]>
}) {
  const live = useLiveTransforms((s) => s.get(ceilingId))
  const dx = live?.position[0] ?? 0
  const dz = live?.position[2] ?? 0

  const previewPolygon = useMemo(
    () => originalPolygon.map(([x, z]) => [x + dx, z + dz] as [number, number]),
    [originalPolygon, dx, dz],
  )
  const previewHoles = useMemo(
    () => originalHoles.map((hole) => hole.map(([x, z]) => [x + dx, z + dz] as [number, number])),
    [originalHoles, dx, dz],
  )

  const previewFillGeometry = useMemo(
    () => createCeilingPreviewGeometry(previewPolygon, previewHoles),
    [previewPolygon, previewHoles],
  )
  const previewOutlineGeometry = useMemo(
    () => createCeilingOutlineGeometry(previewPolygon),
    [previewPolygon],
  )

  return (
    <group>
      <mesh geometry={previewFillGeometry} position={[0, height + 0.012, 0]}>
        <meshBasicMaterial
          color="#f5f5f4"
          depthWrite={false}
          opacity={0.3}
          side={DoubleSide}
          transparent
        />
      </mesh>
      {/* @ts-ignore - `<line>` is a valid R3F intrinsic but conflicts with SVG line typing */}
      <line geometry={previewOutlineGeometry} position={[0, height + 0.02, 0]}>
        <lineBasicMaterial color="#ffffff" depthWrite={false} opacity={0.95} transparent />
      </line>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}

function createCeilingPreviewGeometry(
  polygon: Array<[number, number]>,
  holes: Array<Array<[number, number]>>,
): BufferGeometry {
  if (polygon.length < 3) return new BufferGeometry()

  const shape = new Shape()
  const first = polygon[0]!
  shape.moveTo(first[0], -first[1])
  for (let i = 1; i < polygon.length; i++) {
    const pt = polygon[i]!
    shape.lineTo(pt[0], -pt[1])
  }
  shape.closePath()

  for (const holePolygon of holes) {
    if (holePolygon.length < 3) continue
    const hole = new Path()
    const hf = holePolygon[0]!
    hole.moveTo(hf[0], -hf[1])
    for (let i = 1; i < holePolygon.length; i++) {
      const pt = holePolygon[i]!
      hole.lineTo(pt[0], -pt[1])
    }
    hole.closePath()
    shape.holes.push(hole)
  }

  const geometry = new ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

function createCeilingOutlineGeometry(polygon: Array<[number, number]>): BufferGeometry {
  const geometry = new BufferGeometry()
  if (polygon.length < 2) return geometry
  const points = polygon.map(([x, z]) => new Vector3(x, 0, z))
  const first = polygon[0]!
  points.push(new Vector3(first[0], 0, first[1]))
  geometry.setFromPoints(points)
  return geometry
}

export default MoveCeilingTool
