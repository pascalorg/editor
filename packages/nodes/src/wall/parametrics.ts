import type { ParametricDescriptor } from '@pascal-app/core'
import type { WallNode } from './schema'

/**
 * Inspector descriptor for wall.
 *
 * Wall has a few "structural" knobs (thickness, height, curve sagitta) and
 * a few "presentation" knobs (front / back / interior / exterior material
 * presets). Phase 4's `<ParametricInspector>` renders these directly.
 *
 * Endpoints (`start`, `end`) and host children are *not* exposed here —
 * those are edited via affordances (endpoint drag handles) and child
 * placement tools, not number inputs. `parametrics` is for "type a value
 * and see it apply"; spatial manipulation belongs to tools/affordances.
 */
export const wallParametrics: ParametricDescriptor<WallNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'thickness', kind: 'number', unit: 'm', min: 0.05, max: 0.6, step: 0.01 },
        { key: 'height', kind: 'number', unit: 'm', min: 1.5, max: 6, step: 0.05 },
        { key: 'curveOffset', kind: 'number', unit: 'm', min: -3, max: 3, step: 0.05 },
      ],
    },
  ],
}
