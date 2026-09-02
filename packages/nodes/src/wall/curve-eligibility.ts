import type { AnyNode } from '@pascal-app/core'

export function hasWallCurveBlockingChildren(children: readonly AnyNode[]) {
  return children.some((child) => {
    if (child.type === 'door' || child.type === 'window' || child.type === 'lean-to-extension') {
      return true
    }
    if (child.type !== 'item') return false
    return child.asset?.attachTo === 'wall' || child.asset?.attachTo === 'wall-side'
  })
}
