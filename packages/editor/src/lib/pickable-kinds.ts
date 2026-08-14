import { getSelectableKinds } from '@pascal-app/core'

/**
 * Built-in kinds that emit pointer events but are not registry-selectable, so
 * `getSelectableKinds()` alone does not reach them. A picker subscribed only to
 * the registry list silently misses a click on a wall — the single most likely
 * thing anyone points at.
 *
 * `selection-manager.tsx` carries three near-copies of this list that predate
 * this module and have already drifted from each other (they differ in which
 * kinds they include, per handler). They are deliberately left alone: folding
 * them together would change which kinds each of its handlers responds to,
 * which is a selection change, not a refactor.
 */
const BUILTIN_PICKABLE_KINDS = [
  'wall',
  'fence',
  'item',
  'column',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'window',
  'door',
  'zone',
  'shelf',
  'spawn',
  'elevator',
  'building',
] as const

/** Every node kind whose surface a pointer can land on, built-in plus plugin. */
export function getPickableNodeKinds(): string[] {
  const builtins = BUILTIN_PICKABLE_KINDS as readonly string[]
  return [...builtins, ...getSelectableKinds().filter((kind) => !builtins.includes(kind))]
}
