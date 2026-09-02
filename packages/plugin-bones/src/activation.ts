import { effectiveViewMode, FramingNode, type ViewMode } from './framing/schema'
import { buildServicePointNodes } from './service/place'
import { useBonesStore } from './store'

/**
 * X-ray activation & view-mode contract — the CLICK-SCOPED replacement for
 * the renderer's old mount-time wall-mode magic (user round 2026-08-20).
 *
 * Why click-scoped: the old one-shot lived in a FramingRenderer mount effect
 * behind two async hops (lazy renderer chunk + dynamic viewer import) with a
 * per-instance restore-on-unmount. That design both missed (imposition rode
 * the RENDERER lifecycle, not the user's action) and misfired (with two
 * X-rayed levels, removing one restored the pre-X-ray wall mode while the
 * other X-ray was still on — its own instance had recorded nothing because
 * walls were already 'down' at its mount; any host remount could likewise
 * re-impose 'down' over a manual choice). Here every wall-mode write happens
 * exactly at a user action, once:
 *
 *  - activateXray  (the "X-Ray this level" buttons) → walls 'down' one-shot
 *  - setXrayViewMode off→(xray|basement)            → walls 'down' one-shot
 *  - setXrayViewMode (xray|basement)→off            → restore pre-X-ray mode
 *  - removeXray    (the panel Remove button)        → restore pre-X-ray mode
 *  - xray↔basement                                  → wall mode untouched
 *
 * Nothing re-imposes on re-render/recompute/remount: after activation the
 * host wall-mode control is entirely the user's. Restore only fires while
 * walls are still 'down' — a manual change since activation is respected.
 * The pre-X-ray mode lives in the Bones session store (useBonesStore), not
 * on the scene.
 *
 * UNDO CONTRACT (deliberate — kept through browser QA round 3): undo
 * restores CONTENT, never viewer state. Undoing the activation entry
 * removes the framing node + service points but leaves the wall chip on
 * Low — wall mode is a host viewer preference outside scene history, and
 * replaying viewer writes on undo/redo would fight the user's own chip
 * clicks (the exact re-imposition class this module was built to kill).
 * The restore belongs ONLY to the explicit deactivation actions above
 * (viewMode → 'off', panel Remove); after an undo the pre-X-ray mode is
 * one click away on the host control. Same rule for renderer unmounts and
 * MCP deletions of the framing node: content paths never touch wall mode.
 * Checklist row A5 carries this contract.
 *
 * Store handles are passed in (never imported): '@pascal-app/viewer' drags
 * browser-only deps that must not evaluate under bun test, and injected
 * fakes keep the whole contract headlessly testable.
 */

/** The slice of the host scene store this module drives (duck-typed — the
 * published core typings lag the runtime API, same cast the renderer uses). */
export type SceneStateLike = {
  nodes: Record<string, Record<string, unknown>>
  applyNodeChanges: (changes: {
    create?: { node: unknown; parentId?: unknown }[]
    update?: { id: unknown; data: Record<string, unknown> }[]
    delete?: unknown[]
  }) => void
  updateNode: (id: never, data: never) => void
}
export type SceneLike = { getState: () => SceneStateLike }

/** The slice of the host viewer store this module drives. */
export type ViewerStateLike = {
  wallMode?: string
  setWallMode?: (mode: string) => void
}
export type ViewerLike = { getState: () => ViewerStateLike }

/** One-shot: remember the user's wall mode and switch the host to 'down'
 * (Low) — the mode whose hidden shells let the X-ray read as a dollhouse. */
export function imposeLowWalls(viewer: ViewerLike): void {
  const v = viewer.getState()
  if (!v.setWallMode || v.wallMode === 'down') return
  useBonesStore.getState().setWallModeBeforeXray(v.wallMode ?? 'up')
  v.setWallMode('down')
}

/** Counterpart: back to the remembered pre-X-ray mode ('up' when unknown) —
 * but ONLY if walls are still 'down'; a manual change since is respected. */
export function releaseLowWalls(viewer: ViewerLike): void {
  const v = viewer.getState()
  if (!v.setWallMode || v.wallMode !== 'down') return
  v.setWallMode(useBonesStore.getState().wallModeBeforeXray ?? 'up')
}

/**
 * INVARIANT W1 (skeptic blocker, round 2026-08-21): the wall-mode restore
 * NEVER fires while any OTHER X-ray is live. Wall mode is one global host
 * pref but X-rays are per-level — with levels A and B both active, removing
 * A (or switching A to Normal) must leave walls 'down' for B; the restore
 * belongs to whichever off/remove action deactivates the LAST live X-ray.
 * "Live" = a bones:framing node whose effective view mode isn't 'off' — an
 * X-ray parked in Normal imposes nothing, so it doesn't hold the walls.
 */
function otherXrayLive(
  nodes: Record<string, Record<string, unknown>>,
  excludeId: string,
): boolean {
  return Object.values(nodes).some(
    (n) =>
      n.type === 'bones:framing' &&
      String(n.id) !== excludeId &&
      effectiveViewMode(n as { viewMode?: unknown; seeThrough?: unknown }) !== 'off',
  )
}

/**
 * "X-Ray this level": create the framing node AND every service point at the
 * engines' auto spots in ONE applyNodeChanges — one store transaction, one
 * undo entry (undo removes the X-ray and its service points together).
 * `servicesSeeded` latches in the same parse when anything was placeable, so
 * the renderer's auto-heal never re-seeds (and never resurrects a service
 * point the user later deletes). Walls go Low as part of the same click.
 */
export function activateXray(
  scene: SceneLike,
  levelId: string,
  viewer?: ViewerLike | null,
): FramingNode {
  const state = scene.getState()
  const services = buildServicePointNodes(state.nodes, levelId)
  const framing = FramingNode.parse({
    jurisdiction: 'AUTO',
    servicesSeeded: services.length > 0,
  })
  state.applyNodeChanges({
    create: [
      { node: framing, parentId: levelId },
      ...services.map((node) => ({ node, parentId: levelId })),
    ],
  })
  if (viewer) imposeLowWalls(viewer)
  return framing
}

/**
 * The panel's view-mode control: write `viewMode` and apply the wall-mode
 * side of the contract for the off-boundary transitions. The control IS the
 * switch (unlike config knobs it drives wall mode on every off↔on flip);
 * between the two active modes wall mode never moves.
 */
export function setXrayViewMode(
  scene: SceneLike,
  framingNode: { id: string; viewMode?: unknown; seeThrough?: unknown },
  next: ViewMode,
  viewer?: ViewerLike | null,
): void {
  const prev = effectiveViewMode(framingNode)
  if (prev === next) return
  const state = scene.getState()
  state.updateNode(framingNode.id as never, { viewMode: next } as never)
  if (!viewer) return
  if (prev === 'off') imposeLowWalls(viewer)
  // Invariant W1: another live X-ray still needs the walls down — the
  // restore rides the action that turns off the LAST one. (Self excluded by
  // id: this node just went 'off' either way.)
  else if (next === 'off' && !otherXrayLive(state.nodes, framingNode.id)) {
    releaseLowWalls(viewer)
  }
}

/**
 * The panel's Remove button: delete the framing node AND the level's
 * auto-managed bones nodes (service points + device proxies) in ONE entry —
 * Remove means "deactivate the X-ray on this level", and leaving eight
 * auto-placed service signs standing on a normal house would be litter.
 * A single undo brings the whole arrangement back. Walls restore like
 * viewMode 'off'.
 */
export function removeXray(
  scene: SceneLike,
  framingNodeId: string,
  levelId: string,
  viewer?: ViewerLike | null,
): void {
  const state = scene.getState()
  const companions = Object.values(state.nodes)
    .filter(
      (n) =>
        (n.type === 'bones:service' || n.type === 'bones:device') && n.parentId === levelId,
    )
    .map((n) => n.id)
  state.applyNodeChanges({ delete: [framingNodeId, ...companions] })
  // Invariant W1: only the removal of the LAST live X-ray releases the
  // walls (the deleted node is excluded by id whether or not the store has
  // already dropped it).
  if (viewer && !otherXrayLive(state.nodes, framingNodeId)) releaseLowWalls(viewer)
}
