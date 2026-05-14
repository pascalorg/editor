import type { Plugin } from '@pascal-app/core'

/**
 * Built-in plugin bundling every node kind shipped with the Pascal editor.
 *
 * Apps load this once at bootstrap (`loadPlugin(builtinPlugin)`) before
 * mounting the viewer. New built-in nodes are added by creating a folder
 * here under `src/<kind>/` and appending its `NodeDefinition` to `nodes`.
 *
 * External plugins follow the exact same shape — same `Plugin` type, same
 * `loadPlugin` call path. This is intentional: the API is stress-tested
 * by built-ins before any third-party plugin lands.
 */
export const builtinPlugin: Plugin = {
  id: 'pascal:core',
  apiVersion: 1,
  nodes: [],
}
