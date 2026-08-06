import type { NodeDefinition } from '@pascal-app/core/registry'
import { FormworkProjectSettingsNode } from './schema'

/**
 * The pour the whole scene is designed against, as a node.
 *
 * Registered without geometry, without a renderer and without parametrics: it
 * describes the project rather than a thing in it, so there is nothing to draw
 * and nothing to click. Its editor is the Formwork host panel, which reaches it
 * by scene lookup rather than by selection — an inspector would need the node to
 * be selectable, and a settings record that can be picked in the viewport is a
 * settings record that can be moved, duplicated and lost.
 *
 * `hidden` for the same reason: one per scene, created on first write by the
 * panel, parented to the site. Placing a second from a palette would give the
 * engine two answers to the same question, and `findFormworkSettingsNode` would
 * silently take the first.
 */
export const formworkProjectSettingsDefinition: NodeDefinition<typeof FormworkProjectSettingsNode> =
  {
    kind: 'formwork-settings',
    schemaVersion: 1,
    category: 'site',
    schema: FormworkProjectSettingsNode,

    defaults: () => ({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
    }),

    capabilities: {
      duplicable: false,
      deletable: true,
    },

    // No geometry and no system rebuilds this kind — see NodeDefinition.dirtyTracking.
    // The assemblies that *are* rebuilt when the settings change are dirtied by the
    // panel that writes them, since a design input lives outside the shutter it sizes.
    dirtyTracking: false,

    presentation: {
      label: 'Formwork settings',
      icon: { kind: 'iconify', name: 'lucide:sliders-horizontal' },
      hidden: true,
    },

    mcp: {
      description:
        'The formwork project settings — the pour every shutter in the scene is designed against: pressure code, measurement standard, concrete mix, placement (rate of rise, temperature, vibration), soffit loads, wall bracing, and the catalog parts the design chain resolves against. One per scene, parented to the site. Unstated fields fall back to the conservative shipped defaults, so writing a field is how a project claims the saving its actual pour earns.',
    },
  }
