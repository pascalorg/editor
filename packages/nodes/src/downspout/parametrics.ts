import type { ParametricDescriptor } from '@pascal-app/core'
import { DownspoutPositionEditor } from './inspector-editors'
import type { DownspoutNode } from './schema'

export const downspoutParametrics: ParametricDescriptor<DownspoutNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'length', kind: 'number', unit: 'm', min: 0.1, max: 8, step: 0.05 },
        { key: 'diameter', kind: 'number', unit: 'm', min: 0.02, max: 0.15, step: 0.005 },
        // Cross-section: follow the gutter profile, or force round / rect.
        {
          key: 'shape',
          kind: 'enum',
          options: ['auto', 'round', 'rect'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Hardware',
      fields: [
        // Wall straps clamping the run, like the gutter's hangers.
        {
          key: 'strapStyle',
          kind: 'enum',
          options: ['band', 'none'],
          display: 'segmented',
        },
        {
          key: 'strapSpacing',
          kind: 'number',
          unit: 'm',
          min: 0.3,
          max: 3,
          step: 0.1,
          visibleIf: (n) => (n.strapStyle ?? 'band') !== 'none',
        },
        // Bottom treatment: splash block, kickout only, or straight to grade.
        {
          key: 'terminal',
          kind: 'enum',
          options: ['splash', 'kickout', 'straight'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Placement',
      fields: [
        // Slide the outlet (and so this downspout) along the eave. Edits
        // the linked outlet's offset on the host gutter — the only way to
        // reposition a drop after placing it. Hidden when unlinked.
        {
          key: 'outletPosition',
          kind: 'custom',
          component: DownspoutPositionEditor,
          visibleIf: (n) => Boolean(n.outletId),
        },
        // How far proud of the wall the pipe sits. Crank it up if the
        // auto-routed run buries into the wall (the wall isn't where the
        // roof overhang implies); 0 puts the pipe surface on the wall
        // face; large values pull the run back out toward the eave.
        { key: 'standoff', kind: 'number', unit: 'm', min: 0, max: 0.6, step: 0.01 },
      ],
    },
  ],
}
