import type { AnyNode, AnyNodeId, HandleDescriptor, SceneApi } from '@pascal-app/core'
import { hostedChildUpdates, planHostedEdit, withHostedChildren } from '../shared/hosted-resize'

const policy = {
  host: (node: AnyNode) => node.type === 'cabinet',
  child: (node: AnyNode) => node.type !== 'cabinet' && node.type !== 'cabinet-module',
}

export function cabinetHostedChildUpdates(
  before: Record<AnyNodeId, AnyNode>,
  after: Record<AnyNodeId, AnyNode>,
) {
  return hostedChildUpdates(before, after, policy)
}

export function planCabinetHostedEdit(scene: SceneApi, apply: (staged: SceneApi) => void) {
  return planHostedEdit(scene, apply, policy)
}

export function withCabinetHostedChildren<N extends AnyNode>(
  descriptor: HandleDescriptor<N>,
): HandleDescriptor<N> {
  return descriptor.kind === 'linear-resize' ? withHostedChildren(descriptor, policy) : descriptor
}
