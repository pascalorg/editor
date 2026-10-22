import type { ParametricDescriptor } from '@pascal-app/core'
import { boxVentDimensionPatch } from './dimensions'
import type { BoxVentNode } from './schema'

/**
 * Inspector descriptor for the box vent. Position / rotation are
 * surfaced by the framework via `capabilities.movable` + the bespoke
 * move tool — not in this descriptor.
 */
export const boxVentParametrics: ParametricDescriptor<BoxVentNode> = {
  // Move + Duplicate need the kind-owned ghost-preview flow (see
  // `./move-tool.tsx`), so the panel hosts those actions itself instead
  // of relying on the generic inspector — which only knows about Move
  // for `capabilities.movable` kinds and routes those through the
  // grid-plane mover.
  derive: boxVentDimensionPatch,
  customPanel: () => import('./panel'),
  groups: [
    {
      label: 'Style',
      fields: [
        {
          key: 'style',
          kind: 'enum',
          options: ['box', 'cap', 'dome'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.15, max: 1000, step: 0.01 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.15, max: 1000, step: 0.01 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.05, max: 1000, step: 0.01 },
        {
          key: 'hoodOverhang',
          kind: 'number',
          unit: 'm',
          min: 0,
          step: 0.005,
          visibleIf: (n) => n.style !== 'box',
        },
      ],
    },
    {
      label: 'Installation',
      fields: [
        {
          key: 'flashingWidth',
          label: 'Flashing extension',
          kind: 'number',
          unit: 'm',
          min: 0,
          step: 0.01,
        },
      ],
    },
    {
      label: 'Box details',
      fields: [
        {
          key: 'baseInset',
          kind: 'number',
          unit: 'm',
          min: 0,
          visibleIf: (n) => n.style === 'box',
        },
        {
          key: 'baseHeight',
          kind: 'number',
          unit: 'm',
          min: 0.005,
          visibleIf: (n) => n.style === 'box',
        },
        {
          key: 'cornerBevel',
          kind: 'number',
          unit: 'm',
          min: 0,
          visibleIf: (n) => n.style === 'box',
        },
      ],
    },
    {
      label: 'Cap details',
      fields: [
        {
          key: 'capHeight',
          kind: 'number',
          unit: 'm',
          min: 0.005,
          visibleIf: (n) => n.style === 'cap',
        },
        {
          key: 'capGap',
          label: 'Vent opening',
          kind: 'number',
          unit: 'm',
          min: 0,
          visibleIf: (n) => n.style === 'cap',
        },
        { key: 'topTaper', kind: 'number', min: 0, max: 1, visibleIf: (n) => n.style === 'cap' },
      ],
    },
    {
      label: 'Dome details',
      fields: [
        {
          key: 'domeCurvature',
          kind: 'number',
          min: 0.3,
          max: 1.5,
          visibleIf: (n) => n.style === 'dome',
        },
      ],
    },
  ],
}
