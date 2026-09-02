import type { NodeDefinition, ParametricDescriptor } from '@pascal-app/core'
import { jurisdictionOptions } from '../jurisdiction/profiles'
import { FramingNode } from './schema'

type FramingDefinition = NodeDefinition<typeof FramingNode> & Record<string, unknown>

const jurisdictionEnum = ['AUTO', ...jurisdictionOptions().map((o) => o.code)]

const framingParametrics: ParametricDescriptor<FramingNode> = {
  groups: [
    {
      label: 'Code',
      fields: [
        { key: 'jurisdiction', kind: 'enum', options: jurisdictionEnum },
        { key: 'detail', kind: 'enum', options: ['200', '300', '400'], display: 'segmented' },
        { key: 'studSpacingIn', kind: 'enum', options: [12, 16, 24] as unknown as string[], display: 'segmented' },
      ],
    },
    {
      label: 'View',
      // CONFIG-KNOB semantics, accepted deliberately (skeptic advisory
      // 2026-08-21): parametric descriptors are declarative, so this field
      // surfaces the RAW stored value — a legacy (pre-viewMode) node shows
      // no selection here until first written, and an inspector/MCP write
      // sets the mode WITHOUT the wall-mode side effect (walls stay where
      // they are). That's the same contract as every other raw knob on this
      // node; the Bones panel's Normal/X-ray/Basement control is the UX
      // path and owns the wall-mode contract (src/activation.ts, checklist
      // A5). The renderer resolves legacy nodes via effectiveViewMode
      // regardless of what this row displays.
      fields: [
        { key: 'viewMode', kind: 'enum', options: ['off', 'xray', 'basement'], display: 'segmented' },
      ],
    },
    {
      label: 'Systems',
      fields: [
        { key: 'showWalls', kind: 'boolean' },
        { key: 'showFloor', kind: 'boolean' },
        { key: 'showRoof', kind: 'boolean' },
        { key: 'showFoundation', kind: 'boolean' },
        { key: 'showElectrical', kind: 'boolean' },
        { key: 'showPlumbing', kind: 'boolean' },
        { key: 'showHvac', kind: 'boolean' },
      ],
    },
  ],
}

/**
 * The `bones:framing` config node — the persisted anchor for the derived
 * X-ray. Not placeable from a tool: the Bones panel creates exactly one per
 * level. Invisible in plan, unselectable in 3D (the panel is its UI); it
 * simply mounts the renderer that derives and instances every member.
 */
export const framingDefinition: FramingDefinition = {
  kind: 'bones:framing',
  schemaVersion: 1,
  schema: FramingNode,
  category: 'furnish',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    jurisdiction: 'AUTO',
    detail: '400',
    studSpacingIn: 16,
    showWalls: true,
    showFloor: true,
    showRoof: true,
    showFoundation: true,
    showElectrical: true,
    showPlumbing: true,
    showHvac: true,
    movableOutlets: true,
    xray: 1,
    seeThrough: true,
    viewMode: 'xray',
    servicesSeeded: false,
    wallOverrides: {},
  }),

  capabilities: {
    deletable: true,
  },

  parametrics: framingParametrics,

  renderer: { kind: 'parametric', module: () => import('./renderer') },

  presentation: {
    label: 'X-Ray',
    description:
      'The Bones engineering X-ray for this level — derives framing, foundation, and systems from the model.',
    icon: { kind: 'iconify', name: 'lucide:scan-line' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'Bones X-ray config node (one per level). Derives the construction skeleton — wall framing (studs/plates/headers), floor joists, roof rafters, foundation, electrical layout — from the level architecture and renders it in 3D. Settings: jurisdiction (US state code/INTL/AUTO), detail (200 generic / 300 code-sized), studSpacingIn (16/24/12), viewMode (off = finished house / xray = engineering X-ray / basement = under-the-house view), per-system show* booleans (all default on), per-wall construction overrides (framed/cmu/skip).',
  },
}
