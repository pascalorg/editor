// The hot-set: which scene objects are raycast-eligible during an interaction.
//
// It is never hand-authored per interaction. It falls out of the node's
// `asset.attachTo` plus whether a candidate exposes a top surface. "Floor item"
// really means surface-resting: it rests on the floor *or* any host's top
// surface. Walls and ceilings are the special attach modes. Adding a node kind
// = set `attachTo` (or leave blank); the hot-set follows with zero per-kind
// wiring.

import type { InteractionScope } from './scope'

// What a node attaches to, collapsed to the three classes the hot-set cares
// about. `wall-side` is a wall attachment; everything without an explicit
// `attachTo` is surface-resting.
export type AttachClass = 'wall' | 'ceiling' | 'surface'

export function attachClassOf(attachTo: string | undefined | null): AttachClass {
  if (attachTo === 'wall' || attachTo === 'wall-side') return 'wall'
  if (attachTo === 'ceiling') return 'ceiling'
  return 'surface'
}

// The metadata the hot-set needs about a candidate host/surface. Derived from
// the candidate node + its registry definition by the caller, so this module
// stays pure and unit-testable without the scene or registry.
export type HotSetCandidate = {
  type: string
  // The level floor plane / ground a surface-resting node can always rest on.
  isFloorLike: boolean
  // The candidate exposes a usable top surface (registry
  // `capabilities.surfaces.top`) — a table, a shelf, a slab.
  exposesTop: boolean
  // The candidate's own attach class. A ceiling fan is `ceiling`: it hangs from
  // the ceiling and must never act as a host top (Track E).
  attachClass: AttachClass
}

// For a node whose attach class is `placed`, is `candidate` a valid
// host/surface to pick during placement or move?
export function isPickableForAttach(placed: AttachClass, candidate: HotSetCandidate): boolean {
  if (placed === 'wall') return candidate.type === 'wall'
  if (placed === 'ceiling') return candidate.type === 'ceiling'
  // Surface-resting: the floor, or any host that exposes a top surface — but
  // never a ceiling-mounted host (a floor lamp must not land on a ceiling fan).
  if (candidate.isFloorLike) return true
  if (!candidate.exposesTop) return false
  if (candidate.attachClass === 'ceiling') return false
  return true
}

// The hot-set predicate for a whole scope. For placing/moving it derives from
// the moving node's attach class; for every other active scope nothing in the
// scene is a placement target, so the body's own raycast owns the pointer.
// `idle` returns true here — selection/phase filtering stays in the selection
// manager; this only narrows what an *active* interaction can target.
export function isCandidateInHotSet(
  scope: InteractionScope,
  placedAttachClass: AttachClass | null,
  candidate: HotSetCandidate,
): boolean {
  if (scope.kind === 'idle') return true
  if (scope.kind === 'placing' || scope.kind === 'moving') {
    if (placedAttachClass === null) return true
    return isPickableForAttach(placedAttachClass, candidate)
  }
  return false
}
