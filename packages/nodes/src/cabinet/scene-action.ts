import type { AnyNode, AnyNodeId, SceneActionCapability, SceneApi } from '@pascal-app/core'
import { getEffectiveNode, useLiveNodeOverrides } from '@pascal-app/core'
import {
  type CabinetCompartment,
  compartmentCooktopActiveBurners,
  compartmentCooktopElementCount,
  compartmentCooktopKnobProgress,
  patchCompartment,
} from './stack'

export type CabinetCooktopKnobTarget = {
  type: 'gas'
  compartmentIndex: number
  burnerIndex: number
}

const KNOB_TURN_DURATION_MS = 180
let knobAnimationId = 0
const activeKnobAnimations = new Map<string, Set<number>>()

function knobTargetFromUserData(
  userData: Record<string, unknown>,
): CabinetCooktopKnobTarget | null {
  const target = userData.cabinetCooktopKnob as CabinetCooktopKnobTarget | undefined
  if (
    target?.type === 'gas' &&
    Number.isInteger(target.compartmentIndex) &&
    Number.isInteger(target.burnerIndex) &&
    target.compartmentIndex >= 0 &&
    target.burnerIndex >= 0
  ) {
    return target
  }
  return null
}

function gasCompartmentAt(
  node: AnyNode,
  compartmentIndex: number,
): { stack: CabinetCompartment[]; compartment: CabinetCompartment } | null {
  const stack = (node as { stack?: unknown }).stack
  if (!Array.isArray(stack)) return null
  const compartment = stack[compartmentIndex] as CabinetCompartment | undefined
  if (!compartment || typeof compartment !== 'object') return null
  if (compartment.type !== 'cooktop-gas') return null
  return { stack: stack as CabinetCompartment[], compartment }
}

function withCooktopBurnerProgress(
  node: AnyNode,
  target: CabinetCooktopKnobTarget,
  progress: number,
  nextActiveBurners: readonly number[],
): Partial<AnyNode> | null {
  const resolved = gasCompartmentAt(node, target.compartmentIndex)
  if (!resolved) return null
  const { stack, compartment } = resolved

  const nextProgress = compartmentCooktopKnobProgress(
    patchCompartment(compartment, { cooktopActiveBurners: [...nextActiveBurners] }),
    'cooktop-gas',
  )
  nextProgress[target.burnerIndex] = Math.max(0, Math.min(1, progress))

  return {
    stack: stack.map((entry, index) =>
      index === target.compartmentIndex
        ? patchCompartment(entry, {
            cooktopBurnersOn: nextActiveBurners.length > 0,
            cooktopActiveBurners: [...nextActiveBurners],
            cooktopKnobProgress: nextProgress,
          })
        : entry,
    ),
  } as Partial<AnyNode>
}

function activeBurnersWithTarget(
  compartment: CabinetCompartment,
  target: CabinetCooktopKnobTarget,
  active: boolean,
): number[] {
  const current = compartmentCooktopActiveBurners(compartment, 'cooktop-gas')
  const withoutTarget = current.filter((index) => index !== target.burnerIndex)
  return active ? [...withoutTarget, target.burnerIndex].sort((a, b) => a - b) : withoutTarget
}

function startKnobAnimation(nodeId: AnyNodeId): number {
  const key = nodeId as string
  const id = ++knobAnimationId
  const active = activeKnobAnimations.get(key) ?? new Set<number>()
  active.add(id)
  activeKnobAnimations.set(key, active)
  return id
}

function finishKnobAnimation(nodeId: AnyNodeId, id: number): boolean {
  const key = nodeId as string
  const active = activeKnobAnimations.get(key)
  if (!active) return true
  active.delete(id)
  if (active.size > 0) return false
  activeKnobAnimations.delete(key)
  return true
}

/**
 * Toggle one gas burner. The knob eases over ~180ms by publishing transient
 * stack patches through `useLiveNodeOverrides` (+ dirty marks so the geometry
 * rebuilds each frame), then commits the final state once — a single undo step.
 */
function toggleCabinetCooktopKnob(
  node: AnyNode,
  target: CabinetCooktopKnobTarget,
  sceneApi: SceneApi,
): boolean {
  const resolved = gasCompartmentAt(node, target.compartmentIndex)
  if (!resolved) return false
  const { compartment } = resolved

  const count = compartmentCooktopElementCount(compartment, 'cooktop-gas')
  if (target.burnerIndex >= count) return false

  const activeBurners = compartmentCooktopActiveBurners(compartment, 'cooktop-gas')
  const wasActive = activeBurners.includes(target.burnerIndex)
  const from = compartmentCooktopKnobProgress(compartment, 'cooktop-gas')[target.burnerIndex] ?? 0
  const to = wasActive ? 0 : 1
  const nodeId = node.id as AnyNodeId
  const startedAt = performance.now()
  const animationId = startKnobAnimation(nodeId)

  const buildPatch = (progress: number): Partial<AnyNode> | null => {
    const latest = sceneApi.get(nodeId)
    const effectiveNode = getEffectiveNode(latest ?? node)
    const latestCompartment = gasCompartmentAt(effectiveNode, target.compartmentIndex)?.compartment
    if (!latestCompartment) return null
    return withCooktopBurnerProgress(
      effectiveNode,
      target,
      progress,
      activeBurnersWithTarget(latestCompartment, target, !wasActive),
    )
  }

  const tick = (time: number) => {
    const elapsed = Math.max(0, time - startedAt)
    const t = Math.min(1, elapsed / KNOB_TURN_DURATION_MS)
    const eased = 1 - (1 - t) ** 3
    const progress = from + (to - from) * eased
    const patch = buildPatch(progress)
    if (patch) {
      useLiveNodeOverrides.getState().set(nodeId, patch as Record<string, unknown>)
      sceneApi.markDirty(nodeId)
    }

    if (t < 1) {
      requestAnimationFrame(tick)
      return
    }

    const finalPatch = buildPatch(to)
    const shouldClearOverride = finishKnobAnimation(nodeId, animationId)
    if (finalPatch) {
      sceneApi.update(nodeId, finalPatch)
    } else {
      sceneApi.markDirty(nodeId)
    }
    if (shouldClearOverride) useLiveNodeOverrides.getState().clear(nodeId)
  }
  requestAnimationFrame(tick)
  return true
}

// Exposed with the default `unknown` target: `activate` only ever receives
// what this capability's own `resolveTarget` returned, so the narrow is safe.
export const cabinetSceneAction: SceneActionCapability = {
  resolveTarget: (object) => knobTargetFromUserData(object.userData),
  activate: (node, target, sceneApi) =>
    toggleCabinetCooktopKnob(node, target as CabinetCooktopKnobTarget, sceneApi),
}
