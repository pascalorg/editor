import { getLevelElevations, type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'

export const EXPLODED_GAP = 5

/**
 * The Y a level settles at under the given presentation mode — its stacked
 * elevation plus the exploded gap. Analytic (scene store + mode), never a
 * mesh read: a level created this frame has its Object3D at y=0 until
 * LevelSystem lerps it, and a mode switch leaves meshes mid-lerp — camera
 * code framing a level must aim at the destination, not the moving target.
 */
export function getLevelPresentationY(
  levelId: string,
  nodes: Record<string, unknown>,
  levelMode: 'stacked' | 'exploded' | 'solo' | 'manual',
): number {
  const level = nodes[levelId] as LevelNode | undefined
  const baseY = getLevelElevations(nodes as never).get(levelId)?.baseY ?? 0
  const explodedExtra = levelMode === 'exploded' && level ? level.level * EXPLODED_GAP : 0
  return baseY + explodedExtra
}

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
  }

  const entries: LevelEntry[] = []
  sceneRegistry.byType.level!.forEach((levelId) => {
    const obj = sceneRegistry.nodes.get(levelId)
    const level = nodes[levelId as LevelNode['id']] as LevelNode | undefined
    if (obj && level) {
      entries.push({
        levelId,
        obj,
      })
    }
  })
  const levelElevations = getLevelElevations(nodes)

  // Snapshot current Y and visibility so we can restore them after the render
  const snapshot = new Map(
    entries.map(({ levelId, obj }) => [levelId, { y: obj.position.y, visible: obj.visible }]),
  )

  // Snap to true stacked positions and make all levels visible
  for (const { levelId, obj } of entries) {
    obj.position.y = levelElevations.get(levelId)?.baseY ?? 0
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
