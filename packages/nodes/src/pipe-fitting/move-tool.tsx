'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  PipeFittingNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  DragBoundingBox,
  EDITOR_LAYER,
  markToolCancelConsumed,
  stripPlacementMetadataFlags,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { Box3, Euler, type Material, type Mesh, MeshBasicMaterial, Vector3 } from 'three'
import {
  type Aabb2D,
  collectGhostAlignmentCandidates,
  resolveGhostAlignment,
} from '../shared/ghost-alignment'
import { type RunMoveConnectivity, startRunMoveConnectivity } from '../shared/run-move-connectivity'
import { buildPipeFittingGeometry } from './geometry'

type Vec3 = [number, number, number]

const GHOST_COLOR = '#818cf8'
const GHOST_OPACITY = 0.5

/** Screen pixels → meters for the Ctrl-vertical (riser) drag — matches the
 *  pipe draw tool's Alt-vertical feel. 100 px ≈ 1 m. */
const VERTICAL_PIXELS_PER_METER = 100
const VERTICAL_Y_MIN_M = -3
const VERTICAL_Y_MAX_M = 10

/** Snap a coordinate to the editor's live grid step. */
function snapToGridStep(value: number): number {
  const step = useEditor.getState().gridSnapStep
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/** World-space size + centre offset of `box` after the fitting's euler
 *  rotation — the footprint box that wraps the oriented geometry. */
function rotatedBounds(box: Box3, rotation: Vec3): { size: Vec3; offset: Vec3 } {
  const euler = new Euler(rotation[0], rotation[1], rotation[2])
  const min = box.min
  const max = box.max
  const corners: Vec3[] = [
    [min.x, min.y, min.z],
    [max.x, min.y, min.z],
    [min.x, max.y, min.z],
    [min.x, min.y, max.z],
    [max.x, max.y, min.z],
    [max.x, min.y, max.z],
    [min.x, max.y, max.z],
    [max.x, max.y, max.z],
  ]
  const lo: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const hi: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  const v = new Vector3()
  for (const c of corners) {
    v.set(c[0], c[1], c[2]).applyEuler(euler)
    lo[0] = Math.min(lo[0], v.x)
    lo[1] = Math.min(lo[1], v.y)
    lo[2] = Math.min(lo[2], v.z)
    hi[0] = Math.max(hi[0], v.x)
    hi[1] = Math.max(hi[1], v.y)
    hi[2] = Math.max(hi[2], v.z)
  }
  return {
    size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    offset: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
  }
}

/**
 * Ghost-preview duplicate / move tool for DWV pipe fittings (elbow / wye /
 * sanitary tee) — the plumbing sibling of the duct-fitting move tool.
 *
 * **Duplicate** (`metadata.isNew`): pure drag-to-place — NOTHING is
 * inserted into the scene until the commit click. A translucent copy of the
 * fitting (built from its real geometry, at its own `rotation`, so an elbow
 * / riser stays properly aligned) rides the cursor inside a footprint
 * bounding box — the same affordance other items get — and Figma-style
 * alignment guides snap the box edges to nearby geometry. The commit click
 * calls `createNode`; Esc discards.
 *
 * **Move** (existing fitting): the real node is hidden while the ghost + box
 * track the cursor; commit writes the new `position` and reveals it.
 *
 * Modifiers (mirroring the duct-fitting move):
 * - **Alt** detaches: the connected-pipe follow drops so the fitting moves
 *   on its own, leaving every mated run where it sits.
 * - **Ctrl / Cmd** switches to vertical movement (stack / riser editing): XZ
 *   holds and the cursor's screen-Y drives the riser height.
 * - **Shift** bypasses grid snapping / alignment.
 *
 * Wired via `def.affordanceTools.move`.
 */
export const MovePipeFittingTool: React.FC<{ node: AnyNode }> = ({ node }) => {
  const fitting = node as PipeFittingNode
  const originalPosition = (fitting.position ?? [0, 0, 0]) as Vec3
  const rotation = (fitting.rotation ?? [0, 0, 0]) as Vec3
  const isNew =
    typeof node.metadata === 'object' &&
    node.metadata !== null &&
    !Array.isArray(node.metadata) &&
    (node.metadata as Record<string, unknown>).isNew === true

  const [cursorPos, setCursorPos] = useState<Vec3>(originalPosition)

  // Translucent stand-in built from the fitting's real geometry. Rotation is
  // a geometry input (it decides the elbow's profile roles), so the ghost
  // matches what lands. Rebuilt only if the source changes.
  const ghost = useMemo(() => {
    const group = buildPipeFittingGeometry(fitting)
    group.traverse((obj) => {
      const mesh = obj as Mesh
      if ((mesh as { isMesh?: boolean }).isMesh) {
        mesh.material = new MeshBasicMaterial({
          color: GHOST_COLOR,
          transparent: true,
          opacity: GHOST_OPACITY,
          depthTest: false,
        })
        mesh.renderOrder = 999
      }
      obj.layers.set(EDITOR_LAYER)
    })
    return group
  }, [fitting])

  // Footprint box that wraps the oriented geometry (size + centre offset),
  // measured once from the ghost.
  const bounds = useMemo(() => {
    const box = new Box3().setFromObject(ghost)
    if (box.isEmpty()) return { size: [0.3, 0.3, 0.3] as Vec3, offset: [0, 0, 0] as Vec3 }
    return rotatedBounds(box, rotation)
  }, [ghost, rotation])

  useEffect(() => {
    return () => {
      ghost.traverse((obj) => {
        const mesh = obj as Mesh
        if ((mesh as { isMesh?: boolean }).isMesh) {
          mesh.geometry?.dispose?.()
          const mat = mesh.material as Material | Material[]
          if (Array.isArray(mat)) for (const m of mat) m.dispose?.()
          else mat?.dispose?.()
        }
      })
    }
  }, [ghost])

  useEffect(() => {
    const nodeId = node.id as AnyNodeId
    const [hx, , hz] = [bounds.size[0] / 2, 0, bounds.size[2] / 2]
    const [ox, , oz] = bounds.offset

    useScene.temporal.getState().pause()
    let committed = false
    let hasMoved = false
    const activatedAt = Date.now()

    const candidates: AlignmentAnchor[] = collectGhostAlignmentCandidates(
      useScene.getState().nodes,
      nodeId,
      useViewer.getState().selection.levelId ?? node.parentId,
    )

    // Moving an existing fitting: hide its 3D MESH imperatively (NOT the
    // store `visible` flag — the 2D floor plan skips `visible:false` nodes,
    // so a store hide makes it vanish in 2D / split view). The ghost stands
    // in until commit; the real mesh is restored on cancel / unmount.
    const existedAtStart = !isNew && !!useScene.getState().nodes[nodeId]
    const setMeshHidden = (hidden: boolean) => {
      const obj = sceneRegistry.nodes.get(nodeId)
      if (obj) obj.visible = !hidden
    }
    if (existedAtStart) setMeshHidden(true)

    // Carry connected pipes as the fitting slides: the part of the move along
    // a run's axis stretches it, the part across translates the whole run (and
    // propagates to its far joint). Snapshot once at drag start; only existing
    // fittings are mated to anything.
    const connectivity: RunMoveConnectivity | null = existedAtStart
      ? startRunMoveConnectivity(node)
      : null

    let lastPos: Vec3 = originalPosition
    // Tracks whether the last frame held Alt: the fitting is detached from its
    // connected pipes for the drag, so they stay put (no follow) and the
    // commit omits their updates. Mirrors the pipe endpoint's Alt-detach.
    let lastDetached = false
    // Anchor for the Ctrl-vertical (riser) drag: clientY + base Y captured the
    // frame Ctrl is first held, so vertical mouse motion maps to Y. Cleared
    // when Ctrl is released. Mirrors the draw tool's Alt-vertical anchor.
    let verticalAnchor: { clientY: number; baseY: number } | null = null

    const onMove = (event: GridEvent) => {
      const bypass = event.nativeEvent?.shiftKey === true
      // Alt = detach: drop the connected-pipe follow so the fitting moves on
      // its own, leaving every mated run where it sits.
      const detached = event.nativeEvent?.altKey === true
      // Ctrl/Cmd = vertical: XZ locks to where the fitting sits and the cursor's
      // screen-Y drives the riser height (connected pipes still follow).
      const vertical = event.nativeEvent?.ctrlKey === true || event.nativeEvent?.metaKey === true
      const clientY = (event.nativeEvent as { clientY?: number } | undefined)?.clientY
      const snap = bypass ? (v: number) => v : snapToGridStep

      let next: Vec3
      if (vertical && typeof clientY === 'number') {
        if (!verticalAnchor) verticalAnchor = { clientY, baseY: lastPos[1] }
        // Screen +Y points down, so subtract to map "drag up = raise".
        const dy = (verticalAnchor.clientY - clientY) / VERTICAL_PIXELS_PER_METER
        const y = Math.min(
          VERTICAL_Y_MAX_M,
          Math.max(VERTICAL_Y_MIN_M, verticalAnchor.baseY + snap(dy)),
        )
        next = [lastPos[0], y, lastPos[2]]
        useAlignmentGuides.getState().clear()
      } else {
        verticalAnchor = null
        let x = snap(event.localPosition[0])
        let z = snap(event.localPosition[2])

        // Alignment: snap the footprint box edges onto nearby geometry and
        // publish guides (Alt / Shift bypass).
        if (!bypass) {
          const proposed: Aabb2D = {
            minX: x + ox - hx,
            maxX: x + ox + hx,
            minZ: z + oz - hz,
            maxZ: z + oz + hz,
          }
          const { dx, dz, guides } = resolveGhostAlignment(nodeId, proposed, candidates)
          x += dx
          z += dz
          useAlignmentGuides.getState().set(guides)
        } else {
          useAlignmentGuides.getState().clear()
        }
        next = [x, lastPos[1], z]
      }

      if (next[0] !== lastPos[0] || next[1] !== lastPos[1] || next[2] !== lastPos[2]) {
        triggerSFX('sfx:grid-snap')
      }
      lastPos = next
      lastDetached = detached
      hasMoved = true
      setCursorPos(next)
      // Detached: keep the followers at their origin (drop any live overrides
      // from a prior non-detached frame). Otherwise preview the follow.
      if (detached) connectivity?.clear()
      else connectivity?.preview({ position: next })
    }

    const commit = (event: GridEvent) => {
      if (committed) return
      if (Date.now() - activatedAt < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }
      if (!hasMoved) {
        event.nativeEvent?.stopPropagation?.()
        return
      }
      committed = true

      useScene.temporal.getState().resume()
      let selectId = nodeId
      if (isNew && !useScene.getState().nodes[nodeId]) {
        const created = PipeFittingNode.parse({
          ...(node as Record<string, unknown>),
          position: lastPos,
          metadata: stripPlacementMetadataFlags(node.metadata),
          visible: true,
        })
        useScene.getState().createNode(created as AnyNode, node.parentId as AnyNodeId)
        selectId = created.id as AnyNodeId
      } else {
        // Fold connected-pipe / sibling-run follow-updates into the SAME batch
        // as the moved fitting so the whole joint is one undo step. Detached
        // (Alt on the final frame): the joint is broken, so nothing follows.
        const followUpdates = lastDetached
          ? []
          : (connectivity?.commitUpdates({ position: lastPos }) ?? [])
        useScene
          .getState()
          .updateNodes([
            { id: nodeId, data: { position: lastPos } as Partial<AnyNode> },
            ...followUpdates,
          ])
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
      connectivity?.clear()
      useAlignmentGuides.getState().clear()
      if (existedAtStart) setMeshHidden(false)
      useScene.temporal.getState().resume()
    }
  }, [bounds, isNew, node, originalPosition])

  return (
    <group>
      <primitive object={ghost} position={cursorPos} rotation={rotation} />
      <DragBoundingBox
        centerY={bounds.offset[1]}
        nodeId={node.id}
        position={[cursorPos[0] + bounds.offset[0], cursorPos[1], cursorPos[2] + bounds.offset[2]]}
        size={bounds.size}
      />
    </group>
  )
}

export default MovePipeFittingTool
