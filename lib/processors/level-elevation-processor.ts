import type { AnyNode, NodeTypeMap } from '@/lib/scenegraph/schema/index'
import type { NodeProcessor, NodeProcessResult } from './types'

/**
 * LevelElevationProcessor calculates the elevation (Y offset from ground) for each level
 * based on the cumulative heights of all previous levels.
 *
 * This processor should run AFTER LevelHeightProcessor, which calculates each level's height.
 *
 * Example:
 * - Level 0: height = 3m, elevation = 0m (ground floor)
 * - Level 1: height = 2.5m, elevation = 3m (on top of level 0)
 * - Level 2: height = 3.5m, elevation = 5.5m (on top of level 1)
 */
export class LevelElevationProcessor implements NodeProcessor {
  nodeTypes = ['level']

  process(nodes: AnyNode[]): NodeProcessResult[] {
    const results: NodeProcessResult[] = []

    // Filter and sort levels by their level number
    const levels = nodes
      .filter((node): node is NodeTypeMap['level'] => node.type === 'level')
      .sort((a, b) => a.level - b.level)

    // Calculate cumulative elevation for each level
    let cumulativeElevation = 0

    levels.forEach((level) => {
      // Set this level's elevation
      results.push({
        nodeId: level.id,
        updates: {
          elevation: cumulativeElevation,
        },
      })

      // Add this level's height to the cumulative total for the next level
      // Use the calculated height, or 0 if not yet calculated
      const levelHeight = level.height || 0
      cumulativeElevation += levelHeight
    })

    return results
  }
}
