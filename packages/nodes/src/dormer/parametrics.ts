import type { ParametricDescriptor } from '@pascal-app/core'
import { dormerSupportsArch } from './geometry'
import type { DormerNode } from './schema'

export const dormerParametrics: ParametricDescriptor<DormerNode> = {
  // Bespoke tabbed UI (Dormer / Window / Frame / Grid / Sill) — same
  // pattern as chimney. `groups` stays for the MCP path / fallback
  // consumer, but the inspector mounts the custom panel.
  customPanel: () => import('./panel'),
  groups: [
    {
      label: 'Dormer',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.5, max: 4, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.5, max: 5, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0, max: 5, step: 0.05 },
      ],
    },
    {
      label: 'Dormer roof',
      fields: [
        {
          key: 'roofType',
          kind: 'enum',
          options: ['hip', 'gable', 'shed', 'gambrel', 'dutch', 'mansard', 'flat'],
          display: 'select',
        },
        { key: 'roofHeight', kind: 'number', unit: 'm', min: 0, max: 2, step: 0.05 },
      ],
    },
    {
      label: 'Hung wall',
      fields: [{ key: 'wallSkirtHeight', kind: 'number', unit: 'm', min: 0.2, max: 6, step: 0.05 }],
    },
    {
      label: 'Window opening',
      fields: [
        { key: 'windowWidth', kind: 'number', unit: 'm', min: 0.2, max: 3, step: 0.05 },
        { key: 'windowHeight', kind: 'number', unit: 'm', min: 0.2, max: 6, step: 0.05 },
        { key: 'windowOffsetX', kind: 'number', unit: 'm', min: -1, max: 1, step: 0.05 },
        { key: 'windowOffsetY', kind: 'number', unit: 'm', min: 0, max: 2, step: 0.05 },
      ],
    },
    {
      label: 'Window grid',
      fields: [
        { key: 'windowColumns', kind: 'number', min: 1, max: 8, step: 1 },
        { key: 'windowRows', kind: 'number', min: 1, max: 8, step: 1 },
      ],
    },
    {
      label: 'Window frame',
      fields: [
        {
          key: 'windowFrameThickness',
          kind: 'number',
          unit: 'm',
          min: 0.01,
          max: 0.15,
          step: 0.005,
        },
        { key: 'windowFrameDepth', kind: 'number', unit: 'm', min: 0.02, max: 0.15, step: 0.005 },
        {
          key: 'windowDividerThickness',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.06,
          step: 0.002,
        },
        {
          key: 'windowShape',
          kind: 'enum',
          options: ['rectangle', 'rounded', 'arch'],
          display: 'segmented',
        },
        {
          key: 'windowArchHeight',
          kind: 'number',
          unit: 'm',
          min: 0.1,
          max: 1,
          step: 0.05,
          visibleIf: dormerSupportsArch,
        },
      ],
    },
    {
      label: 'Sill',
      fields: [
        { key: 'windowSill', kind: 'boolean' },
        {
          key: 'windowSillDepth',
          kind: 'number',
          unit: 'm',
          min: 0.02,
          max: 0.3,
          step: 0.01,
          visibleIf: (n) => n.windowSill === true,
        },
        {
          key: 'windowSillThickness',
          kind: 'number',
          unit: 'm',
          min: 0.01,
          max: 0.1,
          step: 0.005,
          visibleIf: (n) => n.windowSill === true,
        },
      ],
    },
  ],
}
