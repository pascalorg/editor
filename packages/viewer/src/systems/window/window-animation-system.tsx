import {
  type AnyNodeId,
  emitter,
  sceneRegistry,
  useInteractive,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { poseWindowMovingParts } from './window-pose'
import { pendingWindowAnimationRebuilds } from './window-system'

export { poseWindowMovingParts } from './window-pose'

const easeWindowAnimation = (value: number) => value * value * (3 - 2 * value)

function applyDirectWindowAnimation(windowId: AnyNodeId, value: number) {
  const node = useScene.getState().nodes[windowId]
  if (node?.type !== 'window') return false
  return poseWindowMovingParts(node, sceneRegistry.nodes.get(windowId), value)
}

export const WindowAnimationSystem = () => {
  useFrame(({ clock }) => {
    const interactive = useInteractive.getState()
    const entries = Object.entries(interactive.windowAnimations)
    if (entries.length === 0) return

    const now = clock.getElapsedTime() * 1000

    for (const [windowId, animation] of entries) {
      const typedWindowId = windowId as AnyNodeId
      const scene = useScene.getState()
      const node = scene.nodes[typedWindowId]
      if (node?.type !== 'window') {
        interactive.cancelWindowAnimation(typedWindowId)
        interactive.removeWindowOpenState(typedWindowId)
        continue
      }

      const startedAt = animation.startedAt ?? now
      if (animation.startedAt === null) {
        interactive.startWindowAnimation(typedWindowId, { ...animation, startedAt })
      }

      const progress = Math.min(1, (now - startedAt) / animation.durationMs)
      const value = animation.from + (animation.to - animation.from) * easeWindowAnimation(progress)
      interactive.setWindowOpenState(typedWindowId, { [animation.field]: value })
      const appliedDirectly = applyDirectWindowAnimation(typedWindowId, value)
      // A dirty mark is one-shot work, not a needs-frame signal — per-tick
      // marks kept the scene from ever settling. Types without a direct pose
      // path get a transient rebuild request instead.
      if (!appliedDirectly) pendingWindowAnimationRebuilds.add(typedWindowId)

      if (progress < 1) continue

      interactive.cancelWindowAnimation(typedWindowId)
      if (animation.persist) {
        scene.updateNode(typedWindowId, { [animation.field]: animation.to })
        interactive.removeWindowOpenState(typedWindowId)
        // One-shot: the rebuild re-derives the pose from the persisted node.
        scene.markDirty(typedWindowId)
      } else {
        interactive.setWindowOpenState(typedWindowId, { [animation.field]: animation.to })
        if (!appliedDirectly) scene.markDirty(typedWindowId)
      }
      emitter.emit('window:animation-completed', {
        windowId: typedWindowId as WindowNode['id'],
        field: animation.field,
      })
    }
  }, 2)

  return null
}
