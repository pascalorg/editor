export const VIEWER_STAGE_MODES = ['3d', '2d', 'split'] as const

export type ViewerStageMode = (typeof VIEWER_STAGE_MODES)[number]

export function normalizeViewerStageModes(
  modes: readonly ViewerStageMode[] | undefined,
): ViewerStageMode[] {
  const requested = modes ?? VIEWER_STAGE_MODES
  const unique = VIEWER_STAGE_MODES.filter((mode) => requested.includes(mode))
  return unique.length > 0 ? unique : ['3d']
}

export function resolveViewerStageMode(
  mode: ViewerStageMode | undefined,
  modes: readonly ViewerStageMode[],
): ViewerStageMode {
  return mode && modes.includes(mode) ? mode : (modes[0] ?? '3d')
}

export function resolveMobileViewerStageMode(
  mode: ViewerStageMode,
  modes: readonly ViewerStageMode[],
): ViewerStageMode {
  if (mode !== 'split') return mode
  if (modes.includes('2d')) return '2d'
  if (modes.includes('3d')) return '3d'
  return 'split'
}

export function viewerStageIncludes3D(modes: readonly ViewerStageMode[]) {
  return modes.includes('3d') || modes.includes('split')
}
