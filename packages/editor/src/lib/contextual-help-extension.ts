import type { NodeDefinition } from '@pascal-app/core'
import type { ContextualShortcutHint } from './contextual-help'

export const CONTEXTUAL_HELP_NODE_EXTENSION_KEY = 'pascal:editor/contextual-help'

export type ContextualHelpNodeExtension = {
  subscribe: (onChange: () => void) => () => void
  getHints: (nodeId: string) => ContextualShortcutHint[]
}

export function getContextualHelpNodeExtension(
  definition: NodeDefinition<any> | undefined,
): ContextualHelpNodeExtension | undefined {
  return definition?.extensions?.[CONTEXTUAL_HELP_NODE_EXTENSION_KEY] as
    | ContextualHelpNodeExtension
    | undefined
}
