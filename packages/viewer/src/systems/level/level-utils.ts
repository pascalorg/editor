import { getLevelHeight, type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'
import { getLevelStackPositions } from './level-stacking'

/**
 * Instantly snaps all level Objects3D to their true stacked Y positions
 * (ignores levelMode — always uses stacked, no exploded gap).
 *
 * Returns a restore function that reverts each level's Y to what it was
 * before the snap, so lerp animations in LevelSystem can continue undisturbed.
 *
 * Usage:
 *   const restore = snapLevelsToTruePositions()
 *   renderer.render(scene, camera)
 *   restore()
 */
export function snapLevelsToTruePositions(): () => void {
  const nodes = useScene.getState().nodes

  type LevelEntry = {
    obj: NonNullable<ReturnType<typeof sceneRegistry.nodes.get>>
    levelId: string
    buildingId: string | null
    index: number
    height: number
  }

  const entries: LevelEntry[] = []
  sceneRegistry.byType.level!.forEach((levelId) => {
    const obj = sceneRegistry.nodes.get(levelId)
    const level = nodes[levelId as LevelNode['id']] as LevelNode | undefined
    if (obj && level) {
      entries.push({
        levelId,
        buildingId: level.parentId ?? null,
        index: level.level,
        height: getLevelHeight(
          levelId,
          nodes,
          (wallId) => sceneRegistry.nodes.get(wallId)?.position.y,
        ),
        obj,
      })
    }
  })
  const stackPositions = getLevelStackPositions(entries)

  // Snapshot current Y and visibility so we can restore them after the render
  const snapshot = new Map(
    entries.map(({ levelId, obj }) => [levelId, { y: obj.position.y, visible: obj.visible }]),
  )

  // Snap to true stacked positions and make all levels visible
  for (const { levelId, obj } of entries) {
    obj.position.y = stackPositions.get(levelId) ?? 0
    obj.visible = true
  }

  return () => {
    for (const { levelId, obj } of entries) {
      const saved = snapshot.get(levelId)
      if (saved !== undefined) {
        obj.position.y = saved.y
        obj.visible = saved.visible
      }
    }
  }
}
