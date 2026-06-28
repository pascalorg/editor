'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  LiquidLineNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  DragBoundingBox,
  EDITOR_LAYER,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  stripPlacementMetadataFlags,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import {
  type Aabb2D,
  collectGhostAlignmentCandidates,
  resolveGhostAlignment,
} from '../shared/ghost-alignment'

type Vec3 = [number, number, number]

const GHOST_COLOR = '#818cf8'
const GHOST_OPACITY = 0.5
const IN_TO_M = 0.0254

/** Snap a coordinate to the editor's live grid step. */
function snapToGridStep(value: number): number {
  const step = useEditor.getState().gridSnapStep
  if (step <= 0) return value
  return Math.round(value / step) * step
}

function pathCenterXZ(path: readonly Vec3[]): [number, number] {
  let x = 0
  let z = 0
  for (const p of path) {
    x += p[0]
    z += p[2]
  }
  const n = path.length || 1
  return [x / n, z / n]
}

/** The liquid line's footprint radius (meters) — half its OD, used as box /
 *  footprint padding and ghost radius. */
function liquidLineRadiusM(line: LiquidLineNode): number {
  return (line.diameter * IN_TO_M) / 2
}

/** XZ bounds of a path padded by the line's radius. */
function pathAabb(path: readonly Vec3[], r: number): Aabb2D {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const p of path) {
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[2] < minZ) minZ = p[2]
    if (p[2] > maxZ) maxZ = p[2]
  }
  return { minX: minX - r, maxX: maxX + r, minZ: minZ - r, maxZ: maxZ + r }
}

/**
 * Ghost-preview duplicate / move tool for liquid lines — the path-mover sibling
 * of `MoveLinesetTool`. A translucent cylinder at the line's OD per section
 * stands in for the run (mirrors the draw tool's `PreviewSegment`).
 *
 * **Duplicate** (`metadata.isNew`): pure drag-to-place — NOTHING is inserted
 * into the scene until the commit click. A translucent ghost rides the cursor
 * inside a footprint bounding box and Figma-style alignment guides snap the
 * box's edges to nearby geometry. The next grid click calls `createNode`; Esc
 * discards. The run's Y coords ride along untouched: the move only shifts XZ.
 *
 * **Move** (existing run): the real node's mesh is hidden while the same ghost
 * + box tracks the cursor; the commit click writes the translated `path` and
 * reveals it, Esc reveals it unchanged.
 *
 * Wired via `def.affordanceTools.move`.
 */
export const MoveLiquidLineTool: React.FC<{ node: AnyNode }> = ({ node }) => {
  const line = node as LiquidLineNode
  const originalPathRef = useRef<Vec3[]>(line.path.map((p) => [...p] as Vec3))

  const isNew =
    typeof node.metadata === 'object' &&
    node.metadata !== null &&
    !Array.isArray(node.metadata) &&
    (node.metadata as Record<string, unknown>).isNew === true

  const [previewPath, setPreviewPath] = useState<Vec3[]>(originalPathRef.current)
  const previewPathRef = useRef<Vec3[]>(originalPathRef.current)
  const hasMovedRef = useRef(false)
  const activatedAtRef = useRef<number>(Date.now())
  const prevSnapRef = useRef<[number, number] | null>(null)

  useEffect(() => {
    const nodeId = node.id as AnyNodeId
    const originalPath = originalPathRef.current
    const [centerX, centerZ] = pathCenterXZ(originalPath)
    const r = liquidLineRadiusM(line)
    const baseAabb = pathAabb(originalPath, r)

    useScene.temporal.getState().pause()
    let committed = false

    const candidates: AlignmentAnchor[] = collectGhostAlignmentCandidates(
      useScene.getState().nodes,
      nodeId,
      useViewer.getState().selection.levelId ?? node.parentId,
    )

    // Moving an existing run: hide its 3D MESH imperatively (NOT the store
    // `visible` flag — the 2D floor plan skips `visible:false` nodes, so a
    // store hide makes the run vanish in 2D / split view). The ghost stands
    // in until commit; the real mesh is restored on cancel / unmount.
    const existedAtStart = !isNew && !!useScene.getState().nodes[nodeId]
    const setMeshHidden = (hidden: boolean) => {
      const obj = sceneRegistry.nodes.get(nodeId)
      if (obj) obj.visible = !hidden
    }
    if (existedAtStart) setMeshHidden(true)

    const setPreview = (path: Vec3[]) => {
      previewPathRef.current = path
      setPreviewPath(path)
    }

    const onMove = (event: GridEvent) => {
      const snap = isGridSnapActive() ? snapToGridStep : (v: number) => v
      let dx = snap(event.localPosition[0] - centerX)
      let dz = snap(event.localPosition[2] - centerZ)

      // Figma-style magnetic alignment: snap the run's footprint box edges onto
      // nearby geometry and publish the guides. Grid follows the snapping mode;
      // lines follow magnetic alignment — the two are independent.
      if (isMagneticSnapActive()) {
        const proposed: Aabb2D = {
          minX: baseAabb.minX + dx,
          maxX: baseAabb.maxX + dx,
          minZ: baseAabb.minZ + dz,
          maxZ: baseAabb.maxZ + dz,
        }
        const { dx: sdx, dz: sdz, guides } = resolveGhostAlignment(nodeId, proposed, candidates)
        dx += sdx
        dz += sdz
        useAlignmentGuides.getState().set(guides)
      } else {
        useAlignmentGuides.getState().clear()
      }

      const cur: [number, number] = [centerX + dx, centerZ + dz]
      if (
        (isGridSnapActive() || isMagneticSnapActive()) &&
        (!prevSnapRef.current ||
          prevSnapRef.current[0] !== cur[0] ||
          prevSnapRef.current[1] !== cur[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      prevSnapRef.current = cur
      hasMovedRef.current = true
      setPreview(originalPath.map(([x, y, z]) => [x + dx, y, z + dz] as Vec3))
    }

    const commit = (event: GridEvent) => {
      if (committed) return
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }
      if (!hasMovedRef.current) {
        event.nativeEvent?.stopPropagation?.()
        return
      }
      committed = true
      const finalPath = previewPathRef.current

      useScene.temporal.getState().resume()
      let selectId = nodeId
      if (isNew && !useScene.getState().nodes[nodeId]) {
        const created = LiquidLineNode.parse({
          ...(node as Record<string, unknown>),
          path: finalPath,
          metadata: stripPlacementMetadataFlags(node.metadata),
          visible: true,
        })
        useScene.getState().createNode(created as AnyNode, node.parentId as AnyNodeId)
        selectId = created.id as AnyNodeId
      } else {
        useScene.getState().updateNode(nodeId, { path: finalPath } as Partial<AnyNode>)
        useScene.getState().markDirty(nodeId)
      }
      useScene.temporal.getState().pause()
      setMeshHidden(false)

      useAlignmentGuides.getState().clear()
      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [selectId] })
      useEditor.getState().setMovingNodeOrigin('3d')
      useEditor.getState().setMovingNode(null)
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      if (existedAtStart) {
        setMeshHidden(false)
        useViewer.getState().setSelection({ selectedIds: [nodeId] })
      }
      useAlignmentGuides.getState().clear()
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      useEditor.getState().setMovingNodeOrigin('3d')
      useEditor.getState().setMovingNode(null)
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', commit)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', commit)
      emitter.off('tool:cancel', onCancel)
      useAlignmentGuides.getState().clear()
      if (existedAtStart) setMeshHidden(false)
      useScene.temporal.getState().resume()
    }
  }, [line, isNew, node])

  const segments: Array<{ a: Vec3; b: Vec3 }> = []
  for (let i = 0; i < previewPath.length - 1; i++) {
    segments.push({ a: previewPath[i]!, b: previewPath[i + 1]! })
  }

  // Footprint box spanning the whole run (axis-aligned), drawn around the ghost
  // the same way items get one. Recomputed from the live preview path.
  const r = liquidLineRadiusM(line)
  const box = pathAabb(previewPath, r)
  const boxY = previewPath[0]?.[1] ?? 0

  return (
    <group>
      {segments.map((seg, i) => (
        <GhostSegment a={seg.a} b={seg.b} radius={r} key={`ghost-${i}`} />
      ))}
      <DragBoundingBox
        centerY={0}
        nodeId={node.id}
        position={[(box.minX + box.maxX) / 2, boxY, (box.minZ + box.maxZ) / 2]}
        size={[box.maxX - box.minX, line.diameter * IN_TO_M, box.maxZ - box.minZ]}
      />
    </group>
  )
}

/** Translucent stand-in for one liquid-line section — mirrors the draw tool's
 *  `PreviewSegment` so the ghost matches what actually lands. */
function GhostSegment({ a, b, radius }: { a: Vec3; b: Vec3; radius: number }) {
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-4) return null
  dir.normalize()
  const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)

  return (
    <mesh
      layers={EDITOR_LAYER}
      position={mid.toArray()}
      ref={(m) => {
        if (!m) return
        m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      }}
    >
      <cylinderGeometry args={[radius, radius, length, 16, 1, false]} />
      <meshBasicMaterial
        color={GHOST_COLOR}
        depthTest={false}
        opacity={GHOST_OPACITY}
        transparent
      />
    </mesh>
  )
}

export default MoveLiquidLineTool
