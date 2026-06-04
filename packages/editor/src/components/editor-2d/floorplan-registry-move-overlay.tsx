'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  bboxAnchors,
  bboxCornerAnchors,
  type FloorplanMoveTargetSession,
  nodeRegistry,
  pauseSceneHistory,
  resolveAlignment,
  resumeSceneHistory,
  snapPointToGrid,
  useAlignmentGuides,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { useWallMoveGhosts } from '../../store/use-wall-move-ghosts'

const GRID_STEP = 0.5

// Figma-style alignment snap threshold. Meters in world space; 8cm gives
// a comfortable "magnetic" pull at default zoom without fighting the
// grid snap. Held fixed for v1 — a future revision can scale this with
// the SVG's units-per-pixel so the feel stays constant across zoom.
const ALIGNMENT_THRESHOLD_M = 0.08

/**
 * Cursor-driven placement for registered kinds in the floor plan.
 *
 * Activates when `useEditor.movingNode` is set to a node whose kind is
 * registered with `def.floorplan`. Two dispatch paths:
 *
 *   1. **`def.floorplanMoveTarget` present** (door / window / item):
 *      kind-specific 2D move handler with wall / ceiling / slab
 *      anchor logic. Pointer events feed `session.apply` which writes
 *      directly to `useScene`; pointer-up does the single-undo dance
 *      (revert→resume→re-apply) if `canCommit()` is true.
 *   2. **Fallback — generic free-floating translate**: imperatively
 *      translates the rendered SVG entry on pointer-move, commits via
 *      `updateNode` on pointer-up. Used by shelf / spawn / fence /
 *      etc. whose move is "translate position on X/Z plane".
 *
 * Lives outside the `floorplan-panel.tsx` monolith. Coordinate
 * conversion routes through the scene `<g>`'s `getScreenCTM` so
 * cursor → meters accounts for pan / zoom / building rotation.
 */
export function FloorplanRegistryMoveOverlay() {
  const movingNode = useEditor((s) => s.movingNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setMovingNodeOrigin = useEditor((s) => s.setMovingNodeOrigin)

  const def = movingNode ? nodeRegistry.get(movingNode.type) : null
  const isActive = !!movingNode && !!def?.floorplan
  const hasMoveTarget = !!def?.floorplanMoveTarget

  useEffect(() => {
    if (!isActive || !movingNode) return

    const scene = document.querySelector('[data-floorplan-scene]') as SVGGElement | null
    if (!scene) return

    const toMeters = (clientX: number, clientY: number): [number, number] | null => {
      const svg = scene.ownerSVGElement
      if (!svg) return null
      const ctm = scene.getScreenCTM()
      if (!ctm) return null
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      const m = pt.matrixTransform(ctm.inverse())
      return [m.x, m.y]
    }

    // ── Path 1 — kind-owned `floorplanMoveTarget` ───────────────────
    if (hasMoveTarget && def?.floorplanMoveTarget) {
      const sceneNodes = useScene.getState().nodes
      const session: FloorplanMoveTargetSession = (
        def.floorplanMoveTarget as (a: {
          node: AnyNode
          nodes: Record<AnyNodeId, AnyNode>
        }) => FloorplanMoveTargetSession
      )({ node: movingNode, nodes: sceneNodes })

      // Capture snapshots of every affected node BEFORE the first apply
      // so the single-undo dance has a clean baseline to revert to.
      const snapshots = session.affectedIds
        .map((id) => sceneNodes[id])
        .filter((n): n is AnyNode => !!n)
        .map((n) => snapshotNode(n))

      pauseSceneHistory(useScene)
      let historyPaused = true

      // The registry action menu's Move button portals to `document.body`,
      // so the trigger click's pointer-up happens OUTSIDE the floor-plan
      // scene and never reaches `onPointerUp` here. That means: the very
      // first window-pointer-up the overlay sees is the user's intended
      // commit click. No "click-to-enter" gesture to detect — the older
      // flow used an orange "Move" dot rendered inside the slab itself,
      // where the trigger click DID hit the overlay's listener and had
      // to be consumed. That legacy flow is gone in the registry layer;
      // all entries use the action menu now.
      let hasMovedSinceStart = false

      const isPointerOverFloorplanScene = (clientX: number, clientY: number): boolean => {
        // We can't just check `target.closest('[data-floorplan-scene]')`
        // because the scene's `<g>` only covers painted SVG elements —
        // hovering empty grid background returns the parent SVG element
        // as target (no ancestor with the marker), so the closest check
        // fails. Compare the pointer position against the scene's
        // bounding rect instead: any cursor inside the SVG viewport
        // counts as "over the floor plan", regardless of whether the
        // exact pixel paints a node or just blank surface.
        const svg = scene.ownerSVGElement
        if (!svg) return false
        const rect = svg.getBoundingClientRect()
        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        )
      }

      const onMove = (event: PointerEvent) => {
        // Skip 3D-canvas / other-UI cursor moves so the overlay only
        // tracks pointer events that actually correspond to a floor-plan
        // location. The bounding-rect check (vs the legacy
        // `target.closest('[data-floorplan-scene]')`) also picks up
        // hovers over empty grid background — without it, the cursor
        // only updated the shelf when it happened to brush over an
        // existing SVG entry, leaving the move feeling "stuck" elsewhere.
        if (!isPointerOverFloorplanScene(event.clientX, event.clientY)) return
        const planPoint = toMeters(event.clientX, event.clientY)
        if (!planPoint) return
        hasMovedSinceStart = true
        session.apply({
          planPoint,
          modifiers: {
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
          },
        })
      }

      const commitFinalStateOrRevert = () => {
        const commitValid = session.canCommit()

        // Claim ownership of the drag teardown so the 3D move tool's
        // unmount-time cleanup skips its restore-from-snapshot — see
        // `movingNodeOrigin` in `use-editor.tsx`. Set here (before any
        // `setMovingNode(null)`) so that by the time the 3D effect's
        // cleanup runs the origin is observable in the store.
        setMovingNodeOrigin('2d')

        // Sessions with a `commit` hook own their atomic write (e.g.
        // wall move emits creates + deletes + updates via the junction
        // planner). For those we still do Phase 1 (revert to baseline)
        // and Phase 2's resume — but Phase 2's write is delegated, and
        // we skip the snapshot-diff finalUpdates path.
        if (commitValid && session.commit) {
          useScene.getState().updateNodes(snapshotsToUpdates(snapshots))
          if (historyPaused) {
            resumeSceneHistory(useScene)
            historyPaused = false
          }
          session.commit()
          sfxEmitter.emit('sfx:item-place')
          return
        }

        const sceneState = useScene.getState().nodes
        const finalUpdates: Array<{ id: AnyNodeId; data: Record<string, unknown> }> = []
        for (const snap of snapshots) {
          const current = sceneState[snap.id]
          if (!current) continue
          const data: Record<string, unknown> = {}
          let changed = false
          for (const [key, before] of Object.entries(snap.data)) {
            const after = (current as unknown as Record<string, unknown>)[key]
            if (!deepEqual(before, after)) {
              data[key] = Array.isArray(after) ? [...(after as unknown[])] : after
              changed = true
            }
          }
          if (changed) finalUpdates.push({ id: snap.id, data })
        }

        if (commitValid && finalUpdates.length > 0) {
          // Single-undo dance:
          //   1. Revert to baseline while history is still paused.
          //   2. Resume history.
          //   3. Re-apply the final state — recorded as one tracked change.
          useScene.getState().updateNodes(snapshotsToUpdates(snapshots))
          if (historyPaused) {
            resumeSceneHistory(useScene)
            historyPaused = false
          }
          useScene.getState().updateNodes(finalUpdates)
          // Strip the isNew metadata once committed (matches the legacy
          // 3D move-tool that demotes duplicated nodes from "new" status
          // on first successful drop).
          for (const snap of snapshots) {
            const current = useScene.getState().nodes[snap.id]
            const meta =
              current && typeof (current as { metadata?: unknown }).metadata === 'object'
                ? ((current as { metadata?: Record<string, unknown> }).metadata ?? {})
                : {}
            if (meta.isNew) {
              useScene.getState().updateNodes([
                {
                  id: snap.id,
                  data: { metadata: { ...meta, isNew: false } } as Record<string, unknown>,
                },
              ])
            }
          }
          sfxEmitter.emit('sfx:item-place')
          // Re-select the moved node(s) — mirrors the legacy 3D move
          // tool. The action menu cleared selection on Move click so
          // selection-gated affordances (slab/ceiling boundary editor,
          // etc.) would unmount during the drag; restoring it here
          // brings them back at the new position.
          useViewer.getState().setSelection({ selectedIds: snapshots.map((s) => s.id) })
        } else {
          useScene.getState().updateNodes(snapshotsToUpdates(snapshots))
          if (historyPaused) {
            resumeSceneHistory(useScene)
            historyPaused = false
          }
        }
      }

      const onPointerUp = (event: PointerEvent) => {
        if (event.button !== 0) return
        // Bounding-rect check (see `isPointerOverFloorplanScene`) — same
        // reason as `onMove`: commits should land for any pointer-up
        // inside the SVG viewport, including empty grid background.
        if (!isPointerOverFloorplanScene(event.clientX, event.clientY)) return

        // Commit using the LAST pointermove's state — no re-apply at
        // pointer-up coords. A previous version re-applied here to
        // close a sub-pixel "drift" window when pointer-up fires
        // without a preceding pointermove, but that re-apply also
        // re-snaps: if the pointer-up coord crosses a grid boundary
        // relative to the last pointermove, the snapped result flips
        // to a different grid cell and the wall (or other moved node)
        // visibly jumps from where it was painted during the drag to
        // a different commit position. Trusting the last pointermove
        // means "what you saw is what gets committed", which is the
        // UX users expect — at the cost of a sub-pixel drift in the
        // rare case where the OS fires pointerup with no preceding
        // pointermove. Modern browsers reliably emit a final
        // pointermove right before pointerup, so the trade-off lands
        // on the side of WYSIWYG.

        commitFinalStateOrRevert()
        setMovingNode(null)

        // Swallow the click event that follows this pointer-up — the
        // floor-plan SVG's `handleBackgroundClick` would otherwise route
        // it through `resolveFloorplanBackgroundSelection`, which clears
        // the selection if the click resolved to empty space. We already
        // set selection back to the moved node in `commitFinalStateOrRevert`;
        // letting the background-click handler run would undo that for
        // any commit click that doesn't happen to land directly on the
        // node's hit-test geometry.
        //
        // The 3D mover doesn't need this because its grid-click fires
        // via the emitter inside the R3F pointer event and can call
        // `event.nativeEvent.stopPropagation()`; the 2D pointerup and
        // the following click are separate DOM events, so we listen on
        // window in the capture phase to intercept the click before any
        // bubble-phase handler (the floor-plan SVG) sees it.
        const swallowClick = (e: MouseEvent) => {
          e.stopPropagation()
          e.preventDefault()
          window.removeEventListener('click', swallowClick, true)
        }
        window.addEventListener('click', swallowClick, true)
        // Safety net: if no click fires (e.g. user dragged enough to
        // suppress it), drop the listener on the next tick.
        setTimeout(() => {
          window.removeEventListener('click', swallowClick, true)
        }, 0)
      }

      const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        // Claim teardown ownership so the 3D move tool's cleanup skips
        // its own restore — without this, both sides would race to
        // write the same baseline, harmless but wasteful.
        setMovingNodeOrigin('2d')
        // Revert untracked, then resume — no history entry.
        useScene.getState().updateNodes(snapshotsToUpdates(snapshots))
        if (historyPaused) {
          resumeSceneHistory(useScene)
          historyPaused = false
        }
        // Clear any live previews the session wrote. Slab / ceiling
        // 2D move stages a translation delta in `useLiveTransforms`;
        // wall move publishes `{ start, end, ... }` to
        // `useLiveNodeOverrides`. Either way, leaving them in place
        // after Esc would freeze the 2D / 3D view at the cancelled
        // position.
        const liveTransforms = useLiveTransforms.getState()
        const liveOverrides = useLiveNodeOverrides.getState()
        for (const id of session.affectedIds) {
          liveTransforms.clear(id)
          liveOverrides.clear(id)
        }
        // Restore selection cleared by the action menu's Move click.
        useViewer.getState().setSelection({ selectedIds: snapshots.map((s) => s.id) })
        setMovingNode(null)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('keydown', onKey)
      return () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('keydown', onKey)
        // Unmount cleanup. `historyPaused === true` here means none of
        // our terminal paths (commit, Esc) ran in this overlay — they
        // each call `resumeSceneHistory` and flip the flag.
        //
        // If `movingNodeOrigin === '3d'`, a 3D move tool finalised
        // while our overlay was still mounted (split view); the live
        // scene IS the committed state and reverting would stomp it.
        // Otherwise (origin is `null` or `'2d'`) we own the teardown
        // and revert any untracked apply() writes back to baseline.
        //
        // The two prior scenarios this block guarded against:
        //   - mid-drag unmount with apply() writes still present
        //   - 3D mover committing via `draftNode.commit` just before
        //     our unmount
        // are now distinguished by the origin flag — no scene-state
        // diff heuristic required.
        if (historyPaused) {
          if (hasMovedSinceStart) {
            const finalisedBy3D = useEditor.getState().movingNodeOrigin === '3d'
            if (!finalisedBy3D) {
              useScene.getState().updateNodes(snapshotsToUpdates(snapshots))
            }
          }
          resumeSceneHistory(useScene)
        }
        // Belt-and-suspenders: clear any live previews on abnormal
        // unmount paths too. Slab / ceiling sessions write to
        // `useLiveTransforms`; wall sessions write to
        // `useLiveNodeOverrides`. In pure 2D view the corresponding 3D
        // tool's cleanup isn't there to clear them for us.
        const liveTransforms = useLiveTransforms.getState()
        const liveOverrides = useLiveNodeOverrides.getState()
        for (const id of session.affectedIds) {
          liveTransforms.clear(id)
          liveOverrides.clear(id)
        }
        // Sessions that publish Figma-style alignment guides during `apply`
        // (item / shelf / column) leave them in the store; this cleanup runs
        // after every terminal path (commit + Esc both unmount via
        // `setMovingNode(null)`), so clearing here drops any lingering guide.
        useAlignmentGuides.getState().clear()
        // Same belt-and-suspenders pattern for the wall bridge ghost
        // previews — clear unconditionally so Esc / mid-drag unmount /
        // 3D-takeover paths all end up with no stale ghosts left over.
        // The wall session's `commit()` already clears them on the
        // happy path; this just covers the rest.
        useWallMoveGhosts.getState().clear()
      }
    }

    // ── Path 2 — generic free-floating translate ────────────────────
    const entry = scene.querySelector(`[data-node-id="${movingNode.id}"]`) as SVGGElement | null
    if (!entry) return

    const originalPosition = ((
      movingNode as unknown as {
        position?: [number, number, number]
      }
    ).position ?? [0, 0, 0]) as [number, number, number]

    // SVG units in this floorplan map 1:1 to world meters, and the
    // `<g data-node-id>` entry has no transform of its own when at rest,
    // so its untransformed bbox IS the world-space footprint. Cache the
    // moving entry's local bbox once (relative to originalPosition) and
    // derive anchors at any proposed (sx, sz) by translating it.
    const movingLocalBBox = entry.getBBox()
    const candidateAnchors: AlignmentAnchor[] = []
    const allEntries = scene.querySelectorAll('[data-node-id]')
    for (const el of Array.from(allEntries)) {
      const otherId = el.getAttribute('data-node-id')
      if (!otherId || otherId === movingNode.id) continue
      const b = (el as SVGGraphicsElement).getBBox()
      if (b.width <= 0 || b.height <= 0) continue
      candidateAnchors.push(...bboxAnchors(otherId, b.x, b.y, b.x + b.width, b.y + b.height))
    }

    let lastSnapped: [number, number] | null = null

    const onMove = (event: PointerEvent) => {
      // Same target guard as Path 1 — pointer must be over the floor
      // plan scene; otherwise we'd react to 3D-canvas moves with garbage
      // plan coords.
      const target = event.target as Element | null
      if (!target?.closest('[data-floorplan-scene]')) return
      const m = toMeters(event.clientX, event.clientY)
      if (!m) return

      // 1) Grid snap baseline (unchanged behaviour with Alt held).
      const [gridX, gridZ] = snapPointToGrid([m[0], m[1]], GRID_STEP)

      // 2) Alignment snap layered on top. Treat the grid-snapped point
      // as the "proposed" position so alignment competes from a stable
      // base rather than the raw cursor jitter. Alt bypasses alignment
      // entirely — same affordance Path 1 advertises in its "No Snap"
      // hint chip.
      let finalX = gridX
      let finalZ = gridZ
      if (!event.altKey && candidateAnchors.length > 0) {
        // Translate the cached local bbox to the proposed pos to get the
        // moving anchors at that location. The entry's untransformed
        // bbox is in world meters relative to the node's origin, so a
        // simple translate suffices.
        const dxProposed = gridX - originalPosition[0]
        const dzProposed = gridZ - originalPosition[2]
        // Corner-only for the moving node so it aligns by its edges, never
        // its centreline — matching the placement tools and Path 1 move
        // sessions. Candidates keep their full 9-point set (we DO want to
        // align to a neighbour's centre / edge-midpoints).
        const movingAnchors = bboxCornerAnchors(
          movingNode.id,
          movingLocalBBox.x + dxProposed,
          movingLocalBBox.y + dzProposed,
          movingLocalBBox.x + movingLocalBBox.width + dxProposed,
          movingLocalBBox.y + movingLocalBBox.height + dzProposed,
        )
        const result = resolveAlignment({
          moving: movingAnchors,
          candidates: candidateAnchors,
          threshold: ALIGNMENT_THRESHOLD_M,
        })
        if (result.snap) {
          finalX += result.snap.dx
          finalZ += result.snap.dz
        }
        useAlignmentGuides.getState().set(result.guides)
      } else {
        useAlignmentGuides.getState().clear()
      }

      const dx = finalX - originalPosition[0]
      const dz = finalZ - originalPosition[2]
      entry.setAttribute('transform', `translate(${dx} ${dz})`)
      lastSnapped = [finalX, finalZ]
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target as Element | null
      if (!target?.closest('[data-floorplan-scene]')) return

      const snapped = lastSnapped
      if (snapped) {
        const [sx, sz] = snapped
        const [, oldY] = originalPosition
        useScene
          .getState()
          .updateNode(movingNode.id as AnyNodeId, { position: [sx, oldY, sz] } as Partial<AnyNode>)
        const meta = (movingNode as unknown as { metadata?: Record<string, unknown> }).metadata
        if (meta?.isNew) {
          useScene.getState().updateNode(
            movingNode.id as AnyNodeId,
            {
              metadata: { ...meta, isNew: false },
            } as Partial<AnyNode>,
          )
        }
      }
      entry.removeAttribute('transform')
      useAlignmentGuides.getState().clear()
      setMovingNode(null)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        entry.removeAttribute('transform')
        useAlignmentGuides.getState().clear()
        setMovingNode(null)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKey)
      entry.removeAttribute('transform')
      useAlignmentGuides.getState().clear()
    }
  }, [isActive, movingNode, setMovingNode, setMovingNodeOrigin, hasMoveTarget, def])

  return null
}

// ── Snapshot helpers (shared shape with floorplan-registry-layer) ───
//
// Kept inline here to avoid a circular dependency through a shared
// utility module. If a third call site shows up, extract.

type NodeSnapshot = { id: AnyNodeId; data: Record<string, unknown> }

function snapshotNode(node: AnyNode): NodeSnapshot {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'type' || key === 'object') continue
    data[key] = Array.isArray(value) ? [...(value as unknown[])] : value
  }
  return { id: node.id, data }
}

function snapshotsToUpdates(snapshots: NodeSnapshot[]) {
  return snapshots.map((s) => ({ id: s.id, data: s.data }))
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const aKeys = Object.keys(a as Record<string, unknown>)
    const bKeys = Object.keys(b as Record<string, unknown>)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false
      }
    }
    return true
  }
  return false
}
