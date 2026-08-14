import type { ContextualHelpNodeExtension, ContextualShortcutHint } from '@pascal-app/editor'
import useCustomMeshEditSession from './edit-session'
import type { CustomMeshComponentMode } from './selection-model'

const MODE_LABELS: Record<CustomMeshComponentMode, string> = {
  vertex: 'Vertex',
  edge: 'Edge',
  face: 'Face',
}

const MODE_OPERATIONS: Record<CustomMeshComponentMode, ContextualShortcutHint[]> = {
  vertex: [{ keys: ['M'], label: 'Merge selected vertices' }],
  edge: [
    { keys: ['Cmd/Ctrl', 'B'], label: 'Bevel selected edges' },
    { keys: ['D'], label: 'Dissolve selected edges' },
  ],
  face: [
    { keys: ['E'], label: 'Extrude selected faces' },
    { keys: ['I'], label: 'Inset selected faces' },
  ],
}

const HINTS_BY_MODE = Object.fromEntries(
  (Object.keys(MODE_LABELS) as CustomMeshComponentMode[]).map((mode) => [
    mode,
    [
      {
        keys: [['1', '2', '3']],
        label: `${MODE_LABELS[mode]} mode`,
        subtitle: 'Vertex / Edge / Face',
      },
      { keys: [['G', 'R', 'S']], label: 'Move / Rotate / Scale selection' },
      ...MODE_OPERATIONS[mode],
      { keys: ['Tab'], label: 'Exit mesh editing' },
    ],
  ]),
) as Record<CustomMeshComponentMode, ContextualShortcutHint[]>

const EMPTY_HINTS: ContextualShortcutHint[] = []

export const customMeshContextualHelp: ContextualHelpNodeExtension = {
  subscribe: useCustomMeshEditSession.subscribe,
  getHints: (nodeId) => {
    const session = useCustomMeshEditSession.getState()
    return session.nodeId === nodeId ? HINTS_BY_MODE[session.selection.mode] : EMPTY_HINTS
  },
}
