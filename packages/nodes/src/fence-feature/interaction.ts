import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'

type GateAnimation = { frame: number; target: number }
const animations = new Map<AnyNodeId, GateAnimation>()

export function toggleFenceGate(nodeId: AnyNodeId) {
  const node = useScene.getState().nodes[nodeId]
  if (node?.type !== 'fence-gate') return

  const previous = animations.get(nodeId)
  if (previous) window.cancelAnimationFrame(previous.frame)

  const overrides = useLiveNodeOverrides.getState()
  const liveAngle = overrides.get(nodeId)?.openAngle
  const from = typeof liveAngle === 'number' ? liveAngle : (node.openAngle ?? 0)
  const target = previous ? (previous.target === 0 ? 90 : 0) : from > 0.01 ? 0 : 90
  const startedAt = window.performance.now()
  const duration = 520 * Math.max(0.15, Math.abs(target - from) / 90)
  const animation: GateAnimation = { frame: 0, target }

  const step = (time: number) => {
    const current = useScene.getState().nodes[nodeId]
    // Deletion, scene replacement, or an inspector edit invalidates this animation.
    if (current !== node) {
      animations.delete(nodeId)
      useLiveNodeOverrides.getState().clearFields(nodeId, ['openAngle'])
      return
    }

    const progress = Math.min(1, Math.max(0, (time - startedAt) / duration))
    const eased = progress * progress * (3 - 2 * progress)
    if (progress < 1) {
      // Live poses keep intermediate frames out of undo history.
      useLiveNodeOverrides.getState().set(nodeId, {
        openAngle: from + (target - from) * eased,
      })
      animation.frame = window.requestAnimationFrame(step)
      return
    }

    animations.delete(nodeId)
    useScene.getState().updateNode(nodeId, { openAngle: target })
    useLiveNodeOverrides.getState().clearFields(nodeId, ['openAngle'])
  }

  animations.set(nodeId, animation)
  animation.frame = window.requestAnimationFrame(step)
}
