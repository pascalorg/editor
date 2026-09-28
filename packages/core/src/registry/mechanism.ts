import type { AnyNode } from '../schema/types'
import { useInteractive } from '../store/use-interactive'
import { nodeRegistry } from './registry'
import type { MechanismCapability } from './types'

/** The node's mechanism, when its kind declares one and the node has something to run. */
export function nodeMechanism(node: AnyNode | undefined): MechanismCapability | undefined {
  if (!node) return
  const mechanism = nodeRegistry.get(node.type)?.capabilities.mechanism
  return mechanism?.has(node) ? mechanism : undefined
}

/** Any of its mechanisms running → stop them all, else start them all. */
export function toggleMechanism(mechanism: MechanismCapability, node: AnyNode): void {
  mechanism.set(node, !mechanism.isOn(node, useInteractive.getState()))
}

/** Toggles the node's mechanism; false when it has none. */
export function toggleNodeMechanism(node: AnyNode): boolean {
  const mechanism = nodeMechanism(node)
  if (!mechanism) return false
  toggleMechanism(mechanism, node)
  return true
}
