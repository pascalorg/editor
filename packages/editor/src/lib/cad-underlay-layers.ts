import type { CadUnderlayNode } from '@pascal-app/core'
import type { LoadedCadUnderlay } from './cad-underlay-cache'

/**
 * Which layers of an underlay are drawn, and in what colour.
 *
 * The single source of truth for three consumers: the 2D floor-plan builder,
 * the 3D renderer, and the snap index. The first two must agree because of the
 * repo's 2D↔3D parity rule; the third must agree with both for a subtler
 * reason — a snap pool built from a different answer would silently pull the
 * cursor onto lines the user has hidden and cannot see.
 */
export type ResolvedCadLayer = {
  index: number
  name: string
  color: string
}

/**
 * A CAD underlay is reference material, not the model. Drawing it in the
 * drawing's own layer colours would fight the actual building for attention;
 * a single muted grey reads as "trace over this" at a glance. Per-layer
 * overrides exist for the cases where telling walls from furniture matters.
 */
export const CAD_UNDERLAY_DEFAULT_COLOR = '#8b93a7'

export function resolveCadLayers(
  node: CadUnderlayNode,
  loaded: LoadedCadUnderlay,
): ResolvedCadLayer[] {
  const resolved: ResolvedCadLayer[] = []

  for (const [index, layer] of loaded.underlay.layers.entries()) {
    // An empty layer would contribute an empty path and an empty draw call.
    if ((loaded.countByLayer[index] ?? 0) === 0) continue

    const override = node.layers[layer.name]
    // The drawing's own off/frozen state is the default; the user's choice
    // overrides it in either direction, so a layer the file froze can still
    // be turned back on from the layer panel.
    const visible = override?.visible ?? layer.visible
    if (!visible) continue

    resolved.push({
      index,
      name: layer.name,
      color: override?.color ?? CAD_UNDERLAY_DEFAULT_COLOR,
    })
  }

  return resolved
}

/** 0-100 opacity as the 0-1 fraction both SVG and three want. */
export function cadUnderlayOpacity(node: CadUnderlayNode): number {
  return Math.max(0, Math.min(100, node.opacity)) / 100
}
