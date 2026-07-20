import {
  type AnyNode,
  type AnyNodeId,
  FenceNode,
  type LevelNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { triggerSFX } from '../../../lib/sfx-bus'
import {
  DEFAULT_STAIR_ATTACHMENT_SIDE,
  DEFAULT_STAIR_FILL_TO_FLOOR,
  DEFAULT_STAIR_RAILING_HEIGHT,
  DEFAULT_STAIR_RAILING_MODE,
  DEFAULT_STAIR_THICKNESS,
} from '../stair/stair-defaults'
import {
  buildRailingRuns,
  classifyDeckEdges,
  type DeckWallSegment,
  type PlanPoint,
  planDeckStair,
} from './deck-plan'

/** Thin platform slab — the deck reads as a walking surface, not a storey floor. */
export const DECK_THICKNESS = 0.05

/** Balcony decks sit flush with the interior floor surface (slab default). */
export const BALCONY_DECK_ELEVATION = 0.05

/** Guardrail height for deck railings — the codebase's standard railing height. */
export const DECK_RAILING_HEIGHT = DEFAULT_STAIR_RAILING_HEIGHT

function collectLevelWallSegments(
  nodes: Record<string, AnyNode>,
  levelId: LevelNode['id'],
): DeckWallSegment[] {
  const walls: DeckWallSegment[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall' || node.parentId !== levelId) continue
    const wall = node as WallNode
    walls.push({ start: wall.start, end: wall.end, thickness: wall.thickness })
  }
  return walls
}

function nextDeckName(nodes: Record<string, AnyNode>, prefix: 'Mezzanine' | 'Balcony'): string {
  const count = Object.values(nodes).filter(
    (node) => node.type === 'slab' && node.name?.startsWith(prefix),
  ).length
  return `${prefix} ${count + 1}`
}

/**
 * One-gesture deck commit shared by the mezzanine and balcony tools. Creates
 * the deck slab, fence railings on every open (not wall-backed) edge hosted
 * on the deck via `supportSlabId`, and — for the mezzanine — a straight
 * access stair boarding the longest open edge, with the railing split around
 * the stair mouth. Everything lands in a single `createNodes` call, so the
 * whole gesture is one undo step; the deck is selected afterwards (slab-tool
 * parity). A fully wall-enclosed deck clamps to just the slab: no railing,
 * no stair, no prompt.
 */
export function commitDeck(options: {
  levelId: LevelNode['id']
  points: PlanPoint[]
  elevation: number
  withStair: boolean
  namePrefix: 'Mezzanine' | 'Balcony'
}): void {
  const { levelId, points, elevation, withStair, namePrefix } = options
  const { createNodes, nodes } = useScene.getState()

  const deck = SlabNode.parse({
    name: nextDeckName(nodes, namePrefix),
    polygon: points,
    elevation,
    thickness: DECK_THICKNESS,
  })

  const { open } = classifyDeckEdges(points, collectLevelWallSegments(nodes, levelId))
  const stairPlan = withStair ? planDeckStair(points, open, elevation) : null
  const railingRuns = buildRailingRuns(open, stairPlan)

  const ops: Array<{ node: AnyNode; parentId?: AnyNodeId }> = [{ node: deck, parentId: levelId }]

  for (const run of railingRuns) {
    const railing = FenceNode.parse({
      name: 'Railing',
      start: run.start,
      end: run.end,
      height: DECK_RAILING_HEIGHT,
      style: 'rail',
      supportSlabId: deck.id,
    })
    ops.push({ node: railing, parentId: levelId })
  }

  if (stairPlan) {
    const segment = StairSegmentNode.parse({
      segmentType: 'stair',
      width: stairPlan.width,
      length: stairPlan.runLength,
      height: elevation,
      stepCount: stairPlan.stepCount,
      attachmentSide: DEFAULT_STAIR_ATTACHMENT_SIDE,
      fillToFloor: DEFAULT_STAIR_FILL_TO_FLOOR,
      thickness: DEFAULT_STAIR_THICKNESS,
      position: [0, 0, 0],
    })
    const stair = StairNode.parse({
      name: `${namePrefix} stair`,
      position: [stairPlan.foot[0], 0, stairPlan.foot[1]],
      rotation: stairPlan.rotation,
      stairType: 'straight',
      fromLevelId: levelId,
      // Same-level deck boarding: no destination level, no slab opening —
      // you board the deck over its open edge, so nothing gets cut.
      slabOpeningMode: 'none',
      totalRise: elevation,
      width: stairPlan.width,
      stepCount: stairPlan.stepCount,
      thickness: DEFAULT_STAIR_THICKNESS,
      fillToFloor: DEFAULT_STAIR_FILL_TO_FLOOR,
      railingHeight: DEFAULT_STAIR_RAILING_HEIGHT,
      railingMode: DEFAULT_STAIR_RAILING_MODE,
      children: [segment.id],
    })
    ops.push({ node: stair, parentId: levelId }, { node: segment, parentId: stair.id })
  }

  createNodes(ops)
  useViewer.getState().setSelection({ selectedIds: [deck.id] })
  triggerSFX('sfx:structure-build')
}
