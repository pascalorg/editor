import type { ParametricDescriptor } from '@pascal-app/core'
import {
  FormworkCoverageSummary,
  FormworkHostSummary,
  FormworkScopeSummary,
} from './inspector-editors'
import type { FormworkAssemblyNode } from './schema'

/**
 * Inspector descriptor for a formwork assembly. The node is hidden from the
 * palette (`presentation.hidden: true`) but IS selectable in the viewer once
 * attached, so it needs a panel — selecting it with none left users unable to
 * inspect or adjust the assembly.
 *
 * The split follows ownership. Scope, panel layout, and overrides belong to
 * the assembly and are editable here; the concrete's own construction state
 * (formworkType/tieSpacing/walerSpacing/scaffoldRequired, cast order, pour id)
 * belongs to the host element and is shown read-only via `FormworkHostSummary`
 * with a shortcut to the element's own panel.
 */
export const formworkAssemblyParametrics: ParametricDescriptor<FormworkAssemblyNode> = {
  groups: [
    {
      label: 'Scope',
      fields: [{ key: 'scope', kind: 'custom', component: FormworkScopeSummary }],
    },
    {
      label: 'Panels',
      fields: [
        { key: 'panelWidth', kind: 'number', unit: 'm', min: 0.3, max: 1.5, step: 0.05 },
        {
          key: 'fillerPosition',
          kind: 'enum',
          options: ['start', 'middle', 'end', 'symmetric'],
        },
      ],
    },
    {
      label: 'Host construction',
      fields: [{ key: 'hostSummary', kind: 'custom', component: FormworkHostSummary }],
    },
    {
      label: 'Coverage',
      fields: [{ key: 'coverage', kind: 'custom', component: FormworkCoverageSummary }],
    },
  ],
}
