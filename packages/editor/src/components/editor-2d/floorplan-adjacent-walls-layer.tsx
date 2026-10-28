'use client'

import {
  type AnyNode,
  type AnyNodeId,
  calculateLevelMiters,
  getLevelAbove,
  getLevelBelow,
  getWallPlanFootprint,
  type LevelNode,
  type Point2D,
  servesAsRoofLevel,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { memo, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import useEditor from '../../store/use-editor'
import { useLevelWallCopyOffer } from '../ui/level-wall-copy-prompt'

/** Walls below read blue, walls above magenta: told apart at a glance and from the active walls. */
export const ADJACENT_WALL_COLORS = { below: '#2563eb', above: '#c026d3' } as const

export type AdjacentWallOutline = { id: string; points: string }

/**
 * Each visible wall of `levelId` as the outline of its full thickness (both faces, joined at the
 * corners as the level draws them), in plan metres.
 */
export function adjacentWallOutlines(
  nodes: Record<string, AnyNode>,
  levelId: string | null | undefined,
): AdjacentWallOutline[] {
  if (!levelId) return []
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' && node.parentId === levelId && node.visible !== false,
  )
  if (!walls.length) return []
  const miters = calculateLevelMiters(walls)
  return walls.flatMap((wall) => {
    const polygon: Point2D[] = getWallPlanFootprint(wall, miters)
    return polygon.length >= 3
      ? [{ id: wall.id, points: polygon.map((point) => `${point.x},${point.y}`).join(' ') }]
      : []
  })
}

/**
 * The levels directly below and above `levelId` in its building's stack (by ordinal, as the
 * storey stack orders them): on a roof level, "below" is the top storey, the walls the roof bears
 * on. Reads only the building's levels, so a plan selector can call it on every scene change.
 */
export function adjacentLevelIds(
  nodes: Record<string, AnyNode>,
  levelId: string | null | undefined,
): { below: string | null; above: string | null } {
  const level = levelId ? nodes[levelId] : undefined
  if (level?.type !== 'level') return { below: null, above: null }
  const building = level.parentId ? nodes[level.parentId] : undefined
  if (building?.type !== 'building') {
    const graph = nodes as Record<AnyNodeId, AnyNode>
    return {
      below: getLevelBelow(level.id, graph)?.id ?? null,
      above: getLevelAbove(level.id, graph)?.id ?? null,
    }
  }
  let below: LevelNode | null = null
  let above: LevelNode | null = null
  for (const id of building.children) {
    const other = nodes[id]
    if (other?.type !== 'level' || other.id === level.id) continue
    if (other.level < level.level && (!below || other.level > below.level)) below = other
    if (other.level > level.level && (!above || other.level < above.level)) above = other
  }
  return { below: below?.id ?? null, above: above?.id ?? null }
}

/** The adjacent levels whose walls the plan traces: each only while it is shown. */
export function adjacentWallLevels(
  nodes: Record<string, AnyNode>,
  levelId: string | null | undefined,
  show: { below: boolean; above: boolean },
): { below: string | null; above: string | null } {
  const levels = adjacentLevelIds(nodes, levelId)
  return { below: show.below ? levels.below : null, above: show.above ? levels.above : null }
}

/**
 * The "Walls below" setting that applies on `levelId`: the roof plan's, on until turned off, on a
 * roof level; the floor plans', off until turned on, on a storey.
 */
export function useWallsBelowSetting(levelId: string | null | undefined): {
  onRoofLevel: boolean
  shown: boolean
  setShown: (show: boolean) => void
} {
  const onRoofLevel = useScene((state) => {
    const level = levelId ? state.nodes[levelId as AnyNodeId] : undefined
    return level?.type === 'level' && servesAsRoofLevel(state.nodes, level)
  })
  const shown = useEditor((state) =>
    onRoofLevel ? state.showRoofWallsBelow : state.showWallsBelow,
  )
  const setRoof = useEditor((state) => state.setShowRoofWallsBelow)
  const setFloor = useEditor((state) => state.setShowWallsBelow)
  return { onRoofLevel, shown, setShown: onRoofLevel ? setRoof : setFloor }
}

/** The level's own walls, read through its children rather than the whole scene. */
function useLevelWalls(levelId: string | null) {
  return useScene(
    useShallow((state) => {
      const level = levelId ? state.nodes[levelId as AnyNodeId] : undefined
      if (level?.type !== 'level') return [] as WallNode[]
      return level.children.flatMap((id) => {
        const node = state.nodes[id as AnyNodeId]
        return node?.type === 'wall' ? [node] : []
      })
    }),
  )
}

function Outlines({ color, outlines }: { color: string; outlines: AdjacentWallOutline[] }) {
  return (
    <>
      {outlines.map((outline) => (
        <polygon
          fill={color}
          fillOpacity={0.05}
          key={outline.id}
          points={outline.points}
          stroke={color}
          strokeDasharray="7 5"
          strokeLinejoin="miter"
          strokeOpacity={0.9}
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  )
}

/**
 * "Walls below / above": dashed outlines of the walls on the neighbouring levels, drawn over the
 * active level's plan so second-storey walls line up with the ones under them and a roof outline
 * can be checked against the walls it covers — while its toggle is on, or while a new level's
 * "Copy exterior walls?" offer is open. Display only: never hit-tested, never snapped to.
 */
export const FloorplanAdjacentWallsLayer = memo(function FloorplanAdjacentWallsLayer({
  levelId,
}: {
  levelId: string | null | undefined
}) {
  const offer = useLevelWallCopyOffer((state) =>
    state.offer && state.offer.levelId === levelId ? state.offer.direction : null,
  )
  const showBelow = useWallsBelowSetting(levelId).shown || offer === 'below'
  const showAbove = useEditor((state) => state.showWallsAbove) || offer === 'above'
  const levels = useScene(
    useShallow((state) =>
      adjacentWallLevels(state.nodes as Record<string, AnyNode>, levelId, {
        below: showBelow,
        above: showAbove,
      }),
    ),
  )
  const belowWalls = useLevelWalls(levels.below)
  const aboveWalls = useLevelWalls(levels.above)
  const below = useMemo(
    () => adjacentWallOutlines(Object.fromEntries(belowWalls.map((w) => [w.id, w])), levels.below),
    [belowWalls, levels.below],
  )
  const above = useMemo(
    () => adjacentWallOutlines(Object.fromEntries(aboveWalls.map((w) => [w.id, w])), levels.above),
    [aboveWalls, levels.above],
  )
  if (!(below.length || above.length)) return null
  return (
    <g data-adjacent-walls pointerEvents="none">
      <Outlines color={ADJACENT_WALL_COLORS.below} outlines={below} />
      <Outlines color={ADJACENT_WALL_COLORS.above} outlines={above} />
    </g>
  )
})
