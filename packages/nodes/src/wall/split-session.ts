import {
  getWallCurveLength,
  planWallDivisions,
  runAsSingleSceneHistoryStep,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  isGridSnapActive,
  isMagneticSnapActive,
  triggerSFX,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import {
  snapWallSplitDistance,
  WALL_SPLIT_MAX_CUTS,
  wallSplitAnchors,
  wallSplitDistances,
  wallSplitPreview,
} from './split-preview'
import { useWallSplit, type WallSplitDraft } from './split-store'

// Pointer distance (m) within which a 'lines' alignment target catches the cut.
const ALIGNMENT_TOLERANCE = 0.2

const ownsSplit = () => {
  const { scope } = useInteractionScope.getState()
  return scope.kind === 'reshaping' && scope.reshape === 'split'
}
const currentWall = (draft: WallSplitDraft) => {
  const wall = useScene.getState().nodes[draft.wallId]
  return wall?.type === 'wall' ? wall : null
}
const withPreview = (draft: Omit<WallSplitDraft, 'preview'>, wall: WallNode): WallSplitDraft => ({
  ...draft,
  preview: wallSplitPreview(
    useScene.getState().nodes,
    wall,
    wallSplitDistances(getWallCurveLength(wall), draft.cuts, draft.distance),
  ),
})

let teardown: (() => void) | null = null

/**
 * A split session: the wall's `reshaping` scope (so the snapping chip and the
 * kind's HUD hints resolve), one centred cut, and the watchers that end it —
 * Esc, the wall or its edit rights going away, another interaction, leaving
 * select mode. Both views render the same draft; either can commit.
 */
export function openWallSplit(wall: WallNode) {
  if (useScene.getState().readOnly) return
  closeWallSplit()
  useEditor.getState().setMode('select')
  useInteractionScope
    .getState()
    .begin({ kind: 'reshaping', nodeId: wall.id, reshape: 'split', driver: 'tool' })
  useWallSplit
    .getState()
    .setDraft(
      withPreview(
        { wallId: wall.id, cuts: 1, distance: getWallCurveLength(wall) / 2, snap: null },
        wall,
      ),
    )
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    closeWallSplit()
  }
  const stopScene = useScene.subscribe((state, previous) => {
    if (state.readOnly || state.nodes[wall.id]?.type !== 'wall') closeWallSplit()
    else if (state.nodes !== previous.nodes) refreshWallSplit()
  })
  const stopScope = useInteractionScope.subscribe(({ scope }) => {
    if (!(scope.kind === 'reshaping' && scope.reshape === 'split')) closeWallSplit()
  })
  const stopEditor = useEditor.subscribe((state) => {
    if (
      state.mode !== 'select' ||
      state.isCaptureMode ||
      state.isPreviewMode ||
      state.isFirstPersonMode
    )
      closeWallSplit()
  })
  const hasWindow = typeof window !== 'undefined'
  if (hasWindow) window.addEventListener('keydown', onKey, true)
  teardown = () => {
    if (hasWindow) window.removeEventListener('keydown', onKey, true)
    stopScene()
    stopScope()
    stopEditor()
  }
}

export function closeWallSplit() {
  const stop = teardown
  teardown = null
  stop?.()
  useWallSplit.getState().setDraft(null)
  useInteractionScope
    .getState()
    .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'split')
}

/** Pointer projected onto the wall; Alt (`free`) skips snapping. */
export function hoverWallSplit(raw: number, free = false) {
  const draft = useWallSplit.getState().draft
  // Several cuts stay evenly spaced, so the pointer has nothing to move.
  if (!draft || draft.cuts > 1 || !ownsSplit()) return
  const wall = currentWall(draft)
  if (!wall) return closeWallSplit()
  const { distance, snap } = free
    ? { distance: raw, snap: null }
    : snapWallSplitDistance(wall, raw, {
        gridStep: isGridSnapActive() ? useEditor.getState().gridSnapStep : null,
        anchors: isMagneticSnapActive() ? wallSplitAnchors(useScene.getState().nodes, wall) : null,
        tolerance: ALIGNMENT_TOLERANCE,
      })
  if (distance === draft.distance && snap?.kind === draft.snap?.kind) return
  useWallSplit.getState().setDraft(withPreview({ ...draft, distance, snap }, wall))
}

export function setWallSplitCuts(cuts: number) {
  const draft = useWallSplit.getState().draft
  if (!draft || !ownsSplit()) return
  const next = Math.min(WALL_SPLIT_MAX_CUTS, Math.max(1, Math.round(cuts)))
  if (next === draft.cuts) return
  const wall = currentWall(draft)
  if (!wall) return closeWallSplit()
  useWallSplit.getState().setDraft(withPreview({ ...draft, cuts: next }, wall))
}

/** Re-plan against the current scene (after an external edit). */
export function refreshWallSplit() {
  const draft = useWallSplit.getState().draft
  if (!draft) return
  const wall = currentWall(draft)
  if (!wall) return closeWallSplit()
  useWallSplit.getState().setDraft(withPreview(draft, wall))
}

export function commitWallSplit() {
  const draft = useWallSplit.getState().draft
  const current = useScene.getState()
  if (!draft || current.readOnly || !ownsSplit()) return
  const wall = currentWall(draft)
  if (!wall) return closeWallSplit()
  const checked = withPreview(draft, wall)
  if (!checked.preview.valid) return useWallSplit.getState().setDraft(checked)
  const plan = planWallDivisions(current.nodes, wall.id, checked.preview.distances)
  runAsSingleSceneHistoryStep(useScene, () => current.applyNodeChanges(plan.changes))
  closeWallSplit()
  triggerSFX('sfx:structure-build')
}
