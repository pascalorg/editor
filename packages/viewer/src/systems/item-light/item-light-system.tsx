import type { AnyNodeId, LevelNode } from '@pascal-app/core'
import { findLevelAncestorId, sceneRegistry, useScene } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { SCENE_LAYER } from '../../lib/layers'
import { type LightSource, useItemLightPool } from '../../store/use-item-light-pool'
import useViewer from '../../store/use-viewer'
import { PooledLights } from './pooled-lights'

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

// A light on another storey than the one being edited counts for this much of what it adds.
const OTHER_LEVEL_WEIGHT = 0.25

/** 0 while the light cannot be seen lit (off, hidden, on a hidden level), else its level factor. */
function registrationWeight(
  reg: LightSource,
  nodes: SceneNodes,
  selectedLevelId: string | null,
  levelMode: string,
  hideAbove: boolean,
): number {
  if (!reg.isEligible() || !isRendered(reg.nodeId)) return 0
  const { nodeId } = reg
  let current = nodes[nodeId]
  while (current) {
    if (current.type !== 'site' && current.visible === false) return 0
    current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
  }
  const itemLevelId = findLevelAncestorId(nodeId, nodes)
  if (!selectedLevelId || itemLevelId === selectedLevelId) return 1
  if (levelMode === 'solo') return 0
  // Above the selected level while editing, a storey is hidden.
  const itemIndex = (nodes[itemLevelId as AnyNodeId] as LevelNode | undefined)?.level ?? 0
  const selectedIndex = (nodes[selectedLevelId as AnyNodeId] as LevelNode | undefined)?.level ?? 0
  return hideAbove && itemIndex > selectedIndex ? 0 : OTHER_LEVEL_WEIGHT
}

export function ItemLightSystem() {
  const scene = useThree((state) => state.scene)
  const bakedOwner = useItemLightPool((state) => state.bakedCanvases.has(scene))
  if (bakedOwner) return null
  return (
    <PooledLights<LightSource>
      getLights={() => useItemLightPool.getState().registrations.values()}
      intensity={(reg) => (reg.isEligible() && isRendered(reg.nodeId) ? reg.getIntensity() : 0)}
      weight={(reg) => {
        const viewer = useViewer.getState()
        return registrationWeight(
          reg,
          useScene.getState().nodes,
          viewer.selection.levelId,
          viewer.levelMode,
          viewer.hideLevelsAboveSelection,
        )
      }}
    />
  )
}
