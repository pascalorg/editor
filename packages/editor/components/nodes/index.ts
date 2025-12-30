/**
 * Node Registry Initialization
 *
 * Import from @pascal/core to register all node components,
 * then import editor-specific components that have UI dependencies.
 */

// Import core node components (registers them with the component registry)
import '@pascal/core/components/nodes'

// Import editor-specific components that depend on UI
import './level/level-node'

// Re-export all renderers from core
export * from '@pascal/core/components/nodes'
