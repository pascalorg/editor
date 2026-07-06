import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { isFridgeCompartmentType, stackForCabinet } from './stack'

/**
 * Shared open/close animator for cabinet runs and modules, used by both the
 * panel's Play button and the registry `keyboardActions.e` interaction.
 *
 * Mid-flight frames publish through `useLiveNodeOverrides` rather than
 * `scene.updateNode`: the temporal (undo) store records every updateNode, so
 * per-rAF commits would burn ~20 undo entries per play. Stop/finish commits
 * once. The cabinet animation system reads the effective node per frame, so
 * overrides pose the doors in real time without geometry rebuilds.
 */

type CabinetAnimation = { frame: number }

const activeAnimations = new Map<string, CabinetAnimation>()
const listeners = new Set<(nodeId: string, running: boolean) => void>()

function notify(nodeId: string, running: boolean) {
  for (const listener of listeners) listener(nodeId, running)
}

/** Subscribe to animation start/stop, e.g. for the panel's Play/Stop button. */
export function onCabinetAnimationChange(listener: (nodeId: string, running: boolean) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isCabinetAnimationRunning(nodeId: AnyNodeId): boolean {
  return activeAnimations.has(nodeId)
}

function isCabinetLike(nodeId: AnyNodeId) {
  const node = useScene.getState().nodes[nodeId]
  return node?.type === 'cabinet' || node?.type === 'cabinet-module' ? node : null
}

/** Cancel an in-flight animation, committing the current live frame once. */
export function stopCabinetAnimation(nodeId: AnyNodeId) {
  const animation = activeAnimations.get(nodeId)
  if (!animation) return
  window.cancelAnimationFrame(animation.frame)
  activeAnimations.delete(nodeId)

  const overrides = useLiveNodeOverrides.getState()
  const liveValue = overrides.get(nodeId)?.operationState
  if (typeof liveValue === 'number' && isCabinetLike(nodeId)) {
    useScene.getState().updateNode(nodeId, { operationState: liveValue })
  }
  overrides.clearFields(nodeId, ['operationState'])
  notify(nodeId, false)
}

export function animateCabinetOperationState(nodeId: AnyNodeId, target: 0 | 1) {
  const existing = activeAnimations.get(nodeId)
  if (existing) {
    window.cancelAnimationFrame(existing.frame)
    activeAnimations.delete(nodeId)
  }

  const node = isCabinetLike(nodeId)
  if (!node) return

  const overrides = useLiveNodeOverrides.getState()
  const liveValue = overrides.get(nodeId)?.operationState
  const start = typeof liveValue === 'number' ? liveValue : (node.operationState ?? 0)
  if (Math.abs(start - target) < 1e-4) {
    overrides.clearFields(nodeId, ['operationState'])
    useScene.getState().updateNode(nodeId, { operationState: target })
    return
  }

  // Fridge doors are heavy — swing a touch slower.
  const hasFridge = stackForCabinet(node).some((compartment) =>
    isFridgeCompartmentType(compartment.type),
  )
  const duration = hasFridge ? 450 : 320
  const startTime = window.performance.now()

  const step = (time: number) => {
    const animation = activeAnimations.get(nodeId)
    if (!animation) return
    const t = Math.min(1, (time - startTime) / duration)
    const eased = 1 - (1 - t) ** 3
    const nextValue = start + (target - start) * eased

    if (t < 1) {
      useLiveNodeOverrides.getState().set(nodeId, { operationState: nextValue })
      animation.frame = window.requestAnimationFrame(step)
      return
    }

    activeAnimations.delete(nodeId)
    useScene.getState().updateNode(nodeId, { operationState: target })
    useLiveNodeOverrides.getState().clearFields(nodeId, ['operationState'])
    notify(nodeId, false)
  }

  activeAnimations.set(nodeId, { frame: window.requestAnimationFrame(step) })
  notify(nodeId, true)
}

function effectiveOperationState(nodeId: AnyNodeId, nodeValue: number | undefined): number {
  const liveValue = useLiveNodeOverrides.getState().get(nodeId)?.operationState
  return typeof liveValue === 'number' ? liveValue : (nodeValue ?? 0)
}

/**
 * E-key interaction: animate toward open when mostly closed, toward closed
 * when mostly open. Pressing E mid-animation reverses from the live frame.
 * On a run, every child module swings together (the run's own
 * `operationState` doesn't pose module doors — each module owns its own).
 */
export function toggleCabinetOperationState(nodeId: AnyNodeId) {
  const node = isCabinetLike(nodeId)
  if (!node) return

  if (node.type === 'cabinet') {
    const nodes = useScene.getState().nodes
    const modules = (node.children ?? [])
      .map((id) => nodes[id as AnyNodeId])
      .filter((child) => child?.type === 'cabinet-module')
    if (modules.length === 0) return
    const anyOpen = modules.some(
      (module) => effectiveOperationState(module!.id as AnyNodeId, module!.operationState) >= 0.5,
    )
    const target = anyOpen ? 0 : 1
    for (const module of modules) {
      animateCabinetOperationState(module!.id as AnyNodeId, target)
    }
    return
  }

  const current = effectiveOperationState(nodeId, node.operationState)
  animateCabinetOperationState(nodeId, current >= 0.5 ? 0 : 1)
}
