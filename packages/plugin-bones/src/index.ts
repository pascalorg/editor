import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { BONES_ICON } from './art'
import { lumberDefinition } from './definition'
import { deviceDefinition } from './device/definition'
import { framingDefinition } from './framing/definition'
import { serviceDefinition } from './service/definition'

/**
 * Structural mirror of the host's `InspectorExtension` (editor PR #667).
 * TODO(editor#667): import the type from @pascal-app/core once a published
 * core ships it — this package compiles against the published core, and the
 * host reads the manifest duck-typed via `loadPlugin` either way.
 */
type InspectorExtensionLike = {
  id: string
  pluginId: string
  kinds: string[]
  icon: { kind: 'url'; src: string }
  title: string
  // biome-ignore lint/suspicious/noExplicitAny: prop-agnostic loader — the
  // host passes `{ node }` to the resolved component (see the host type).
  component: () => Promise<{ default: React.ComponentType<any> }>
}

type PluginHostPanel = {
  id: string
  label: string
  icon: { kind: 'url'; src: string }
  component: () => Promise<{ default: React.ComponentType }>
  pluginId: string
  description: string
  creator: {
    name: string
    url?: string
  }
  pluginUrl: string
  defaultInstalled: boolean
}

/**
 * The Bones plugin manifest — the entire public surface of this package.
 * A host loads it through the same `loadPlugin` path the built-ins use:
 * one node kind today (`bones:lumber`) and one left-rail panel (`Bones`).
 * Framing inference kinds (`bones:framing`, …) land next — see SPEC.md.
 */
/**
 * Inspector-card extensions — sections Bones adds to the host's floating
 * node inspector. One today: the wall card grows an "Engineering" section
 * (bones icon on the folded header jumps straight to it) with the same
 * per-wall readout + framed/CMU/skip override as the sidebar card.
 */
export const bonesInspectorExtensions: InspectorExtensionLike[] = [
  {
    id: 'pascal:bones:wall-engineering',
    pluginId: 'pascal:bones',
    kinds: ['wall'],
    icon: { kind: 'url', src: BONES_ICON },
    title: 'Engineering',
    component: () => import('./inspector/wall-engineering'),
  },
]

export const bonesPlugin: Plugin & { inspectorExtensions: InspectorExtensionLike[] } = {
  id: 'pascal:bones',
  apiVersion: 1,
  nodes: [
    framingDefinition as unknown as AnyNodeDefinition,
    lumberDefinition as unknown as AnyNodeDefinition,
    serviceDefinition as unknown as AnyNodeDefinition,
    deviceDefinition as unknown as AnyNodeDefinition,
  ],
  inspectorExtensions: bonesInspectorExtensions,
}

export const bonesHostPanel: PluginHostPanel = {
  id: 'pascal:bones:panel',
  label: 'Bones',
  icon: { kind: 'url', src: BONES_ICON },
  component: () => import('./panel'),
  pluginId: bonesPlugin.id,
  description:
    'Alpha access — new and evolving fast. The engineering X-ray for Pascal: see through the finishes to the actual construction — wall framing, floors, roof, foundation, and electrical, derived from your model and sized to your jurisdiction.',
  creator: {
    name: 'Julien Brissonneau',
    url: 'https://github.com/Snoopy147',
  },
  pluginUrl: 'https://github.com/pascalorg/plugin-bones',
  defaultInstalled: true,
}

export { lumberDefinition } from './definition'
export { LumberNode } from './schema'
export { LUMBER_CROSS_SECTIONS, LUMBER_SIZES, lumberBoxDims } from './lumber'
export { serviceDefinition } from './service/definition'
export { SERVICE_TYPES, ServiceNode } from './service/schema'
export { deviceDefinition } from './device/definition'
export { DEVICE_KINDS, DeviceNode } from './device/schema'
