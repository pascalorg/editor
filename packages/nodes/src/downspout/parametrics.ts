import type { ParametricDescriptor } from '@pascal-app/core'
import {
  DownspoutLengthModeEditor,
  DownspoutPositionEditor,
  DownspoutShapeEditor,
  DownspoutTerminalEditor,
} from './inspector-editors'
import type { DownspoutNode } from './schema'

export const downspoutParametrics: ParametricDescriptor<DownspoutNode> = {
  derive: (_next, patch) =>
    'length' in patch && !('lengthMode' in patch) ? { lengthMode: 'manual' } : {},
  groups: [
    { label: 'Style', fields: [{ key: 'shape', kind: 'custom', component: DownspoutShapeEditor }] },
    {
      label: 'Bottom treatment',
      fields: [{ key: 'terminal', kind: 'custom', component: DownspoutTerminalEditor }],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'lengthMode', kind: 'custom', component: DownspoutLengthModeEditor },
        { key: 'length', kind: 'number', unit: 'm', min: 0.1, step: 0.05 },
        { key: 'diameter', kind: 'number', unit: 'm', min: 0.02, step: 0.005 },
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
          step: 0.1,
          visibleIf: (n) => (n.strapStyle ?? 'band') !== 'none',
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
        { key: 'standoff', kind: 'number', unit: 'm', min: 0, step: 0.01 },
      ],
    },
  ],
}
