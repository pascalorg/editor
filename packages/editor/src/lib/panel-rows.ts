import type { AnyNode, AnyNodeDefinition, AnyNodeId } from '@pascal-app/core'

export type PanelIcon = { color?: string; src?: string }

export type PanelAction = {
  icon?: PanelIcon
  disabled?: boolean
  id: string
  label: string
  onSelect?: () => void
}

export type PanelRow = { section?: string } & (
  | {
      id: string
      kind: 'action'
      icon?: PanelIcon
      label: string
      onSelect?: () => void
      disabled?: boolean
    }
  | {
      actions: PanelAction[]
      id: string
      kind: 'actions'
    }
  | {
      id: string
      kind: 'choice'
      label: string
      onSelect?: () => void
      value: string
    }
  | {
      getValue: () => string
      id: string
      kind: 'subscribed-choice'
      label: string
      onSelect?: () => void
      subscribe: (listener: () => void) => () => void
    }
  | {
      id: string
      kind: 'cycle'
      label: string
      next: () => void
      previous: () => void
      value: string
    }
  | {
      id: string
      kind: 'stepper'
      label: string
      max: number
      min: number
      onChange: (value: number) => void
      step: number
      unit?: string
      value: number
    }
)

export const PANEL_MODEL_EXTENSION = 'pascal:editor/panel-model'

/**
 * A control the multi-selection inspector renders for every selected node of
 * a kind at once (derived settings the raw parametrics can't express). `value`
 * null means the selection is mixed: no option shows as active.
 */
export type MultiPanelControl = {
  id: string
  kind: 'segmented'
  /** The parametrics group title the control sits in. */
  section: string
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  value: string | null
  /** Applies to every selected node in one undo step. */
  onChange: (value: string) => void
}

export type NodePanelModel<N extends AnyNode = AnyNode> = {
  rows: (context: {
    node: N
    nodes: Record<AnyNodeId, AnyNode>
    update: (patch: Partial<N>) => void
  }) => PanelRow[]
  multiControls?: (context: {
    selection: N[]
    nodes: Record<AnyNodeId, AnyNode>
  }) => MultiPanelControl[]
}

export function getNodePanelModel(definition: AnyNodeDefinition | undefined) {
  return definition?.extensions?.[PANEL_MODEL_EXTENSION] as NodePanelModel | undefined
}
