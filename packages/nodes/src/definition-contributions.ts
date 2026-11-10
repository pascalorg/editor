import type { AnyNodeDefinition, NodeDefinition } from '@pascal-app/core'

type NodeSchema = AnyNodeDefinition['schema']

type EditField =
  | 'extensions'
  | 'facingIndicator'
  | 'drafting'
  | 'connectedMove'
  | 'parametrics'
  | 'placementNotice'
  | 'quickActions'
  | 'quickActionNodeScope'
  | 'tool'
  | 'affordanceTools'
  | 'affordances'
  | 'toolHints'
  | 'affordanceHints'
  | 'toolOptions'
  | 'snapProfile'
  | 'snapDraftDirectional'
  | 'preview'
  | 'keyboardActions'
  | 'handles'
  | 'computeFloorplanLevelData'
  | 'floorplan'
  | 'floorplanDependencies'
  | 'floorplanScope'
  | 'floorplanDependsOnSiblings'
  | 'floorplanAffectedIds'
  | 'floorplanSiblingOverrides'
  | 'floorplanAffordances'
  | 'floorplanMoveTarget'

type Capabilities<S extends NodeSchema> = NonNullable<NodeDefinition<S>['capabilities']>

export type NodeRenderDefinition<S extends NodeSchema> = Omit<
  NodeDefinition<S>,
  EditField | 'capabilities'
> & { capabilities: Omit<Capabilities<S>, 'paint'> }

// The only render adapters are editor-state renderer wrappers and preview ceiling cuts.
export type NodeEditContribution<S extends NodeSchema> = Partial<
  Pick<NodeDefinition<S>, EditField | 'renderer'>
> & { capabilities?: Pick<Capabilities<S>, 'paint' | 'ceilingCut'> }

/** Top-level replacement; capabilities merge once. Arrays and functions are replaced. */
export function composeNodeDefinition<S extends NodeSchema>(
  render: NodeRenderDefinition<S>,
  edit: NodeEditContribution<S>,
): NodeDefinition<S> {
  return {
    ...render,
    ...edit,
    capabilities: { ...render.capabilities, ...edit.capabilities },
  }
}
