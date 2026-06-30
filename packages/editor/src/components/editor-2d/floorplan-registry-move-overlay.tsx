'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  bboxAnchors,
  bboxCornerAnchors,
  emitter,
  type FloorplanMoveTargetSession,
  nodeRegistry,
  pauseSceneHistory,
  resumeSceneHistory,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { commitFreshPlacementSubtree } from '../../lib/fresh-planar-placement'
import { isFreshPlacementMetadata, stripPlacementMetadataFlags } from '../../lib/placement-metadata'
import { resolvePlanarCursorPosition } from '../../lib/planar-cursor-placement'
import { sfxEmitter } from '../../lib/sfx-bus'
import { resolveAlignmentForFloorplanView } from '../../lib/world-grid-snap'
import useAlignmentGuides from '../../store/use-alignment-guides'
import useEditor, { isGridSnapActive, isMagneticSnapActive } from '../../store/use-editor'
import { useMovingNode } from '../../store/use-interaction-scope'
import { useWallMoveGhosts } from '../../store/use-wall-move-ghosts'

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
  const movingNode = useMovingNode()
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

    const isPointerOverFloorplanScene = (clientX: number, clientY: number): boolean => {
      // The scene's `<g>` only covers painted SVG elements, so hovers over
      // empty grid background often target the parent SVG. Bounds keep the
      // cursor active anywhere inside the floor-plan viewport.
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
      // Last resolved position of the moved node — drives the move "tick" SFX.
      // Parity with the 3D move, which emits on any change of the resolved
      // position (every snapping mode, not only grid).
      let lastSnapKey: string | null = null
      // Live cursor location — updated on EVERY pointermove (even over the 3D
      // canvas) so R-key ownership can follow the pointer's CURRENT pane rather
      // than the sticky `hasMovedSinceStart`. Without this, once the user touched
      // the 2D pane the overlay claimed R forever and the 3D flip went dead.
      let pointerOverFloorplan = false
      const onPointerTrack = (event: PointerEvent) => {
        pointerOverFloorplan = isPointerOverFloorplanScene(event.clientX, event.clientY)
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
        // Move "tick" — same feedback the 3D move gives, which fires whenever the
        // resolved position changes (any snapping mode, not just grid), so it
        // ticks as the item lands on each new snapped/free position.
        const movedId = session.affectedIds[0]
        const moved = movedId ? useScene.getState().nodes[movedId] : undefined
        const pos = (moved as { position?: [number, number, number] } | undefined)?.position
        if (pos) {
          const key = `${pos[0]},${pos[2]}`
          if (key !== lastSnapKey) {
            lastSnapKey = key
            sfxEmitter.emit('sfx:grid-snap')
          }
        }
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
          useViewer.getState().setSelection({ selectedIds: snapshots.map((s) => s.id) })
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

        for (const snap of snapshots) {
          const current = sceneState[snap.id]
          if (!current || !isFreshPlacementMetadata((current as { metadata?: unknown }).metadata)) {
            continue
          }
          const existing = finalUpdates.find((update) => update.id === snap.id)
          const metadata = stripPlacementMetadataFlags((current as { metadata?: unknown }).metadata)
          if (existing) {
            existing.data.metadata = metadata
            existing.data.visible = true
          } else {
            finalUpdates.push({
              id: snap.id,
              data: { metadata, visible: true },
            })
          }
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
        if (!hasMovedSinceStart) return

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
        swallowNextClick()
      }

      const onKey = (event: KeyboardEvent) => {
        // R flips a directional kind's facing mid-placement (door / window:
        // front ↔ back). The session records the flip and re-runs its last
        // apply so the 2D symbol updates immediately; kinds without a facing
        // leave `flipSide` unset and R falls through to the global handler.
        //
        // Ownership follows the CURRENT pointer pane, not a sticky flag: the 3D
        // move tool ALSO listens for R on `window`. We own R only while the
        // cursor is over the 2D floor-plan pane (`pointerOverFloorplan`) AND the
        // 2D mover has actually engaged (`hasMovedSinceStart`); then we
        // `stopImmediatePropagation` (this handler is CAPTURE-phase, so it runs
        // first) so the 3D tool can't also flip. When the cursor is over the 3D
        // pane we yield — the 3D tool owns R there. (The old sticky
        // `hasMovedSinceStart`-only gate made the overlay claim R forever after
        // the first 2D move, killing the 3D flip.)
        if (event.key === 'r' || event.key === 'R') {
          // Yield Cmd/Ctrl+R to the browser reload instead of flipping the side.
          if (event.metaKey || event.ctrlKey) return
          if (!(session.flipSide && hasMovedSinceStart && pointerOverFloorplan)) return
          if (event.repeat) return
          const t = event.target as HTMLElement | null
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            return
          }
          event.preventDefault()
          event.stopImmediatePropagation()
          session.flipSide()
          sfxEmitter.emit('sfx:item-rotate')
          return
        }
        if (event.key !== 'Escape') return
        // Claim teardown ownership so the 3D move tool's cleanup skips
        // its own restore — without this, both sides would race to
        // write the same baseline, harmless but wasteful.
        setMovingNodeOrigin('2d')
        if (isFreshPlacementMetadata((movingNode as { metadata?: unknown }).metadata)) {
          emitter.emit('tool:cancel')
          useScene.getState().deleteNode(movingNode.id as AnyNodeId)
          if (historyPaused) {
            resumeSceneHistory(useScene)
            historyPaused = false
          }
          const liveTransforms = useLiveTransforms.getState()
          const liveOverrides = useLiveNodeOverrides.getState()
          for (const id of session.affectedIds) {
            liveTransforms.clear(id)
            liveOverrides.clear(id)
          }
          useAlignmentGuides.getState().clear()
          setMovingNode(null)
          return
        }
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

      window.addEventListener('pointermove', onPointerTrack)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onPointerUp)
      // Capture phase so this runs BEFORE the 3D move tool's bubble-phase R
      // listener — when the cursor is over the 2D pane, `stopImmediatePropagation`
      // then pre-empts it so only one handler flips.
      window.addEventListener('keydown', onKey, true)
      return () => {
        window.removeEventListener('pointermove', onPointerTrack)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('keydown', onKey, true)
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

    // Polyline kinds (duct / pipe / lineset) carry a `path`, not a
    // `position` — translating a `position` here would write a field their
    // schema ignores and snap the run back. For those we move every path
    // point by the cursor delta and commit the translated `path` instead.
    // The reference origin is the path centre so the SVG `translate` delta
    // matches the geometry's actual location (which isn't at [0,0,0]).
    // Only 3D `[x, y, z]` polyline kinds (duct / pipe / lineset) are handled
    // here. A spline fence also carries a `path`, but it is 2D (`[x, y]`) and
    // moves through its own `floorplanMoveTarget`, so exclude shorter tuples.
    const rawPath = (movingNode as { path?: unknown }).path
    const originalPath =
      Array.isArray(rawPath) && Array.isArray(rawPath[0]) && rawPath[0].length >= 3
        ? (rawPath as [number, number, number][]).map((p) => [...p] as [number, number, number])
        : null
    const originalPosition: [number, number, number] = originalPath
      ? (() => {
          let cx = 0
          let cz = 0
          for (const p of originalPath) {
            cx += p[0]
            cz += p[2]
          }
          const n = originalPath.length || 1
          return [cx / n, originalPath[0]?.[1] ?? 0, cz / n]
        })()
      : (((movingNode as unknown as { position?: [number, number, number] }).position ?? [
          0, 0, 0,
        ]) as [number, number, number])
    const isFreshPlacement = isFreshPlacementMetadata(
      (movingNode as { metadata?: unknown }).metadata,
    )

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
      // Skip only fully-degenerate (point) entries. A thin run (duct / pipe /
      // lineset drawn as a line) has one zero dimension but is still a valid
      // alignment target — its endpoints become line anchors.
      if (b.width <= 0 && b.height <= 0) continue
      candidateAnchors.push(...bboxAnchors(otherId, b.x, b.y, b.x + b.width, b.y + b.height))
    }

    let lastSnapped: [number, number] | null = null
    let dragAnchor: [number, number] | null = null

    // Footprint bounding box drawn around the dragged entry — the 2D
    // counterpart of the 3D `DragBoundingBox`, so a moved / duplicated node
    // reads the same in both views. Green wireframe rect over the entry's
    // own bbox, translated in lockstep with it. The entry stays visible the
    // whole drag (no hide-until-move) so it never appears to vanish.
    const SVG_NS = 'http://www.w3.org/2000/svg'
    const boxEl = document.createElementNS(SVG_NS, 'rect')
    boxEl.setAttribute('x', String(movingLocalBBox.x))
    boxEl.setAttribute('y', String(movingLocalBBox.y))
    boxEl.setAttribute('width', String(movingLocalBBox.width))
    boxEl.setAttribute('height', String(movingLocalBBox.height))
    boxEl.setAttribute('fill', 'none')
    boxEl.setAttribute('stroke', '#22c55e')
    boxEl.setAttribute('stroke-width', '1.5')
    boxEl.setAttribute('vector-effect', 'non-scaling-stroke')
    boxEl.setAttribute('pointer-events', 'none')
    scene.appendChild(boxEl)

    const onMove = (event: PointerEvent) => {
      // Same target guard as Path 1 — pointer must be over the floor
      // plan scene; otherwise we'd react to 3D-canvas moves with garbage
      // plan coords.
      if (!isPointerOverFloorplanScene(event.clientX, event.clientY)) return
      const m = toMeters(event.clientX, event.clientY)
      if (!m) return

      // 1) Grid snap baseline. Fresh catalog placement is absolute under
      // the cursor; existing moves preserve the cursor's grab offset. Grid
      // follows the active snapping mode (Shift cycles it); raw cursor in
      // any non-grid mode.
      const gridStep = useEditor.getState().gridSnapStep
      const snap = (value: number) =>
        isGridSnapActive() ? Math.round(value / gridStep) * gridStep : value
      const resolved = resolvePlanarCursorPosition({
        cursor: [m[0], m[1]],
        original: [originalPosition[0], originalPosition[2]],
        anchor: dragAnchor,
        mode: isFreshPlacement ? 'absolute' : 'relative',
        snap,
      })
      dragAnchor = resolved.anchor
      const [gridX, gridZ] = resolved.point

      // 2) Alignment snap layered on top. Treat the grid-snapped point
      // as the "proposed" position so alignment competes from a stable
      // base rather than the raw cursor jitter. Alignment ("lines") follows
      // the magnetic snapping mode — independent of grid; Alt is force-place,
      // not a snap bypass.
      let finalX = gridX
      let finalZ = gridZ
      if (isMagneticSnapActive() && candidateAnchors.length > 0) {
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
        // Local-frame resolve (anchors come from the building-local
        // SVG `getBBox()`). Guides land in the editor-local alignment
        // store, which the 2D FloorplanAlignmentGuideLayer renders
        // inside the rotated scene <g>. The 3D pipeline uses a
        // separate store, so frames stay isolated per surface.
        const result = resolveAlignmentForFloorplanView({
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
      boxEl.setAttribute('transform', `translate(${dx} ${dz})`)
      lastSnapped = [finalX, finalZ]
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (!isPointerOverFloorplanScene(event.clientX, event.clientY)) return

      const snapped = lastSnapped
      if (!snapped) return
      const [sx, sz] = snapped
      const [, oldY] = originalPosition
      setMovingNodeOrigin('2d')
      let selectedId = movingNode.id as AnyNodeId
      if (originalPath) {
        // Polyline kinds: shift every point by the committed delta and
        // write `path`. Strip the fresh-placement flags on first drop.
        const dx = sx - originalPosition[0]
        const dz = sz - originalPosition[2]
        const nextPath = originalPath.map(
          ([x, y, z]) => [x + dx, y, z + dz] as [number, number, number],
        )
        useScene.getState().updateNode(
          movingNode.id as AnyNodeId,
          (isFreshPlacement
            ? {
                path: nextPath,
                metadata: stripPlacementMetadataFlags(
                  (movingNode as { metadata?: unknown }).metadata,
                ),
                visible: true,
              }
            : { path: nextPath }) as Partial<AnyNode>,
        )
        useViewer.getState().setSelection({ selectedIds: [movingNode.id as AnyNodeId] })
        entry.removeAttribute('transform')
        useAlignmentGuides.getState().clear()
        setMovingNode(null)
        swallowNextClick()
        return
      }
      if (isFreshPlacement) {
        selectedId =
          commitFreshPlacementSubtree(
            movingNode.id as AnyNodeId,
            {
              position: [sx, oldY, sz],
              metadata: stripPlacementMetadataFlags(
                (movingNode as { metadata?: unknown }).metadata,
              ),
              visible: true,
            } as Partial<AnyNode>,
          ) ?? selectedId
      } else {
        useScene.getState().updateNode(
          movingNode.id as AnyNodeId,
          {
            position: [sx, oldY, sz],
          } as Partial<AnyNode>,
        )
      }
      useViewer.getState().setSelection({ selectedIds: [selectedId] })
      entry.removeAttribute('transform')
      useAlignmentGuides.getState().clear()
      setMovingNode(null)
      swallowNextClick()
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMovingNodeOrigin('2d')
        if (isFreshPlacement) {
          emitter.emit('tool:cancel')
          const temporal = useScene.temporal.getState()
          const wasTracking = (temporal as { isTracking?: boolean }).isTracking !== false
          if (wasTracking) temporal.pause()
          useScene.getState().deleteNode(movingNode.id as AnyNodeId)
          if (wasTracking) temporal.resume()
        }
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
      // Always un-hide on teardown so a committed copy shows and a
      // never-revealed entry doesn't leak a hidden style onto a reused node.
      entry.style.visibility = ''
      boxEl.remove()
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

function swallowNextClick() {
  const swallowClick = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    window.removeEventListener('click', swallowClick, true)
  }
  window.addEventListener('click', swallowClick, true)
  // Safety net: if no click fires (e.g. user dragged enough to suppress it),
  // drop the listener on the next tick.
  setTimeout(() => {
    window.removeEventListener('click', swallowClick, true)
  }, 0)
}
