import type { AnyNodeId } from '@pascal-app/core'
import type { ServicePointNode, UtilityLineNode, UtilityPoleNode } from './schema'

/**
 * Plugin kinds are not members of core's `AnyNode` / `AnyNodeId` unions —
 * core cannot enumerate kinds it does not ship. Every host contract reads
 * them structurally at runtime, so the narrowing happens once here instead
 * of scattering casts through the package (same approach as
 * `packages/plugin-sections/src/kind-guards.ts`).
 */

const typeOf = (node: unknown): string | undefined =>
  (node as { type?: unknown } | null | undefined)?.type as string | undefined

export function isUtilityLine(node: unknown): node is UtilityLineNode {
  return typeOf(node) === 'utility-line'
}

export function isUtilityPole(node: unknown): node is UtilityPoleNode {
  return typeOf(node) === 'utility-pole'
}

export function isServicePoint(node: unknown): node is ServicePointNode {
  return typeOf(node) === 'service-point'
}

/** Widen a plugin-minted id to the host's `AnyNodeId` for host API calls. */
export const asNodeId = (id: string): AnyNodeId => id as AnyNodeId
