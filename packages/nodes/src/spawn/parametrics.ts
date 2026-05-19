import type { ParametricDescriptor } from '@pascal-app/core'
import type { SpawnNode } from './schema'

/**
 * Inspector descriptor for spawn. Tiny — spawn has only position + rotation,
 * and Phase 4 will auto-render a 3-component vec3 + a yaw scalar from this.
 */
export const spawnParametrics: ParametricDescriptor<SpawnNode> = {
  groups: [
    {
      label: 'Transform',
      fields: [
        { key: 'position', kind: 'vec3' },
        // rotation on spawn is a scalar yaw (not vec3). Phase 4 will support a
        // 'scalar-angle' kind; for now we expose it as a number with unit.
        { key: 'rotation', kind: 'number', unit: 'rad', step: Math.PI / 12 },
      ],
    },
  ],
  // Stage E — kind-owned panel. Spawn has a derived position +
  // rotation-degrees binding (legacy SpawnPanel converts radians to
  // degrees in the slider and uses `useLiveTransforms` for smooth yaw
  // dragging). Auto-inspector doesn't express the deg ↔ rad
  // transform or the live-yaw preview yet — kept as a custom panel.
  customPanel: () => import('./panel'),
}
