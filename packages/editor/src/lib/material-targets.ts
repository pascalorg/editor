import {
  type AnyNode,
  type MaterialSchema,
  MaterialTarget,
  type MaterialTargetDescriptor,
  nodeRegistry,
} from '@pascal-app/core'

export type MaterialBearingNode = AnyNode & {
  material?: MaterialSchema
  materialPreset?: string
}

export function hasMaterialFields(node: AnyNode | null | undefined): node is MaterialBearingNode {
  return Boolean(node && ('material' in node || 'materialPreset' in node))
}

export function getMaterialTargetsForNode(
  node: AnyNode | null | undefined,
): readonly MaterialTargetDescriptor[] {
  if (!node) return []
  const declaredTargets = nodeRegistry.get(node.type)?.materialTargets
  if (declaredTargets?.length) return declaredTargets
  return []
}

export function getMaterialTargetKindForNode(node: AnyNode | null | undefined) {
  if (!node) return null
  const parsed = MaterialTarget.safeParse(node.type)
  if (!parsed.success) return null
  return getMaterialTargetsForNode(node).length > 0 ? parsed.data : null
}

export function supportsWholeSurfaceMaterial(node: AnyNode | null | undefined) {
  return getMaterialTargetsForNode(node).some((target) => target.kind === 'whole')
}
