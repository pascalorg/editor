import {
  type AnyNode,
  type AnyNodeId,
  nodeMechanism,
  nodeRegistry,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import type { WalkthroughInteract } from '../../../store/use-first-person-hud'

/**
 * Mounted nodes the walkthrough runs through `capabilities.mechanism`, any kind
 * included. `covered` holds the nodes a finer target already tested (procedural
 * parts, catalog item toggles), so no node is targeted twice.
 */
export function mechanismTargetIds(covered: ReadonlySet<string>): AnyNodeId[] {
  const nodes = useScene.getState().nodes
  const ids: AnyNodeId[] = []
  for (const [kind, kindIds] of Object.entries(sceneRegistry.byType)) {
    if (!nodeRegistry.get(kind)?.capabilities.mechanism) continue
    for (const id of kindIds) {
      if (!covered.has(id) && nodeMechanism(nodes[id as AnyNodeId])) ids.push(id as AnyNodeId)
    }
  }
  return ids
}

/** The walkthrough prompt for a mechanism target: its name and what E does next. */
export function mechanismHudInteract(node: AnyNode): WalkthroughInteract {
  const mechanism = nodeMechanism(node)
  if (!mechanism) return null
  const on = mechanism.isOn(node, useInteractive.getState())
  const verb = mechanism.verb === 'open' ? (on ? 'close' : 'open') : on ? 'turn off' : 'turn on'
  return { label: node.name ?? 'item', verb }
}
