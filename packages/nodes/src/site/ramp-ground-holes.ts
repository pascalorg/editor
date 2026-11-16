import {
  type AnyNode,
  type RampNode,
  type Ring,
  rampHeightAt,
  rampOffsetPoint,
  rampProjectPoint,
  rampStations,
  rampStepForSag,
} from '@pascal-app/core'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'

/** How far the clipped edge may lie off the corridor's true edge, metres. */
const EDGE_SAG_M = 0.005

/** The roadway's structure where it meets the ground along a cut's rim, at one rim point. */
export type RampRimStructure = {
  /** The highest the roadway's own side stands: the wall's top, or the deck without a wall. */
  top: number
  /** The underside of the deck. */
  bottom: number
}

/**
 * A graded ramp's footprint on the ground: the ring its roadway replaces, and what stands at
 * that ring, so the ground's cut edge can be closed against the roadway.
 */
export type RampGroundCut = {
  ramp: RampNode
  ring: Ring
  structureAt: (x: number, z: number) => RampRimStructure | null
}

function structureOf(ramp: RampNode) {
  return (x: number, z: number): RampRimStructure | null => {
    try {
      const { distance } = rampProjectPoint(ramp, [x, z])
      const deck = rampHeightAt(ramp, distance)
      return {
        top: deck + (ramp.retainingHeight > 0 ? ramp.retainingHeight : 0),
        bottom: deck - ramp.thickness,
      }
    } catch (error) {
      if (isAgentRefusal(error)) return null
      throw error
    }
  }
}

export function getRampGroundCuts(nodes: Record<string, AnyNode>, siteId: string): RampGroundCut[] {
  return Object.values(nodes).flatMap((node) => {
    if (
      node.type !== 'ramp' ||
      node.parentId !== siteId ||
      node.visible === false ||
      node.terrainMode !== 'cut-fill'
    )
      return []

    try {
      // Finer than the default on a tight arc, so a chord of the clipped edge stays within
      // `EDGE_SAG_M` of the true curve however tightly the road turns.
      const stations = rampStations(node, rampStepForSag(node, EDGE_SAG_M))
      return [
        {
          ramp: node,
          ring: [
            ...stations.map((station) => rampOffsetPoint(station, node.width / 2)),
            ...[...stations].reverse().map((station) => rampOffsetPoint(station, -node.width / 2)),
          ],
          structureAt: structureOf(node),
        },
      ]
    } catch (error) {
      // A refused legacy ramp must not take down the Site; coherence reports its geometry.
      if (isAgentRefusal(error)) return []
      throw error
    }
  })
}

export function getRampGroundHoles(nodes: Record<string, AnyNode>, siteId: string): Ring[] {
  return getRampGroundCuts(nodes, siteId).map((cut) => cut.ring)
}
