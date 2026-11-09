import {
  type FloorplanAnnotationVisibility,
  revealFloorplanAnnotationRole,
} from './annotation-visibility'
import type { FloorplanAnnotationRole, FloorplanToolMode } from './floorplan-extension'

export const FLOORPLAN_MODES = ['default', 'expert'] as const

export type FloorplanMode = (typeof FLOORPLAN_MODES)[number]

export const DEFAULT_FLOORPLAN_MODE: FloorplanMode = 'default'

export type FloorplanPresentationContext = {
  referencedAnnotationRole?: FloorplanAnnotationRole
  selected?: boolean
  target: 'editor' | 'export'
  /** Display → Dimensions. Off hides the automatic and contextual dimensions in either mode. */
  dimensions?: boolean
}

export function normalizeFloorplanMode(value: unknown): FloorplanMode {
  return value === 'expert' ? 'expert' : DEFAULT_FLOORPLAN_MODE
}

export function normalizeFloorplanModesByProject(value: unknown): Record<string, FloorplanMode> {
  if (!value || typeof value !== 'object') return {}
  const modes: Record<string, FloorplanMode> = {}
  for (const [projectId, mode] of Object.entries(value)) {
    if (!projectId || (mode !== 'default' && mode !== 'expert')) continue
    modes[projectId] = mode
  }
  return modes
}

export function isFloorplanToolAvailableInMode(
  availableModes: readonly FloorplanToolMode[] | undefined,
  mode: FloorplanMode,
): boolean {
  return availableModes === undefined || availableModes.includes(mode)
}

export function resolveFloorplanAnnotationVisibility(
  mode: FloorplanMode,
  expertVisibility: FloorplanAnnotationVisibility,
  context: FloorplanPresentationContext,
): FloorplanAnnotationVisibility {
  const visibility = resolveModeAnnotationVisibility(mode, expertVisibility, context)
  if (context.dimensions !== false) return visibility
  if (!visibility.automaticDimensions && !visibility.contextualDimensions) return visibility
  return { ...visibility, automaticDimensions: false, contextualDimensions: false }
}

function resolveModeAnnotationVisibility(
  mode: FloorplanMode,
  expertVisibility: FloorplanAnnotationVisibility,
  context: FloorplanPresentationContext,
): FloorplanAnnotationVisibility {
  if (mode === 'expert') return expertVisibility

  const interactive = context.target === 'editor'
  const selected = interactive && context.selected === true
  const visibility: FloorplanAnnotationVisibility = {
    automaticDimensions: false,
    contextualDimensions: selected,
    manualDimensions: selected,
    measurements: selected,
    openingMarks: false,
    structuralGrids: false,
    roomLabels: true,
    roomDetails: false,
    roofPlan: false,
    stairAnnotations: false,
  }
  return interactive && context.referencedAnnotationRole
    ? revealFloorplanAnnotationRole(visibility, context.referencedAnnotationRole)
    : visibility
}
