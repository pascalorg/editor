import {
  type AnyNode,
  type AnyNodeId,
  isScriptedNode,
  nodeMechanism,
  nodeRegistry,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import type { WalkthroughInteract } from '../../../store/use-first-person-hud'

/**
 * Whether the walkthrough swings this door or window itself, through the native `operationState`
 * its door and window systems draw. One built from a script has no native leaf or sash: a swing
 * would draw nothing, so its clips run through its mechanism, as an authored object's do.
 */
export function hasNativeLeaf(node: AnyNode | undefined): boolean {
  return !isScriptedNode(node)
}

/** Mounted doors and windows the walkthrough's own door and window targets cover. */
export function nativeOpeningIds(): AnyNodeId[] {
  const nodes = useScene.getState().nodes
  const ids: AnyNodeId[] = []
  for (const kind of ['door', 'window'] as const) {
    for (const id of sceneRegistry.byType[kind] ?? []) {
      if (hasNativeLeaf(nodes[id as AnyNodeId])) ids.push(id as AnyNodeId)
    }
  }
  return ids
}

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

/** Ids of the mounted doors built from a script that are open, by their mechanism. */
function openScriptedDoors(): string {
  const nodes = useScene.getState().nodes
  const state = useInteractive.getState()
  const open: string[] = []
  for (const id of sceneRegistry.byType.door ?? []) {
    const node = nodes[id as AnyNodeId]
    if (isScriptedNode(node) && nodeMechanism(node)?.isOn(node, state)) open.push(id)
  }
  return open.sort().join(',')
}

/**
 * Calls `onChange` when a mounted door built from a script opens or closes. The walkthrough's
 * collider follows the door's mechanism, and its model's clip is moved by no tween system that
 * would report the end, as a native door's does: without this the world keeps the leaf that was
 * there when it was last built. It fires at the toggle: the doorway is passable as the leaves
 * start to move, and solid again as they start to close.
 */
export function watchScriptedDoors(onChange: () => void): () => void {
  let known = openScriptedDoors()
  return useInteractive.subscribe((state, previous) => {
    if (state.items === previous.items) return
    const next = openScriptedDoors()
    if (next === known) return
    known = next
    onChange()
  })
}
