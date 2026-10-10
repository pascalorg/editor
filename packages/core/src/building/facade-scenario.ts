import { type AnyNode, LevelNode, WallNode } from '../schema'
import { facadeRuns } from './facade-runs'

/** The studio's test wall: thick enough for window reveals to read. */
export const STUDIO_WALL_THICKNESS = 0.25
export const PARTITION_THICKNESS = 0.1
/** How far an interior wall runs into the room behind the facade. */
const PARTITION_DEPTH = 3
/** Closer than this to a corner, an interior wall would leave no run beside it. */
export const PARTITION_MARGIN = 0.3
export { SCENARIO_WIDTHS } from './facade-widths'

/**
 * A test floor for the studio: one facade wall and the interior walls that meet
 * it, at positions measured from its left corner. The studio plans a unit on it
 * with the same run splitting a project uses, so a partition ends a run exactly
 * as a real one would.
 */
export type FacadeScenario = {
  width: number
  height: number
  partitions: readonly number[]
}

export function scenarioScene({ width, height, partitions }: FacadeScenario) {
  const level = LevelNode.parse({ level: 0, height })
  // The exterior is the wall's front (+Z); rooms lie behind it, towards -Z.
  const wall = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [width, 0],
    thickness: STUDIO_WALL_THICKNESS,
    height,
    frontSide: 'exterior',
    backSide: 'interior',
  })
  const interior = partitions
    .filter((x) => x >= PARTITION_MARGIN && x <= width - PARTITION_MARGIN)
    .map((x) =>
      WallNode.parse({
        parentId: level.id,
        start: [x, 0],
        end: [x, -PARTITION_DEPTH],
        thickness: PARTITION_THICKNESS,
        height,
        frontSide: 'interior',
        backSide: 'interior',
      }),
    )
  const nodes: Record<string, AnyNode> = { [level.id]: level, [wall.id]: wall }
  for (const partition of interior) nodes[partition.id] = partition
  return { level, wall, partitions: interior, nodes }
}

/** The runs the scenario's facade splits into, left to right, in wall metres. */
export function scenarioRuns(scenario: FacadeScenario): { start: number; end: number }[] {
  const { wall, nodes } = scenarioScene(scenario)
  return facadeRuns(nodes, [{ wall, face: 'front' }])
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start - b.start)
}

/** Where a new interior wall goes: the middle of the widest run, so it always splits one. */
export function nextPartition(scenario: FacadeScenario): number | null {
  const widest = scenarioRuns(scenario).reduce<{ start: number; end: number } | null>(
    (best, run) => (!best || run.end - run.start > best.end - best.start ? run : best),
    null,
  )
  if (!widest || widest.end - widest.start < 2 * PARTITION_MARGIN + PARTITION_THICKNESS) return null
  return Math.round(((widest.start + widest.end) / 2) * 20) / 20
}
