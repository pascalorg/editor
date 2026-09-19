import type { Object3D } from 'three'

type R3FPointerObject = Object3D & {
  __r3f?: { eventCount?: number }
}

export function isDirectR3FPointerTarget(object: Object3D): boolean {
  return ((object as R3FPointerObject).__r3f?.eventCount ?? 0) > 0
}

export function isR3FPointerTarget(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (current.children.some(isDirectR3FPointerTarget)) return false
    if (isDirectR3FPointerTarget(current)) return true
    current = current.parent
  }
  return false
}
