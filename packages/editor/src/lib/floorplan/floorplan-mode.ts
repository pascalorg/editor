import {
  type FloorplanAnnotationVisibility,
  revealFloorplanAnnotationRole,
} from './annotation-visibility'
import type {
  FloorplanAnnotationRole,
  FloorplanToolMode,
  FloorplanWallDimensionReference,
} from './floorplan-extension'

export const FLOORPLAN_MODES = ['default', 'expert'] as const

export type FloorplanMode = (typeof FLOORPLAN_MODES)[number]

export const DEFAULT_FLOORPLAN_MODE: FloorplanMode = 'default'

export type FloorplanPresentationContext = {
  referencedAnnotationRole?: FloorplanAnnotationRole
  selected?: boolean
  target: 'editor' | 'export'
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
    stairAnnotations: false,
  }
  return interactive && context.referencedAnnotationRole
    ? revealFloorplanAnnotationRole(visibility, context.referencedAnnotationRole)
    : visibility
}

export function resolveFloorplanWallDimensionReference(
  mode: FloorplanMode,
  expertReference: FloorplanWallDimensionReference,
): FloorplanWallDimensionReference {
  return mode === 'default' ? 'centerline' : expertReference
}
