import {
  type AnyNode,
  type AnyNodeDefinition,
  type GridEvent,
  nodeRegistry,
} from '@pascal-app/core'
import type { InteractionScope } from './scope'

type RegisteredDraftingConfig = NonNullable<AnyNodeDefinition['drafting']>
type SurfaceHit = NonNullable<GridEvent['surfaceHit']>

export const DRAFTING_SURFACE_EXTENSION_KEY = 'pascal:editor/drafting-surface'

export type DraftingSurfaceExtension = {
  kind: SurfaceHit['kind']
  raycast?: 'underside'
  classifyFace?: (
    node: AnyNode | undefined,
    localNormal: readonly [number, number, number],
  ) => Pick<SurfaceHit, 'face' | 'side'> | null
}

export function registeredDraftingConfig(scope: InteractionScope): RegisteredDraftingConfig | null {
  if (scope.kind !== 'drafting') return null
  return nodeRegistry.get(scope.tool)?.drafting ?? null
}

export function registeredDraftingSurface(
  definition: AnyNodeDefinition,
): DraftingSurfaceExtension | null {
  return (
    (definition.extensions?.[DRAFTING_SURFACE_EXTENSION_KEY] as
      | DraftingSurfaceExtension
      | undefined) ?? null
  )
}
