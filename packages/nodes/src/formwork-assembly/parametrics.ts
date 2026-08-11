import type { ParametricDescriptor } from '@pascal-app/core'
import {
  FormworkBomSummary,
  FormworkCoverageSummary,
  FormworkDesignSummary,
  FormworkHostSummary,
  FormworkPartsSummary,
  FormworkPourCommitment,
  FormworkPourDate,
  FormworkScopeSummary,
  FormworkSelectedPart,
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
    // The date is the assembly's own and belongs beside its scope, because the two
    // answer the same question: which pour this is, and when it happens. The lead
    // times it is measured against are project settings, not this shutter's.
    {
      label: 'Programme',
      // The commitment immediately under the date, because it is a statement *about* that
      // date and unreadable apart from it.
      fields: [
        { key: 'pourAt', kind: 'custom', component: FormworkPourDate },
        { key: 'committedPourAt', kind: 'custom', component: FormworkPourCommitment },
      ],
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
    // Design before coverage: the design says whether the shutter stands up, and
    // coverage says how much of it there is. A spacing over capacity is a stop.
    {
      label: 'Design',
      fields: [{ key: 'design', kind: 'custom', component: FormworkDesignSummary }],
    },
    {
      label: 'Coverage',
      fields: [{ key: 'coverage', kind: 'custom', component: FormworkCoverageSummary }],
    },
    // The selected part before the list it came from, because the click that fills it
    // happens in the viewport: a person clicks a panel on the shutter and looks at the
    // panel, and having to scroll past every other panel to reach it is the wrong way
    // round. The list is the index; this is the page it opens to.
    {
      label: 'Selected part',
      fields: [{ key: 'selectedPart', kind: 'custom', component: FormworkSelectedPart }],
    },
    {
      label: 'Parts',
      fields: [{ key: 'parts', kind: 'custom', component: FormworkPartsSummary }],
    },
    {
      label: 'Bill of materials',
      fields: [{ key: 'bom', kind: 'custom', component: FormworkBomSummary }],
    },
  ],
}
