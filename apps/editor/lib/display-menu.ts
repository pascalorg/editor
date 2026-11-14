/** The views on screen, as `visibleScene` reports them (`null`: none yet). */
export type DisplayMenuScene = '2d' | '3d' | 'split' | null

export type DisplayMenuLayout = {
  /** The header's scope line: what the settings apply to. */
  scope: 'shared' | '2d' | '3d'
  /** Other levels (walls below / above) draw on the plan only. */
  otherLevels: boolean
  /** Plan: floor plan mode and annotations. */
  plan: boolean
  /** Scene: ceilings, measurements and the 3D look. */
  scene: boolean
  /** With both views up, the view-specific groups say which view they change. */
  viewTags: boolean
}

/**
 * Which groups the Display menu shows for the views on screen. Show,
 * Dimensions and Editing apply to both views and are always there.
 */
export function displayMenuLayout(scene: DisplayMenuScene): DisplayMenuLayout {
  const plan = scene !== '3d'
  const model = scene !== '2d'
  return {
    scope: plan && model ? 'shared' : plan ? '2d' : '3d',
    otherLevels: plan,
    plan,
    scene: model,
    viewTags: plan && model,
  }
}
