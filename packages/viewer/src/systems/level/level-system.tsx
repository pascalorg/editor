import { type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { lerp } from 'three/src/math/MathUtils.js'
import useViewer from '../../store/use-viewer'

const LEVEL_HEIGHT = 2.5
const EXPLODED_GAP = 5

export const LevelSystem = () => {
  useFrame((_, delta) => {
    const levelMode = useViewer.getState().levelMode
    const selectedLevel = useViewer.getState().selection.levelId
    sceneRegistry.byType.level.forEach((levelId) => {
      const obj = sceneRegistry.nodes.get(levelId)
      if (obj) {
        const level = useScene.getState().nodes[levelId as LevelNode['id']]
        const targetY =
          ((level as any).level || 0) *
          (LEVEL_HEIGHT + (levelMode === 'exploded' ?  EXPLODED_GAP: 0))
        obj.position.y = lerp(obj.position.y, targetY, delta * 3)

        obj.visible = levelMode !== 'solo' || level?.id === selectedLevel || !selectedLevel
      }
    })
  })
  return null
}
