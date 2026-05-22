'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanMoveTargetSession,
  nodeRegistry,
  pauseSceneHistory,
  resumeSceneHistory,
  snapPointToGrid,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'

const GRID_STEP = 0.5

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

        // Apply once more at the pointer-up coords before committing.
        // Browsers don't guarantee a pointermove fires right before
        // pointerup — a quick click after a drag can land pointerup a
        // few pixels past the last pointermove. Without this re-apply,
        // the commit would freeze the item at the stale pointermove
        // position, leaving a visible drift between where the user
        // released the click and where the item lands.
        const finalPlanPoint = toMeters(event.clientX, event.clientY)
        if (finalPlanPoint) {
          hasMovedSinceStart = true
          session.apply({
            planPoint: finalPlanPoint,
            modifiers: {
              shiftKey: event.shiftKey,
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
            },
          })
        }

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
        // Clear any live-transform previews the session wrote (slab /
        // ceiling 2D move stages a translation delta in
        // `useLiveTransforms`; without this clear, escape leaves the
        // 2D layer rendering the polygon at the cancelled delta).
        for (const id of session.affectedIds) {
          useLiveTransforms.getState().clear(id)
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
        // Belt-and-suspenders: clear any live-transform previews on
        // abnormal unmount paths too. Slab / ceiling sessions write
        // `useLiveTransforms` to drive the smooth drag visual; in pure
        // 2D view the 3D `MoveSlabTool` cleanup isn't there to clear
        // it for us.
        for (const id of session.affectedIds) {
          useLiveTransforms.getState().clear(id)
        }
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

    let lastSnapped: [number, number] | null = null

    const onMove = (event: PointerEvent) => {
      // Same target guard as Path 1 — pointer must be over the floor
      // plan scene; otherwise we'd react to 3D-canvas moves with garbage
      // plan coords.
      const target = event.target as Element | null
      if (!target?.closest('[data-floorplan-scene]')) return
      const m = toMeters(event.clientX, event.clientY)
      if (!m) return
      const [sx, sz] = snapPointToGrid([m[0], m[1]], GRID_STEP)
      const dx = sx - originalPosition[0]
      const dz = sz - originalPosition[2]
      entry.setAttribute('transform', `translate(${dx} ${dz})`)
      lastSnapped = [sx, sz]
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
      setMovingNode(null)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        entry.removeAttribute('transform')
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
