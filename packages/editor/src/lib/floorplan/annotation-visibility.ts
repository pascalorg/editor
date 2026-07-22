import type { FloorplanGeometry } from '@pascal-app/core'
import { type FloorplanAnnotationRole, readFloorplanGeometryMetadata } from './floorplan-extension'

export type FloorplanAnnotationCategory =
  | 'automaticDimensions'
  | 'manualDimensions'
  | 'measurements'
  | 'openingMarks'
  | 'structuralGrids'
  | 'roomLabels'
  | 'stairAnnotations'

export type FloorplanAnnotationVisibility = Record<FloorplanAnnotationCategory, boolean>

export const DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY: FloorplanAnnotationVisibility = {
  automaticDimensions: true,
  manualDimensions: true,
  measurements: true,
  openingMarks: true,
  structuralGrids: true,
  roomLabels: true,
  stairAnnotations: true,
}

export function normalizeFloorplanAnnotationVisibility(
  value: unknown,
): FloorplanAnnotationVisibility {
  if (!value || typeof value !== 'object') return { ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY }
  const persisted = value as Partial<Record<FloorplanAnnotationCategory, unknown>>
  return {
    automaticDimensions:
      typeof persisted.automaticDimensions === 'boolean'
        ? persisted.automaticDimensions
        : DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY.automaticDimensions,
    manualDimensions:
      typeof persisted.manualDimensions === 'boolean'
        ? persisted.manualDimensions
        : DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY.manualDimensions,
    measurements:
      typeof persisted.measurements === 'boolean'
        ? persisted.measurements
        : DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY.measurements,
    openingMarks:
      typeof persisted.openingMarks === 'boolean'
        ? persisted.openingMarks
        : DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY.openingMarks,
    structuralGrids:
      typeof persisted.structuralGrids === 'boolean'
        ? persisted.structuralGrids
        : DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY.structuralGrids,
    roomLabels:
      typeof persisted.roomLabels === 'boolean'
        ? persisted.roomLabels
        : DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY.roomLabels,
    stairAnnotations:
      typeof persisted.stairAnnotations === 'boolean'
        ? persisted.stairAnnotations
        : DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY.stairAnnotations,
  }
}

export function filterFloorplanAnnotationGeometry(
  geometry: FloorplanGeometry,
  visibility: FloorplanAnnotationVisibility,
  inheritedRole?: FloorplanAnnotationRole,
): FloorplanGeometry | null {
  const role = readFloorplanGeometryMetadata(geometry).annotationRole ?? inheritedRole
  if (role && !isAnnotationRoleVisible(role, visibility)) return null
  if (
    !visibility.automaticDimensions &&
    role !== 'manual-dimension' &&
    (geometry.kind === 'dimension' ||
      geometry.kind === 'dimension-string' ||
      geometry.kind === 'dimension-label' ||
      geometry.kind === 'equal-spacing-badge')
  ) {
    return null
  }
  if (geometry.kind !== 'group') return geometry

  const children = geometry.children
    .map((child) => filterFloorplanAnnotationGeometry(child, visibility, role))
    .filter((child): child is FloorplanGeometry => child !== null)
  if (children.length === 0) return null
  if (children.length === geometry.children.length) return geometry
  return { ...geometry, children }
}

function isAnnotationRoleVisible(
  role: FloorplanAnnotationRole,
  visibility: FloorplanAnnotationVisibility,
): boolean {
  switch (role) {
    case 'automatic-dimension':
      return visibility.automaticDimensions
    case 'manual-dimension':
      return visibility.manualDimensions
    case 'measurement':
      return visibility.measurements
    case 'opening-mark':
      return visibility.openingMarks
    case 'structural-grid':
    case 'column-center':
      return visibility.structuralGrids
    case 'room-label':
      return visibility.roomLabels
    case 'stair-annotation':
      return visibility.stairAnnotations
  }
}
