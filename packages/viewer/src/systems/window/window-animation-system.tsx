import {
  type AnyNodeId,
  emitter,
  sceneRegistry,
  useInteractive,
  useScene,
  type WindowInteractiveState,
  type WindowNode,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { poseWindowMovingParts, poseWindowShutters } from './window-pose'
import { pendingWindowAnimationRebuilds } from './window-system'

export { poseWindowMovingParts } from './window-pose'

const easeWindowAnimation = (value: number) => value * value * (3 - 2 * value)

function applyDirectWindowAnimation(
  node: WindowNode,
  field: keyof WindowInteractiveState,
  value: number,
) {
  const mesh = sceneRegistry.nodes.get(node.id)
  if (field === 'rollerShutterOpen') return false
  if (field === 'shutterOpen') return poseWindowShutters(node, mesh, value)
  const shutterOpen =
    useInteractive.getState().windows[node.id]?.shutterOpen ?? node.shutterOpen ?? 1
  return poseWindowMovingParts(node, mesh, value, shutterOpen)
}

/** Advance the same viewer frame loop with an explicit clock for deterministic hosts and tests. */
export function advanceWindowAnimations(now: number): void {
  const interactive = useInteractive.getState()
  for (const [windowId, animations] of Object.entries(interactive.windowAnimations)) {
    const typedWindowId = windowId as AnyNodeId
    const scene = useScene.getState()
    const node = scene.nodes[typedWindowId]
    if (node?.type !== 'window') {
      interactive.cancelWindowAnimation(typedWindowId)
      interactive.removeWindowOpenState(typedWindowId)
      interactive.removeMechanismParts(typedWindowId)
      pendingWindowAnimationRebuilds.delete(typedWindowId)
      continue
    }

    for (const animation of Object.values(animations)) {
      const startedAt = animation.startedAt ?? now
      if (animation.startedAt === null) {
        interactive.startWindowAnimation(typedWindowId, { ...animation, startedAt })
      }

      const progress = Math.min(1, Math.max(0, (now - startedAt) / animation.durationMs))
      const value = animation.from + (animation.to - animation.from) * easeWindowAnimation(progress)
      interactive.setWindowOpenState(typedWindowId, { [animation.field]: value })
      const appliedDirectly = applyDirectWindowAnimation(node, animation.field, value)
      // A dirty mark is one-shot work, not a needs-frame signal. Variable
      // topology (including roller slats) requests a transient rebuild instead.
      if (!appliedDirectly) pendingWindowAnimationRebuilds.add(typedWindowId)

      if (progress < 1) continue

      interactive.cancelWindowAnimation(typedWindowId, animation.field)
      if (animation.persist) {
        scene.updateNode(typedWindowId, { [animation.field]: animation.to })
        interactive.removeWindowOpenState(typedWindowId, animation.field)
      }
      // Rejoin the static batch at the settled pose, including preview-only runs.
      scene.markDirty(typedWindowId)
      emitter.emit('window:animation-completed', {
        windowId: typedWindowId as WindowNode['id'],
        field: animation.field,
      })
    }
  }
}

export const WindowAnimationSystem = () => {
  useFrame(({ clock }) => advanceWindowAnimations(clock.getElapsedTime() * 1000), 2)
  return null
}
