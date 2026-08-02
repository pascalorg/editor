import { getLevelElevations, type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import type { Object3D } from 'three'
import { lerp } from 'three/src/math/MathUtils.js'
import { applyShadowOnly, clearShadowOnly } from '../../lib/shadow-only'
import useViewer from '../../store/use-viewer'

const EXPLODED_GAP = 5

// Levels currently in shadow-caster-only mode (solo hides them from the color
// passes but keeps their sun shadows). Tracked so we can restore layer masks
// exactly once on transition; apply re-runs every frame so meshes rebuilt
// while hidden (theme/texture changes) get re-hidden.
const shadowOnlyLevels = new WeakSet<Object3D>()

export const LevelSystem = () => {
  useFrame((_, delta) => {
    const nodes = useScene.getState().nodes
    const levelMode = useViewer.getState().levelMode
    const selectedLevel = useViewer.getState().selection.levelId

    const levelElevations = getLevelElevations(nodes)
    type LevelEntry = {
      levelId: string
      index: number
      obj: NonNullable<ReturnType<typeof sceneRegistry.nodes.get>>
    }
    const entries: LevelEntry[] = []
    sceneRegistry.byType.level!.forEach((levelId) => {
      const obj = sceneRegistry.nodes.get(levelId)
      const level = nodes[levelId as LevelNode['id']] as LevelNode | undefined
      if (obj && level) {
        entries.push({
          levelId,
          index: level.level,
          obj,
        })
      }
    })

    const selectedIndex = selectedLevel
      ? entries.find((e) => e.levelId === selectedLevel)?.index
      : undefined
    for (const { levelId, index, obj } of entries) {
      const level = nodes[levelId as LevelNode['id']] as LevelNode | undefined
      const baseY = levelElevations.get(levelId)?.baseY ?? 0
      const explodedExtra = levelMode === 'exploded' ? index * EXPLODED_GAP : 0
      const targetY = baseY + explodedExtra

      obj.position.y = lerp(obj.position.y, targetY, delta * 12) // Smoothly animate to new Y position

      // Solo: hidden levels ABOVE the soloed one stay in the shadow map
      // (shadow-caster-only) so the sun still shadows the soloed floor through
      // them; levels below can't block the sun, so they plain-hide.
      const hidden = levelMode === 'solo' && Boolean(selectedLevel) && level?.id !== selectedLevel
      const castsWhileHidden = hidden && selectedIndex !== undefined && index > selectedIndex
      if (castsWhileHidden) {
        applyShadowOnly(obj)
        shadowOnlyLevels.add(obj)
        obj.visible = true
      } else {
        if (shadowOnlyLevels.has(obj)) {
          clearShadowOnly(obj)
          shadowOnlyLevels.delete(obj)
        }
        obj.visible = !hidden
      }
    }
  }, 5) // Using a lower priority so it runs after transforms from other systems have settled
  return null
}
