import type { ParametricDescriptor } from '@pascal-app/core'
import type { DoorNode } from './schema'

/**
 * Minimal inspector descriptor for door. The legacy `<DoorPanel>` has
 * 29 SliderControls covering segments, hardware, hinges, panic bar,
 * opening shape, etc. — too elaborate for the auto-inspector at Stage A.
 * Legacy panel keeps rendering via the hardcoded `case 'door':` in
 * panel-manager.tsx. This descriptor only exposes the simple dimension
 * fields so the registry knows door has parametric data. Phase 5 Stage E
 * (drop legacy panel) will extend this — likely via
 * `parametrics.customPanel?` since door has too much non-numeric UI
 * (segmented controls, presets) to fit the generic auto-UI.
 */
export const doorParametrics: ParametricDescriptor<DoorNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.5, max: 6, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 1.0, max: 4, step: 0.05 },
      ],
    },
    {
      label: 'Frame',
      fields: [
        { key: 'frameThickness', kind: 'number', unit: 'm', min: 0.01, max: 0.2, step: 0.005 },
        { key: 'frameDepth', kind: 'number', unit: 'm', min: 0.01, max: 0.3, step: 0.005 },
      ],
    },
  ],
}
