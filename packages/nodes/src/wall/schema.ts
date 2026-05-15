/**
 * Wall schema re-export.
 *
 * Wall's Zod schema lives in `@pascal-app/core` because doors, windows, and
 * items still need to type-check their `parentId` against `WallNode.shape.id`
 * before the migration to a `relations.hosts`-driven model is complete. The
 * registry definition consumes it from here so the rest of the bundle
 * imports a single canonical type.
 */

export type { WallNode as WallNodeType } from '@pascal-app/core'
export { WallNode } from '@pascal-app/core'
