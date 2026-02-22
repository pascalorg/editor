import { type CeilingNode, type LevelNode, sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { lerp } from 'three/src/math/MathUtils.js'
import useViewer from '../../store/use-viewer'

const DEFAULT_LEVEL_HEIGHT = 2.5
const EXPLODED_GAP = 5

// Cache: levelId → computed height. Invalidated by nodes reference change.
// Zustand produces a new `nodes` object on every mutation, so reference equality
// is a zero-cost way to detect stale data without any subscription overhead.
const heightCache = new Map<string, number>()
let lastNodesRef: object | null = null

function getLevelHeight(
  levelId: string,
  nodes: ReturnType<typeof useScene.getState>['nodes'],
): number {
  if (heightCache.has(levelId)) return heightCache.get(levelId)!

  const level = nodes[levelId as LevelNode['id']] as LevelNode | undefined
  if (!level) return DEFAULT_LEVEL_HEIGHT

  let maxTop = 0

  for (const childId of level.children) {
    const child = nodes[childId as keyof typeof nodes]
    if (!child) continue
    if (child.type === 'ceiling') {
      // ceiling.height is the interior face Y in level-local space
      const ch = (child as CeilingNode).height ?? DEFAULT_LEVEL_HEIGHT
      if (ch > maxTop) maxTop = ch
    } else if (child.type === 'wall') {
      // Wall mesh is pushed up to slabElevation by WallSystem.
      // mesh.position.y + wall.height gives the actual top Y in level-local space.
      const meshY = sceneRegistry.nodes.get(childId as any)?.position.y ?? 0
      const top = meshY + ((child as WallNode).height ?? DEFAULT_LEVEL_HEIGHT)
      if (top > maxTop) maxTop = top
    }
  }

  const height = maxTop > 0 ? maxTop : DEFAULT_LEVEL_HEIGHT
  heightCache.set(levelId, height)
  return height
}

export const LevelSystem = () => {
  useFrame((_, delta) => {
    const nodes = useScene.getState().nodes

    // Clear cache when nodes reference changes (any node was mutated)
    if (nodes !== lastNodesRef) {
      heightCache.clear()
      lastNodesRef = nodes
    }

    const levelMode = useViewer.getState().levelMode
    const selectedLevel = useViewer.getState().selection.levelId

    // Collect and sort levels by floor index so we can compute cumulative offsets.
    // Level 0 → Y=0, Level 1 → Y=height(0), Level 2 → Y=height(0)+height(1), etc.
    type LevelEntry = { levelId: string; index: number; obj: NonNullable<ReturnType<typeof sceneRegistry.nodes.get>> }
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

      obj.position.y = lerp(obj.position.y, targetY, delta * 3)
      obj.visible = levelMode !== 'solo' || level?.id === selectedLevel || !selectedLevel

      cumulativeY += getLevelHeight(levelId, nodes)
    }
  })
  return null
}
