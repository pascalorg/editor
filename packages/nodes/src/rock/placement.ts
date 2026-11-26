import { type AnyNode, type AnyNodeId, RockNode, type SceneApi } from '@pascal-app/core'
import { addRock } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { planToSite } from '../shared/site-frame'
import {
  commitSiteOperationPlacement,
  ownsSitePlacement,
  snapSitePoint,
} from '../shared/site-placement'

type Point = [number, number]

/** Keep the source click-placement footprint, including its deterministic irregular radii. */
const PLACED_RADII = [1.5, 1.2, 1.55, 1.3, 1.5, 1.15, 1.45, 1.25]

function placedOutline([cx, cz]: Point): Point[] {
  return PLACED_RADII.map((radius, i): Point => {
    const angle = (i / PLACED_RADII.length) * Math.PI * 2
    return [cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius]
  })
}

export const snapRockPlacementPoint = snapSitePoint
export const ownsRockPlacement = ownsSitePlacement

export function planPointToSite(
  point: Point,
  frame: {
    nodes: Readonly<Record<string, AnyNode>>
    activeLevelId: AnyNodeId | null
    drawingType: 'floor-plan' | 'site-plan'
  },
): Point {
  if (frame.drawingType === 'site-plan') return point
  const level = frame.activeLevelId ? frame.nodes[frame.activeLevelId] : undefined
  const building = level?.parentId ? frame.nodes[level.parentId] : undefined
  return planToSite(building?.type === 'building' ? building : null, point)
}

/** A seed for the next hand-placed rock. */
export function drawRockSeed(): number {
  return Math.floor(Math.random() * 9999)
}

/**
 * The rock a click would set with this seed, around the Site's origin: what the tool shows as a
 * ghost. Null where the operation would refuse to set one at all (no Site).
 */
export function previewRock(
  nodes: ReturnType<SceneApi['nodes']>,
  siteId: string | undefined,
  seed: number,
): RockNode | null {
  try {
    const node = addRock(
      nodes,
      { outline: placedOutline([0, 0]), siteId, seed },
      { activeLevelId: null },
    ).changes?.create?.[0]?.node
    return node ? RockNode.parse(node) : null
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    return null
  }
}

/** Both UI views use the agent operation, with one atomic history entry and explicit Site. */
export function placeRock(
  sceneApi: SceneApi,
  at: Point,
  select: (id: AnyNodeId) => void,
  siteId?: string,
  onRefusal?: (message: string) => void,
  /** The seed of the rock shown as a ghost, so the rock set down is that one. */
  seed: number = drawRockSeed(),
): AnyNodeId | null {
  return commitSiteOperationPlacement({
    sceneApi,
    label: 'Rock placement',
    run: () =>
      addRock(
        sceneApi.nodes(),
        { outline: placedOutline(at), siteId, seed },
        { activeLevelId: null },
      ),
    parseNode: (node) => RockNode.parse(node),
    selectId: (result) => result.rockId as AnyNodeId,
    select,
    onRefusal: (error) => onRefusal?.(error.message),
  })
}
