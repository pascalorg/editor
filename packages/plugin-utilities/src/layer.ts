import type { FloorplanGeometry } from '@pascal-app/core'

/**
 * Layer tag every utilities primitive carries, so a future layer toggle can
 * hide the whole workstream's output in one filter.
 *
 * WHY NOT `withFloorplanGeometryMetadata({ annotationRole: 'siteUtilities' })`
 * — which is what workstream 4 was specified to use. That helper writes into
 * the host's `FloorplanAnnotationRole` union
 * (packages/editor/src/lib/floorplan/floorplan-extension.ts:22), and the
 * filter that reads it,
 * `filterFloorplanAnnotationGeometry`
 * (packages/editor/src/lib/floorplan/annotation-visibility.ts:76), does:
 *
 *     if (role && !isAnnotationRoleVisible(role, visibility)) return null
 *
 * `annotationCategoryForRole` is an exhaustive switch over the nine roles
 * that ship today. A role outside it falls off the end returning
 * `undefined`, `visibility[undefined]` is `undefined`, and the geometry is
 * DROPPED — so tagging with `'siteUtilities'` today would make every
 * utility invisible in the plan, not toggleable.
 *
 * Adding `'siteUtilities'` to that union plus a matching
 * `FloorplanAnnotationCategory` and a default in
 * `DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY` is a two-file change inside
 * `packages/editor`, which this workstream does not own. Until that lands,
 * the tag is written under this package's own metadata key — same shape,
 * same place in `geometry.metadata`, ignored by the host filter — and the
 * switch to `annotationRole` is a one-line change here.
 */
export const UTILITIES_LAYER_KEY = 'pascal:utilities/layer'
export const UTILITIES_LAYER_VALUE = 'siteUtilities'

/** Stamp the utilities layer tag onto a primitive. */
export function utilitiesLayerMetadata<T extends FloorplanGeometry | null>(geometry: T): T {
  if (!geometry) return geometry
  const existing = (geometry as { metadata?: Readonly<Record<string, unknown>> }).metadata ?? {}
  return {
    ...geometry,
    metadata: { ...existing, [UTILITIES_LAYER_KEY]: UTILITIES_LAYER_VALUE },
  } as T
}

/** True when a primitive was produced by this workstream. */
export function isUtilitiesGeometry(geometry: unknown): boolean {
  const metadata = (geometry as { metadata?: Record<string, unknown> } | null)?.metadata
  return metadata?.[UTILITIES_LAYER_KEY] === UTILITIES_LAYER_VALUE
}
