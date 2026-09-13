import type { AnyNodeId } from '@pascal-app/core'
import type { ElevationMarkerNode, SectionMarkerNode } from './schema'

/**
 * Plugin kinds are not members of core's `AnyNode` / `AnyNodeId` unions —
 * core cannot enumerate kinds it does not ship (see the `LevelChildId`
 * comment in `packages/core/src/schema/nodes/level.ts`). Every host contract
 * reads them structurally at runtime, so these guards do the narrowing once
 * instead of scattering casts through the package.
 */

const typeOf = (node: unknown): string | undefined =>
  (node as { type?: unknown } | null | undefined)?.type as string | undefined

export function isSectionMarker(node: unknown): node is SectionMarkerNode {
  return typeOf(node) === 'section-marker'
}

export function isElevationMarker(node: unknown): node is ElevationMarkerNode {
  return typeOf(node) === 'elevation-marker'
}

/** Widen a plugin-minted id to the host's `AnyNodeId` for host API calls. */
export const asNodeId = (id: string): AnyNodeId => id as AnyNodeId
