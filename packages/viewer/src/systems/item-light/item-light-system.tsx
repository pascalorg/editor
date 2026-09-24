import type { AnyNodeId, LevelNode } from '@pascal-app/core'
import { findLevelAncestorId, sceneRegistry, useInteractive, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { type PointLight, Vector3 } from 'three'
import { type LightRegistration, useItemLightPool } from '../../store/use-item-light-pool'
import useViewer from '../../store/use-viewer'
import {
  ItemLightPool,
  isPoolLightOn,
  POOL_SIZE,
  poolLevelPenalty,
  poolScore,
  poolTargetIntensity,
  type ScoredKey,
} from './light-pool'

// Module-level temp vectors reused every frame (avoids GC pressure)
const _camPos = new Vector3()
const _camFwd = new Vector3()
const _itemPos = new Vector3()

type SceneNodes = ReturnType<typeof useScene.getState>['nodes']
type InteractiveState = ReturnType<typeof useInteractive.getState>

function lightWorldPosition(reg: LightRegistration, out: Vector3): boolean {
  const obj = sceneRegistry.nodes.get(reg.nodeId)
  if (!obj) return false
  obj.getWorldPosition(out)
  out.x += reg.effect.offset[0]
  out.y += reg.effect.offset[1]
  out.z += reg.effect.offset[2]
  return true
}

function scoreRegistration(
  reg: LightRegistration,
  nodes: SceneNodes,
  selectedLevelId: string | null,
  levelMode: string,
  interactiveState: InteractiveState,
): number {
  // Skip lights that are toggled off — they contribute no illumination
  if (!isPoolLightOn(reg, interactiveState.items[reg.nodeId]?.controlValues)) {
    return Number.POSITIVE_INFINITY
  }
  if (!lightWorldPosition(reg, _itemPos)) return Number.POSITIVE_INFINITY

  const itemLevelId = findLevelAncestorId(reg.nodeId, nodes)
  const levelNode = itemLevelId ? (nodes[itemLevelId as AnyNodeId] as LevelNode | undefined) : null
  const penalty = poolLevelPenalty(itemLevelId, levelNode?.level ?? 0, selectedLevelId, levelMode)
  return poolScore(_itemPos, _camPos, _camFwd, penalty)
}

export function ItemLightSystem() {
  const pool = useRef<ItemLightPool | null>(null)
  pool.current ??= new ItemLightPool()

  useFrame(({ camera }, delta) => {
    const p = pool.current!
    const { registrations } = useItemLightPool.getState()
    const interactiveState = useInteractive.getState()
    const sourceOf = (key: string) => registrations.get(key)

    camera.getWorldPosition(_camPos)
    camera.getWorldDirection(_camFwd)

    if (p.shouldReassign(_camPos, _camFwd, delta)) {
      // Read level/scene state once for the whole tick
      const nodes = useScene.getState().nodes
      const { selection, levelMode } = useViewer.getState()
      const scored: ScoredKey[] = []
      for (const [key, reg] of registrations) {
        scored.push({
          key,
          score: scoreRegistration(reg, nodes, selection.levelId, levelMode, interactiveState),
        })
      }
      p.reassign(scored, sourceOf)
    }

    p.update(Math.min(delta, 0.1), sourceOf, (key, light) => {
      const reg = registrations.get(key)
      if (!reg) return null
      if (lightWorldPosition(reg, _itemPos)) light.position.copy(_itemPos)
      return poolTargetIntensity(reg, interactiveState.items[reg.nodeId]?.controlValues)
    })
  })

  return (
    <>
      {Array.from({ length: POOL_SIZE }, (_, i) => (
        <pointLight
          castShadow={false}
          intensity={0}
          key={i}
          ref={(el: PointLight | null) => {
            pool.current!.lights[i] = el
          }}
          visible={false}
        />
      ))}
    </>
  )
}
