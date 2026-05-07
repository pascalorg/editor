import {
  type AnyNodeId,
  emitter,
  sceneRegistry,
  useInteractive,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import {
  AWNING_WINDOW_SASH_NAME,
  CASEMENT_WINDOW_SASH_NAME,
  DOUBLE_HUNG_BOTTOM_SASH_NAME,
  DOUBLE_HUNG_TOP_SASH_NAME,
  FRENCH_CASEMENT_LEFT_SASH_NAME,
  FRENCH_CASEMENT_RIGHT_SASH_NAME,
  HOPPER_WINDOW_SASH_NAME,
  LOUVERED_WINDOW_SLATS_NAME,
  SINGLE_HUNG_ACTIVE_SASH_NAME,
  SLIDING_WINDOW_ACTIVE_PANEL_NAME,
} from './window-system'

const easeWindowAnimation = (value: number) => value * value * (3 - 2 * value)

function markWindowDirty(windowId: AnyNodeId) {
  const scene = useScene.getState()
  const node = scene.nodes[windowId]
  scene.dirtyNodes.add(windowId)
}

function applyDirectWindowAnimation(windowId: AnyNodeId, value: number) {
  const node = useScene.getState().nodes[windowId]
  if (node?.type !== 'window') return false

  const mesh = sceneRegistry.nodes.get(windowId)

  if (node.windowType === 'sliding') {
    const activePanel = mesh?.getObjectByName(SLIDING_WINDOW_ACTIVE_PANEL_NAME)
    if (!activePanel) return false

    const innerW = node.width - 2 * node.frameThickness
    const panelOverlap = Math.min(Math.max(node.frameThickness * 0.9, 0.04), innerW * 0.12)
    const travel = Math.max(innerW / 2 - panelOverlap, 0) * value
    activePanel.position.x = -innerW / 4 - panelOverlap / 4 + travel
    return true
  }

  if (node.windowType === 'single-hung') {
    const activeSash = mesh?.getObjectByName(SINGLE_HUNG_ACTIVE_SASH_NAME)
    if (!activeSash) return false

    const innerH = node.height - 2 * node.frameThickness
    const panelOverlap = Math.min(Math.max(node.frameThickness * 0.9, 0.04), innerH * 0.12)
    const travel = Math.max(innerH / 2 - panelOverlap, 0) * value
    activeSash.position.y = -innerH / 4 - panelOverlap / 4 + travel
    return true
  }

  if (node.windowType === 'double-hung') {
    const topSash = mesh?.getObjectByName(DOUBLE_HUNG_TOP_SASH_NAME)
    const bottomSash = mesh?.getObjectByName(DOUBLE_HUNG_BOTTOM_SASH_NAME)
    if (!(topSash && bottomSash)) return false

    const innerH = node.height - 2 * node.frameThickness
    const panelOverlap = Math.min(Math.max(node.frameThickness * 0.9, 0.04), innerH * 0.12)
    const travel = Math.max(innerH / 2 - panelOverlap, 0) * value
    topSash.position.y = innerH / 4 + panelOverlap / 4 - travel
    bottomSash.position.y = -innerH / 4 - panelOverlap / 4 + travel
    return true
  }

  if (node.windowType === 'louvered') {
    const slats = mesh?.getObjectByName(LOUVERED_WINDOW_SLATS_NAME)
    if (!slats) return false

    const slatAngle = -value * (Math.PI / 3)
    for (const slat of slats.children) {
      slat.rotation.x = slatAngle
    }
    return true
  }

  if (node.windowType === 'casement') {
    if ((node.casementStyle ?? 'single') === 'french') {
      const leftSash = mesh?.getObjectByName(FRENCH_CASEMENT_LEFT_SASH_NAME)
      const rightSash = mesh?.getObjectByName(FRENCH_CASEMENT_RIGHT_SASH_NAME)
      if (!(leftSash && rightSash)) return false

      leftSash.rotation.y = -value * (Math.PI / 2)
      rightSash.rotation.y = value * (Math.PI / 2)
      return true
    }

    const sash = mesh?.getObjectByName(CASEMENT_WINDOW_SASH_NAME)
    if (!sash) return false

    const hingeSign = (node.hingesSide ?? 'left') === 'left' ? -1 : 1
    sash.rotation.y = hingeSign * value * (Math.PI / 2)
    return true
  }

  if (node.windowType === 'awning') {
    const sash = mesh?.getObjectByName(AWNING_WINDOW_SASH_NAME)
    if (!sash) return false

    sash.rotation.x = -value * (Math.PI / 3)
    return true
  }

  if (node.windowType === 'hopper') {
    const sash =
      mesh?.getObjectByName(AWNING_WINDOW_SASH_NAME) ??
      mesh?.getObjectByName(HOPPER_WINDOW_SASH_NAME)
    if (!sash) return false

    sash.rotation.x = -value * (Math.PI / 3)
    return true
  }

  return false
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
      if (!appliedDirectly) markWindowDirty(typedWindowId)

      if (progress < 1) continue

      interactive.cancelWindowAnimation(typedWindowId)
      if (animation.persist) {
        scene.updateNode(typedWindowId, { [animation.field]: animation.to })
        interactive.removeWindowOpenState(typedWindowId)
        markWindowDirty(typedWindowId)
      } else {
        interactive.setWindowOpenState(typedWindowId, { [animation.field]: animation.to })
      }
      emitter.emit('window:animation-completed', {
        windowId: typedWindowId as WindowNode['id'],
        field: animation.field,
      })
    }
  }, 2)

  return null
}
