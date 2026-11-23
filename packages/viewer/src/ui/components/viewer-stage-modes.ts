export const VIEWER_STAGE_MODES = ['3d', '2d', 'split'] as const

export type ViewerStageMode = (typeof VIEWER_STAGE_MODES)[number]

const THREE_D_MODES = ['3d'] as const
const TWO_D_MODES = ['2d'] as const
const SPLIT_MODES = ['split'] as const
const THREE_D_TWO_D_MODES = ['3d', '2d'] as const
const THREE_D_SPLIT_MODES = ['3d', 'split'] as const
const TWO_D_SPLIT_MODES = ['2d', 'split'] as const

export function normalizeViewerStageModes(
  modes: readonly ViewerStageMode[] | undefined,
): readonly ViewerStageMode[] {
  if (!modes) return VIEWER_STAGE_MODES

  const has3D = modes.includes('3d')
  const has2D = modes.includes('2d')
  const hasSplit = modes.includes('split')

  if (has3D && has2D && hasSplit) return VIEWER_STAGE_MODES
  if (has3D && has2D) return THREE_D_TWO_D_MODES
  if (has3D && hasSplit) return THREE_D_SPLIT_MODES
  if (has2D && hasSplit) return TWO_D_SPLIT_MODES
  if (has2D) return TWO_D_MODES
  if (hasSplit) return SPLIT_MODES
  return THREE_D_MODES
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
