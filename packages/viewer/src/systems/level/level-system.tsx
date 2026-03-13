import { type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { lerp } from 'three/src/math/MathUtils.js'
import useViewer from '../../store/use-viewer'
import { getLevelHeight } from './level-utils'

const EXPLODED_GAP = 5

export const LevelSystem = () => {
  useFrame((_, delta) => {
    const nodes = useScene.getState().nodes
    const levelMode = useViewer.getState().levelMode
    const selectedLevel = useViewer.getState().selection.levelId

    // Collect and sort levels by floor index so we can compute cumulative offsets.
    // Level 0 → Y=0, Level 1 → Y=height(0), Level 2 → Y=height(0)+height(1), etc.
    type LevelEntry = {
      levelId: string
      index: number
      obj: NonNullable<ReturnType<typeof sceneRegistry.nodes.get>>
    }
    const entries: LevelEntry[] = []
    sceneRegistry.byType.level.forEach((levelId) => {
      const obj = sceneRegistry.nodes.get(levelId)
      const level = nodes[levelId as LevelNode['id']]
      if (obj && level) {
        entries.push({ levelId, index: (level as any).level ?? 0, obj })
      }
    })
    entries.sort((a, b) => a.index - b.index)

    // Walk sorted levels, accumulating base Y offsets
    let cumulativeY = 0
    for (const { levelId, index, obj } of entries) {
      const level = nodes[levelId as LevelNode['id']]
      const baseY = cumulativeY
      const explodedExtra = levelMode === 'exploded' ? index * EXPLODED_GAP : 0
      const targetY = baseY + explodedExtra

      obj.position.y = lerp(obj.position.y, targetY, delta * 12) // Smoothly animate to new Y position
      obj.visible = levelMode !== 'solo' || level?.id === selectedLevel || !selectedLevel

      cumulativeY += getLevelHeight(levelId, nodes)
    }
  }, 5) // Using a lower priority so it runs after transforms from other systems have settled
  return null
}
