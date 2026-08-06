import type { EditorHostPanel } from '@pascal-app/editor'

/**
 * The rail entry for the project's pour.
 *
 * A host panel rather than an inspector because the settings node is `hidden` and
 * not selectable — there is nothing in the viewport to click to reach it, and the
 * pour has to be reachable before the first shutter exists, since it is what the
 * first shutter will be designed to.
 *
 * No `pluginId`: `useHostPanels` shows an unowned panel unconditionally, and the
 * formwork settings are part of the product rather than an installable pack. The
 * component is loaded lazily so the catalog, the design chain and the panel's own
 * tree stay out of the first paint — the rail only needs the label and the icon
 * until someone opens it.
 */
export const formworkSettingsHostPanel: EditorHostPanel = {
  id: 'formwork-settings',
  label: 'Formwork',
  icon: { kind: 'iconify', name: 'lucide:sliders-horizontal' },
  component: () => import('./panel'),
  kinds: ['formwork-settings'],
  description:
    'The pour every shutter in the project is designed against — pressure code, concrete, placement, soffit loads, bracing and parts.',
}
