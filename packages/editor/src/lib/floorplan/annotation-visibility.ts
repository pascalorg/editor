import type { FloorplanGeometry } from '@pascal-app/core'

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
  nodeType: string,
  geometry: FloorplanGeometry,
  visibility: FloorplanAnnotationVisibility,
): FloorplanGeometry | null {
  if (nodeType === 'measurement' && !visibility.measurements) return null
  if (nodeType === 'construction-dimension' && !visibility.manualDimensions) return null
  if (nodeType === 'structural-grid' && !visibility.structuralGrids) return null
  if (
    !visibility.roomLabels &&
    'annotationRole' in geometry &&
    geometry.annotationRole === 'room-label'
  ) {
    return null
  }
  if (
    !visibility.structuralGrids &&
    'annotationRole' in geometry &&
    geometry.annotationRole === 'column-center'
  ) {
    return null
  }
  if (
    !visibility.stairAnnotations &&
    'annotationRole' in geometry &&
    geometry.annotationRole === 'stair-annotation'
  ) {
    return null
  }
  if (
    !visibility.automaticDimensions &&
    'annotationRole' in geometry &&
    geometry.annotationRole === 'automatic-dimension'
  ) {
    return null
  }
  if (
    !visibility.automaticDimensions &&
    nodeType !== 'construction-dimension' &&
    (geometry.kind === 'dimension' ||
      geometry.kind === 'dimension-string' ||
      geometry.kind === 'dimension-label' ||
      geometry.kind === 'equal-spacing-badge')
  ) {
    return null
  }
  if (!visibility.openingMarks && isOpeningMark(nodeType, geometry)) return null
  if (geometry.kind !== 'group') return geometry

  const children = geometry.children
    .map((child) => filterFloorplanAnnotationGeometry(nodeType, child, visibility))
    .filter((child): child is FloorplanGeometry => child !== null)
  if (children.length === 0) return null
  if (children.length === geometry.children.length) return geometry
  return { ...geometry, children }
}

function isOpeningMark(nodeType: string, geometry: FloorplanGeometry): boolean {
  if ((nodeType !== 'door' && nodeType !== 'window') || geometry.kind !== 'group') return false
  return geometry.children.some((child) => child.kind === 'text' && child.upright === true)
}
