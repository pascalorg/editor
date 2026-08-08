import type { EditorHostPanel } from '@pascal-app/editor'

/**
 * The rail entry for the job's takeoff.
 *
 * A host panel rather than an inspector because its subject is a scope — the whole
 * project, or a level — and neither is a node anybody can select. The settings panel
 * sits beside it for the same reason: one describes the pour every shutter is
 * designed to, the other what that design adds up to.
 *
 * Lazy, so the aggregation over every element in the scene is not in the first paint.
 */
export const formworkTakeoffHostPanel: EditorHostPanel = {
  id: 'formwork-takeoff',
  label: 'Takeoff',
  icon: { kind: 'iconify', name: 'lucide:clipboard-list' },
  component: () => import('./takeoff-panel'),
  description:
    'The formwork the job needs, as one bill across every shuttered element in scope — project or level — with a CSV to order from.',
}
