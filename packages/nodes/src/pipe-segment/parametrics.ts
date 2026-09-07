import type { ParametricDescriptor } from '@pascal-app/core'
import { fittingDeletionPlansForRun } from '../shared/fitting-deletion-cleanup'
import type { PipeSegmentNode } from './schema'

export const pipeSegmentParametrics: ParametricDescriptor<PipeSegmentNode> = {
  onDelete: (pipe, nodes, _pendingDeleteIds, requestedDeleteIds) =>
    fittingDeletionPlansForRun(pipe, nodes, requestedDeleteIds, true).flatMap(
      (plan) => plan.updates,
    ),
  onDeleteCascade: (pipe, nodes, _pendingDeleteIds, requestedDeleteIds) =>
    fittingDeletionPlansForRun(pipe, nodes, requestedDeleteIds, false).flatMap((plan) =>
      plan.deleteFitting ? [plan.fittingId, ...plan.cascadeDeleteIds] : [],
    ),
  groups: [
    {
      label: 'Drainage',
      fields: [
        {
          key: 'system',
          kind: 'enum',
          options: ['waste', 'vent'],
          display: 'segmented',
        },
        {
          key: 'diameter',
          kind: 'number',
          unit: 'in',
          min: 1.25,
          max: 6,
          step: 0.25,
        },
      ],
    },
    {
      label: 'Construction',
      fields: [
        {
          key: 'pipeMaterial',
          kind: 'enum',
          options: ['pvc', 'abs', 'cast-iron'],
        },
      ],
    },
  ],
}
