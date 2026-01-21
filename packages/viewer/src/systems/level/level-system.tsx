import { type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { lerp } from 'three/src/math/MathUtils.js'
import useViewer from '../../store/use-viewer'

const LEVEL_HEIGHT = 2.5
const EXPLODED_GAP = 5

export const LevelSystem = () => {
  useFrame((_, delta) => {
    const levelMode = useViewer.getState().levelMode
    sceneRegistry.byType.level.forEach((levelId) => {
      const obj = sceneRegistry.nodes.get(levelId)
      if (obj) {
        const level = useScene.getState().nodes[levelId as LevelNode['id']]
        const targetY =
          ((level as any).level || 0) *
          (LEVEL_HEIGHT + (levelMode === 'stacked' ? 0 : EXPLODED_GAP))
        obj.position.y = lerp(obj.position.y, targetY, delta * 3)
      }
    })
  })
  return null
}
