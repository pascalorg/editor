/**
 * The stage is one or two panes, each showing one view: the 3D scene, the 2D
 * plan, or a view a host or plugin registered (`registerEditorHostView`). A view
 * sits in at most one pane — the 3D canvas owns a single WebGL context and the
 * plan a single interaction session — so every write keeps the panes distinct.
 *
 * Each workspace keeps its own layout, so Studio can sit on 3D | Gallery while
 * Edit stays on 2D | 3D.
 */

export const VIEW_3D = '3d'
export const VIEW_2D = '2d'

export type ViewPaneIndex = 0 | 1

export type ViewLayout = {
  split: boolean
  /** `panes[1]` is what split opens beside `panes[0]`, also while unsplit. */
  panes: readonly [string, string]
  /** Width of pane 0 as a fraction of the stage. */
  ratio: number
  focus: ViewPaneIndex
}

export const MIN_VIEW_PANE_RATIO = 0.15
export const MAX_VIEW_PANE_RATIO = 0.85

export const DEFAULT_VIEW_LAYOUT: ViewLayout = {
  split: false,
  panes: [VIEW_3D, VIEW_2D],
  ratio: 0.5,
  focus: 0,
}

/** Capture and first person frame through the 3D camera, whatever the layout says. */
const SINGLE_3D_LAYOUT: ViewLayout = DEFAULT_VIEW_LAYOUT

export function clampViewPaneRatio(value: unknown): number {
  if (!(typeof value === 'number' && Number.isFinite(value))) return DEFAULT_VIEW_LAYOUT.ratio
  return Math.min(MAX_VIEW_PANE_RATIO, Math.max(MIN_VIEW_PANE_RATIO, value))
}

export function normalizeViewLayout(value: unknown): ViewLayout {
  const candidate = value as Partial<ViewLayout> | null | undefined
  const panes = candidate?.panes
  const first = typeof panes?.[0] === 'string' && panes[0] ? panes[0] : VIEW_3D
  let second = typeof panes?.[1] === 'string' && panes[1] ? panes[1] : VIEW_2D
  if (second === first) second = first === VIEW_3D ? VIEW_2D : VIEW_3D
  const split = candidate?.split === true
  return {
    split,
    panes: [first, second],
    ratio: clampViewPaneRatio(candidate?.ratio),
    focus: split && candidate?.focus === 1 ? 1 : 0,
  }
}

export function visibleViews(layout: ViewLayout): readonly string[] {
  return layout.split ? layout.panes : [layout.panes[0]]
}

export function paneOfView(layout: ViewLayout, viewId: string): ViewPaneIndex | null {
  if (layout.panes[0] === viewId) return 0
  if (layout.split && layout.panes[1] === viewId) return 1
  return null
}

/** Put `viewId` in `pane`; if the other pane holds it, the two trade places. */
export function withPaneView(layout: ViewLayout, pane: ViewPaneIndex, viewId: string): ViewLayout {
  const target: ViewPaneIndex = layout.split ? pane : 0
  const other: ViewPaneIndex = target === 0 ? 1 : 0
  const panes: [string, string] = [layout.panes[0], layout.panes[1]]
  if (panes[target] === viewId) return { ...layout, focus: target }
  if (panes[other] === viewId) panes[other] = panes[target]
  panes[target] = viewId
  return { ...layout, panes, focus: target }
}

/**
 * Show `viewId`. A view already on screen just takes focus; otherwise it
 * replaces the focused pane, or with `beside` opens next to it.
 */
export function withView(
  layout: ViewLayout,
  viewId: string,
  options: { beside?: boolean } = {},
): ViewLayout {
  const pane = paneOfView(layout, viewId)
  if (pane !== null) return { ...layout, focus: pane }
  if (!options.beside) return withPaneView(layout, layout.focus, viewId)
  if (!layout.split) return withPaneView({ ...layout, split: true }, 1, viewId)
  return withPaneView(layout, layout.focus === 0 ? 1 : 0, viewId)
}

/**
 * Opening the split from 3D brings the plan in on the left, where the split has
 * always put it, with 3D keeping focus. Closing a split keeps the focused pane.
 */
export function withSplitToggled(layout: ViewLayout): ViewLayout {
  if (!layout.split) {
    if (layout.panes[0] === VIEW_3D && layout.panes[1] === VIEW_2D) {
      return { ...layout, split: true, panes: [VIEW_2D, VIEW_3D], focus: 1 }
    }
    return { ...layout, split: true }
  }
  const kept = layout.focus === 1 ? swapped(layout) : layout
  return { ...kept, split: false, focus: 0 }
}

/**
 * Close a view: a split collapses to the other pane; a single pane goes back to
 * the scene.
 */
export function withoutView(layout: ViewLayout, viewId: string): ViewLayout {
  const pane = paneOfView(layout, viewId)
  if (pane === null) return layout
  const kept = layout.split ? layout.panes[pane === 0 ? 1 : 0] : VIEW_3D
  return { ...layout, split: false, panes: [kept, kept === VIEW_3D ? VIEW_2D : VIEW_3D], focus: 0 }
}

export function swapped(layout: ViewLayout): ViewLayout {
  return {
    ...layout,
    panes: [layout.panes[1], layout.panes[0]],
    ratio: 1 - layout.ratio,
    focus: layout.focus === 0 ? 1 : 0,
  }
}

type ViewLayoutState = {
  viewLayouts: Readonly<Record<string, ViewLayout>>
  workspaceMode: string
  isCaptureMode: boolean
  isFirstPersonMode: boolean
}

export function storedViewLayout(state: Pick<ViewLayoutState, 'viewLayouts' | 'workspaceMode'>) {
  return state.viewLayouts[state.workspaceMode] ?? DEFAULT_VIEW_LAYOUT
}

/** The layout on screen: the workspace's own, unless capture or first person needs 3D alone. */
export function activeViewLayout(state: ViewLayoutState): ViewLayout {
  if (state.isCaptureMode || state.isFirstPersonMode) return SINGLE_3D_LAYOUT
  return storedViewLayout(state)
}

export function isViewVisible(state: ViewLayoutState, viewId: string): boolean {
  return paneOfView(activeViewLayout(state), viewId) !== null
}

export type VisibleScene = '3d' | '2d' | 'split'

/** A layout showing just the scene: 3D, the plan, or the plan beside 3D (the split as it always was). */
export function sceneLayout(scene: VisibleScene, ratio = DEFAULT_VIEW_LAYOUT.ratio): ViewLayout {
  if (scene === '3d') return DEFAULT_VIEW_LAYOUT
  return {
    split: scene === 'split',
    panes: [VIEW_2D, VIEW_3D],
    ratio: clampViewPaneRatio(ratio),
    focus: 0,
  }
}

/**
 * Which projections of the scene are on screen — 3D alone, the plan alone, or
 * both side by side — or `null` while the panes show other views only. The
 * code that hands input between the canvas and the plan reads this: a plan
 * beside a gallery owns input exactly as a plan alone does.
 */
export function visibleScene(state: ViewLayoutState): VisibleScene | null {
  const layout = activeViewLayout(state)
  const has3d = paneOfView(layout, VIEW_3D) !== null
  const has2d = paneOfView(layout, VIEW_2D) !== null
  if (has3d && has2d) return 'split'
  if (has3d) return '3d'
  if (has2d) return '2d'
  return null
}

/**
 * Layouts saved before views existed stored one `viewMode` (`'3d' | '2d' |
 * 'split'`, the plan always on the left) and the plan's width.
 */
export function viewLayoutFromLegacy(legacy: {
  viewMode?: unknown
  isFloorplanOpen?: unknown
  floorplanPaneRatio?: unknown
}): ViewLayout {
  const viewMode =
    legacy.viewMode === '2d' || legacy.viewMode === '3d' || legacy.viewMode === 'split'
      ? legacy.viewMode
      : legacy.isFloorplanOpen === true
        ? 'split'
        : '3d'
  return sceneLayout(viewMode, clampViewPaneRatio(legacy.floorplanPaneRatio))
}
