import { buildLawn, type GeometryContext, LawnBuildError, type LawnNode } from '@pascal-app/core'
import { lawnContextNodes } from './context'

export function buildVisibleLawn(node: LawnNode, ctx?: Partial<GeometryContext>) {
  try {
    return buildLawn(node, lawnContextNodes(node, ctx))
  } catch (error) {
    // A later owner can cover an existing lawn; only new authoring must refuse empty coverage.
    if (error instanceof LawnBuildError && error.code === 'lawn_empty') return null
    throw error
  }
}
