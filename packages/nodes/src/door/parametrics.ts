import type { ParametricDescriptor } from '@pascal-app/core'
import type { DoorNode } from './schema'

/**
 * Stage E inspector for door. Mounts the kind-owned panel
 * (`panel.tsx`) via `customPanel` — door has 29+ controls (segments,
 * hardware, hinges, panic bar, opening shape, etc.) that can't fit
 * into the generic auto-inspector. The `groups` entries stay populated
 * so the registry still considers door "parametric" (for tooling that
 * lists kinds with editable schema).
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
  customPanel: () => import('./panel'),
}
