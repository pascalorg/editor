import { type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { lerp } from 'three/src/math/MathUtils.js'
import useViewer from '../../store/use-viewer'
import { applySoloLevelVisibility, clearSoloLevelVisibility } from './level-solo-visibility'
import { getLevelLayoutEntries } from './level-utils'

export const LevelSystem = () => {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => clearSoloLevelVisibility, [])

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
    sceneRegistry.byType.level!.forEach((levelId) => {
      const obj = sceneRegistry.nodes.get(levelId)
      const level = nodes[levelId as LevelNode['id']]
      if (obj && level) {
        entries.push({ levelId, index: (level as any).level ?? 0, obj })
      }
    })
    entries.sort((a, b) => a.index - b.index)

    const layoutEntries = getLevelLayoutEntries({
      entries,
      nodes,
      levelMode,
      selectedLevelId: selectedLevel,
    })
    const layoutById = new Map(layoutEntries.map((entry) => [entry.levelId, entry]))

    if (levelMode === 'solo') {
      applySoloLevelVisibility(selectedLevel)
    } else {
      clearSoloLevelVisibility()
    }

    let shouldContinueAnimation = false

    for (const { levelId, obj } of entries) {
      const layout = layoutById.get(levelId)
      if (!layout) continue

      const nextY =
        levelMode === 'solo' ? layout.targetY : lerp(obj.position.y, layout.targetY, delta * 12)
      obj.position.y = Math.abs(nextY - layout.targetY) < 0.001 ? layout.targetY : nextY
      shouldContinueAnimation ||= Math.abs(obj.position.y - layout.targetY) > 0.001
      obj.visible = true
    }

    if (shouldContinueAnimation) invalidate()
  }, 5) // Using a lower priority so it runs after transforms from other systems have settled
  return null
}
