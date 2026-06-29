'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  DuctSegmentNode,
  emitter,
  type GridEvent,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  consumePlacementDragRelease,
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
import { Matrix4, Vector3 } from 'three'
import {
  type Aabb2D,
  collectGhostAlignmentCandidates,
  resolveGhostAlignment,
} from '../shared/ghost-alignment'
import { DuctSegmentGhost, FittingGhost } from '../shared/mep-ghost'
import { collectScenePorts, DUCT_PORT_SYSTEMS } from '../shared/ports'
import { type RunMoveConnectivity, startRunMoveConnectivity } from '../shared/run-move-connectivity'
import {
  planRunTranslationOffsets,
  type RunTranslationOffsetPlan,
} from '../shared/run-translation-offset'
import { rectSectionAxes } from './geometry'

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

/** Half the run's cross-section (meters) — the box / footprint padding. */
function runRadiusM(duct: DuctSegmentNode): number {
  if (duct.shape === 'round') return (duct.diameter * IN_TO_M) / 2
  return (Math.max(duct.width, duct.height) * IN_TO_M) / 2
}

/** The run's vertical box extent (meters). */
function runHeightM(duct: DuctSegmentNode): number {
  return (duct.shape === 'round' ? duct.diameter : duct.height) * IN_TO_M
}

/** XZ bounds of a path padded by the run's radius. */
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
 * Ghost-preview duplicate / move tool for duct runs.
 *
 * **Duplicate** (`metadata.isNew`): pure drag-to-place — NOTHING is
 * inserted into the scene until the commit click. A translucent ghost of
 * the run (cylinders / boxes matching its profile) rides the cursor inside
 * a footprint bounding box — the same affordance other items get — and
 * Figma-style alignment guides snap the box's edges to nearby geometry. The
 * next grid click calls `createNode`; Esc discards.
 *
 * **Move** (existing run): the real node is hidden while the same ghost +
 * box tracks the cursor; the commit click writes the translated `path` and
 * reveals it, Esc reveals it unchanged.
 *
 * Wired via `def.affordanceTools.move`.
 */
export const MoveDuctSegmentTool: React.FC<{ node: AnyNode }> = ({ node }) => {
  const duct = node as DuctSegmentNode
  const originalPathRef = useRef<Vec3[]>(duct.path.map((p) => [...p] as Vec3))

  const isNew =
    typeof node.metadata === 'object' &&
    node.metadata !== null &&
    !Array.isArray(node.metadata) &&
    (node.metadata as Record<string, unknown>).isNew === true

  const [previewPath, setPreviewPath] = useState<Vec3[]>(originalPathRef.current)
  const [translationGhost, setTranslationGhost] = useState<RunTranslationOffsetPlan | null>(null)
  const previewPathRef = useRef<Vec3[]>(originalPathRef.current)
  const hasMovedRef = useRef(false)
  const activatedAtRef = useRef<number>(Date.now())
  const prevSnapRef = useRef<[number, number] | null>(null)

  useEffect(() => {
    const nodeId = node.id as AnyNodeId
    const originalPath = originalPathRef.current
    const [centerX, centerZ] = pathCenterXZ(originalPath)
    const r = runRadiusM(duct)
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

    // Carry connected fittings (+ their other runs) as the whole run slides.
    // Snapshot once at drag start; only existing runs are mated to anything.
    const connectivity: RunMoveConnectivity | null = existedAtStart
      ? startRunMoveConnectivity(node)
      : null
    const portConnectivity = existedAtStart
      ? analyzePortConnectivity(node, useScene.getState().nodes)
      : null
    const scenePorts = existedAtStart
      ? collectScenePorts({ excludeNodeId: nodeId, systems: DUCT_PORT_SYSTEMS })
      : []
    const nodesById = useScene.getState().nodes
    const profile = {
      shape: duct.shape,
      diameter: duct.diameter,
      width: duct.width,
      height: duct.height,
    }
    let lastTranslationPlan: RunTranslationOffsetPlan | null = null

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
      const nextPath = originalPath.map(([x, y, z]) => [x + dx, y, z + dz] as Vec3)
      setPreview(nextPath)
      lastTranslationPlan =
        existedAtStart && portConnectivity
          ? planRunTranslationOffsets({
              duct,
              translatedPath: nextPath,
              profile,
              connections: portConnectivity.connections,
              scenePorts,
              nodesById,
            })
          : null
      if (lastTranslationPlan) connectivity?.clear()
      else connectivity?.preview({ path: nextPath })
      setTranslationGhost(lastTranslationPlan)
    }

    const commit = (event: GridEvent, fromDragRelease = false) => {
      if (committed) return
      // The 150ms debounce only guards click-to-place against the arming click
      // double-firing; a press-drag release is a distinct pointerup gesture, so
      // it skips the guard (a quick drag-flick still commits).
      if (!fromDragRelease && Date.now() - activatedAtRef.current < 150) {
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
        const created = DuctSegmentNode.parse({
          ...(node as Record<string, unknown>),
          path: finalPath,
          metadata: stripPlacementMetadataFlags(node.metadata),
          visible: true,
        })
        useScene.getState().createNode(created as AnyNode, node.parentId as AnyNodeId)
        selectId = created.id as AnyNodeId
      } else {
        const translationPlan =
          portConnectivity &&
          planRunTranslationOffsets({
            duct,
            translatedPath: finalPath,
            profile,
            connections: portConnectivity.connections,
            scenePorts,
            nodesById,
          })
        if (translationPlan) {
          useScene.getState().applyNodeChanges({
            create: [...translationPlan.fittings, ...translationPlan.connectors].map((created) => ({
              node: created as AnyNode,
              parentId: node.parentId as AnyNodeId,
            })),
            update: [
              { id: nodeId, data: { path: translationPlan.ductPath } as Partial<AnyNode> },
              ...translationPlan.updates,
            ],
          })
        } else {
          // Fold connected-fitting / sibling-run follow-updates into the SAME
          // batch as the moved run so the whole joint is one undo step.
          const followUpdates = connectivity?.commitUpdates({ path: finalPath }) ?? []
          useScene
            .getState()
            .updateNodes([
              { id: nodeId, data: { path: finalPath } as Partial<AnyNode> },
              ...followUpdates,
            ])
        }
        useScene.getState().markDirty(nodeId)
      }
      useScene.temporal.getState().pause()
      // Followers are committed to the store — drop their live overrides so
      // renderers read the canonical path/position.
      connectivity?.clear()
      setMeshHidden(false)

      useAlignmentGuides.getState().clear()
      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [selectId] })
      useEditor.getState().setMovingNodeOrigin('3d')
      useEditor.getState().setMovingNode(null)
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      connectivity?.clear()
      setTranslationGhost(null)
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

    // Press-drag-release: when the move was engaged by the drag gesture (the
    // selection rig's move cross), `placementDragMode` is set, so commit on
    // pointer-up at the last previewed path instead of waiting for a second
    // click — same contract as the fitting move tool.
    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      if (!hasMovedRef.current) {
        onCancel()
        return
      }
      commit(
        {
          nativeEvent: event,
          stopPropagation: () => event.stopPropagation(),
        } as unknown as GridEvent,
        true,
      )
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', commit)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', commit)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
      connectivity?.clear()
      setTranslationGhost(null)
      useAlignmentGuides.getState().clear()
      if (existedAtStart) setMeshHidden(false)
      useScene.temporal.getState().resume()
    }
  }, [duct, isNew, node])

  const segments: Array<{ a: Vec3; b: Vec3 }> = []
  for (let i = 0; i < previewPath.length - 1; i++) {
    segments.push({ a: previewPath[i]!, b: previewPath[i + 1]! })
  }

  // Footprint box spanning the whole run (axis-aligned), drawn around the
  // ghost the same way items get one. Recomputed from the live preview path.
  const r = runRadiusM(duct)
  const box = pathAabb(previewPath, r)
  const boxY = previewPath[0]?.[1] ?? 0

  return (
    <group>
      {segments.map((seg, i) => (
        <GhostSegment a={seg.a} b={seg.b} duct={duct} key={`ghost-${i}`} />
      ))}
      {translationGhost?.fittings.map((fitting) => (
        <FittingGhost fitting={fitting} key={`translation-fitting-${fitting.id}`} tint="valid" />
      ))}
      {translationGhost?.connectors.map((connector) => (
        <DuctSegmentGhost
          duct={connector}
          key={`translation-connector-${connector.id}`}
          tint="valid"
        />
      ))}
      <DragBoundingBox
        centerY={0}
        nodeId={node.id}
        position={[(box.minX + box.maxX) / 2, boxY, (box.minZ + box.maxZ) / 2]}
        size={[box.maxX - box.minX, runHeightM(duct), box.maxZ - box.minZ]}
      />
    </group>
  )
}

/** Translucent stand-in for one duct section — mirrors the draw tool's
 *  `PreviewSegment` so the ghost matches what actually lands. */
function GhostSegment({ a, b, duct }: { a: Vec3; b: Vec3; duct: DuctSegmentNode }) {
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-4) return null
  dir.normalize()
  const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)

  if (duct.shape !== 'round') {
    const w = duct.width * IN_TO_M
    const h = duct.height * IN_TO_M
    return (
      <mesh
        layers={EDITOR_LAYER}
        position={mid.toArray()}
        ref={(m) => {
          if (!m) return
          const { width: x, height: z } = rectSectionAxes(dir, duct.roll)
          m.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, dir, z))
        }}
      >
        <boxGeometry args={[w, length, h]} />
        <meshBasicMaterial
          color={GHOST_COLOR}
          depthTest={false}
          opacity={GHOST_OPACITY}
          transparent
        />
      </mesh>
    )
  }

  const radius = (duct.diameter * IN_TO_M) / 2
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={mid.toArray()}
      ref={(m) => {
        if (!m) return
        m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      }}
    >
      <cylinderGeometry args={[radius, radius, length, 24, 1, false]} />
      <meshBasicMaterial
        color={GHOST_COLOR}
        depthTest={false}
        opacity={GHOST_OPACITY}
        transparent
      />
    </mesh>
  )
}

export default MoveDuctSegmentTool
