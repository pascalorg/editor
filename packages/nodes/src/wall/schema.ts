/**
 * Wall schema re-export.
 *
 * Wall's Zod schema lives in `@pascal-app/core` because doors, windows, and
 * items still need to type-check their `parentId` against `WallNode.shape.id`
 * before the migration to a `relations.hosts`-driven model is complete. The
 * registry definition consumes it from here so the rest of the bundle
 * imports a single canonical type.
 */

export type {
  WallAssemblyDatumReference,
  WallAssemblyDatumSide,
  WallAssemblyLayer,
  WallNode as WallNodeType,
} from '@pascal-app/core'
export {
  getWallAssemblyDatumReferenceId,
  getWallAssemblyLayers,
  getWallAssemblyThickness,
  getWallDatumEligibleLayers,
  resolveWallAssemblyDatumReference,
  resolveWallAssemblyDatumReferences,
  WallAssemblyLayerRole,
  WallDimensionDatum,
  WallNode,
} from '@pascal-app/core'
