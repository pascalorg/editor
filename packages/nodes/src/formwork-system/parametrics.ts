import type { ParametricDescriptor } from '@pascal-app/core'
import { FormworkHostSummary } from './inspector-editors'
import type { FormworkSystemNode } from './schema'

/**
 * Inspector descriptor for formwork-system. The node is normally hidden
 * from the palette (`presentation.hidden: true`) but IS selectable in
 * the viewer once attached to a wall — selecting it with no panel at
 * all left users unable to inspect/adjust the assembly (item 9 in the
 * reported gaps). `panelWidth` is the only field the node itself owns;
 * the rest of the construction state (formworkType/tieSpacing/
 * walerSpacing/scaffoldRequired) lives on the host wall and is
 * surfaced read-only via `FormworkHostSummary`, with a shortcut to jump
 * to the wall's own panel to edit it.
 */
export const formworkSystemParametrics: ParametricDescriptor<FormworkSystemNode> = {
  groups: [
    {
      label: 'Panels',
      fields: [{ key: 'panelWidth', kind: 'number', unit: 'm', min: 0.3, max: 1.5, step: 0.05 }],
    },
    {
      label: 'Host wall construction',
      fields: [{ key: 'hostSummary', kind: 'custom', component: FormworkHostSummary }],
    },
  ],
}
