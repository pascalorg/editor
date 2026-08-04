import type { ParametricDescriptor } from '@pascal-app/core'
import type { ConstructionJointNode } from '@pascal-app/core/schema'
import { JointScopeSummary, JointTreatmentsEditor } from './inspector-editors'

/**
 * Inspector descriptor for a construction joint. Hidden from the palette but
 * selectable, so it needs a panel.
 *
 * `kind` is editable because it is a design decision, not a derived value, and
 * it changes what the pour graph may do: an expansion joint is a hard partition
 * no monolithic pour may cross, while a construction joint is a soft one the
 * solver may move. Changing the kind therefore re-partitions the pours.
 */
export const constructionJointParametrics: ParametricDescriptor<ConstructionJointNode> = {
  groups: [
    {
      label: 'Joint',
      fields: [
        {
          key: 'kind',
          kind: 'enum',
          options: ['construction', 'expansion', 'contraction', 'isolation', 'sliding'],
        },
        { key: 'scope', kind: 'custom', component: JointScopeSummary },
      ],
    },
    {
      label: 'Treatments',
      fields: [{ key: 'treatments', kind: 'custom', component: JointTreatmentsEditor }],
    },
  ],
}
