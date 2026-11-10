import type { Plugin } from '@pascal-app/core'
import { renderDefinitions } from './builtin-definitions'
import { builtinPluginMetadata } from './builtin-plugin-metadata'

/** Load exactly one built-in plugin: render for viewers, builtinPlugin for editors. */
export const renderPlugin: Plugin = { ...builtinPluginMetadata, nodes: renderDefinitions }
