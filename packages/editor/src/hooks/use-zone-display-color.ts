import { type AnyNodeId, useScene, zoneDisplayColor } from '@pascal-app/core'

/** The colour a zone shows (its chosen one, else the derived one), or undefined. */
export function useZoneDisplayColor(zoneId: string): string | undefined {
  return useScene((state) => {
    const zone = state.nodes[zoneId as AnyNodeId]
    return zone?.type === 'zone'
      ? zoneDisplayColor(zone, (id) => state.nodes[id as AnyNodeId])
      : undefined
  })
}
