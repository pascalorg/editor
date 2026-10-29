import type { AnyNodeId, LevelNode } from '@pascal-app/core'
import { findLevelAncestorId, sceneRegistry, useScene } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { SCENE_LAYER } from '../../lib/layers'
import { type LightSource, useItemLightPool } from '../../store/use-item-light-pool'
import useViewer from '../../store/use-viewer'
import { PooledLights } from './pooled-lights'

// Module-level temp vectors reused every frame (avoids GC pressure)
const _dir = new Vector3()
const _itemPos = new Vector3()

type SceneNodes = ReturnType<typeof useScene.getState>['nodes']

function isRendered(nodeId: AnyNodeId): boolean {
  let object: ReturnType<typeof sceneRegistry.nodes.get> | null = sceneRegistry.nodes.get(nodeId)
  if (!object?.layers.isEnabled(SCENE_LAYER)) return false
  while (object) {
    if (!object.visible) return false
    object = object.parent
  }
  return true
}

function scoreRegistration(
  reg: LightSource,
  camPos: Vector3,
  camFwd: Vector3,
  nodes: SceneNodes,
  selectedLevelId: string | null,
  levelMode: string,
  hideAbove: boolean,
): number {
  if (!reg.isEligible() || !isRendered(reg.nodeId) || !reg.getWorldPosition(_itemPos))
    return Number.POSITIVE_INFINITY
  const { nodeId } = reg
  let current = nodes[nodeId]
  while (current) {
    if (current.type !== 'site' && current.visible === false) return Number.POSITIVE_INFINITY
    current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
  }
  const itemLevelId = findLevelAncestorId(nodeId, nodes)
  if (selectedLevelId && itemLevelId !== selectedLevelId && levelMode === 'solo')
    return Number.POSITIVE_INFINITY

  _dir.copy(_itemPos).sub(camPos).normalize()
  const dot = camFwd.dot(_dir) // 1 = ahead, -1 = behind

  // Angular component (0 = dead ahead, 2 = directly behind)
  const angular = 1 - dot
  // Normalised distance component (assumes scenes < 200 units)
  const dist = camPos.distanceTo(_itemPos) / 200

  // ── Level factor ──────────────────────────────────────────────────────────
  let levelPenalty = 0
  if (selectedLevelId) {
    if (itemLevelId !== selectedLevelId) {
      // Items on hidden levels (every other one in solo, those above the
      // selected one while editing) are invisible — deprioritize strongly
      const itemIndex = (nodes[itemLevelId as AnyNodeId] as LevelNode | undefined)?.level ?? 0
      const selectedIndex =
        (nodes[selectedLevelId as AnyNodeId] as LevelNode | undefined)?.level ?? 0
      const hidden = levelMode === 'solo' || (hideAbove && itemIndex > selectedIndex)
      levelPenalty = hidden ? 100 : 0.8
    }
  } else if (itemLevelId) {
    // No level selected — lightly prefer items on level index 0
    const levelNode = nodes[itemLevelId as AnyNodeId] as LevelNode | undefined
    const levelIndex = levelNode?.level ?? 0
    if (levelIndex !== 0) levelPenalty = 0.3
  }

  return angular * 0.7 + dist * 0.3 + levelPenalty
}

export function ItemLightSystem() {
  const scene = useThree((state) => state.scene)
  const bakedOwner = useItemLightPool((state) => state.bakedCanvases.has(scene))
  if (bakedOwner) return null
  return (
    <PooledLights<LightSource>
      getLights={() => useItemLightPool.getState().registrations.values()}
      intensity={(reg) => (reg.isEligible() && isRendered(reg.nodeId) ? reg.getIntensity() : 0)}
      score={(reg, camPos, camFwd) => {
        const viewer = useViewer.getState()
        return scoreRegistration(
          reg,
          camPos,
          camFwd,
          useScene.getState().nodes,
          viewer.selection.levelId,
          viewer.levelMode,
          viewer.hideLevelsAboveSelection,
        )
      }}
    />
  )
}
