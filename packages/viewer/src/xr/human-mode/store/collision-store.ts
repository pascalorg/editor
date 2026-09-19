import type { Mesh } from 'three'
import { resolveCapsuleTranslation } from '../lib/capsule-collision'

let activeColliders: readonly Mesh[] = []

export function setActiveHumanColliders(colliders: readonly Mesh[]) {
  activeColliders = colliders
}

export function resolveHumanCollisionTranslation(
  playerPosition: Parameters<typeof resolveCapsuleTranslation>[1],
  movement: Parameters<typeof resolveCapsuleTranslation>[2],
  target: Parameters<typeof resolveCapsuleTranslation>[3],
) {
  return resolveCapsuleTranslation(activeColliders, playerPosition, movement, target)
}
