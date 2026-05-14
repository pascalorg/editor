import type { ZodObject } from 'zod'
import type { AnyNodeDefinition, NodeRegistry, Plugin } from './types'

const HOST_API_VERSION = 1 as const

class NodeRegistryImpl implements NodeRegistry {
  private readonly defs = new Map<string, AnyNodeDefinition>()

  has(kind: string): boolean {
    return this.defs.has(kind)
  }

  get(kind: string): AnyNodeDefinition | undefined {
    return this.defs.get(kind)
  }

  entries(): IterableIterator<[string, AnyNodeDefinition]> {
    return this.defs.entries()
  }

  schemas(): ZodObject<any>[] {
    return Array.from(this.defs.values(), (d) => d.schema)
  }

  get size(): number {
    return this.defs.size
  }

  // Internal — exposed via registerNode below.
  _register(def: AnyNodeDefinition): void {
    if (this.defs.has(def.kind)) {
      throw new Error(`[registry] duplicate node kind: "${def.kind}" already registered`)
    }
    if (typeof def.kind !== 'string' || def.kind.length === 0) {
      throw new Error('[registry] NodeDefinition.kind must be a non-empty string')
    }
    if (typeof def.schemaVersion !== 'number' || def.schemaVersion < 1) {
      throw new Error(
        `[registry] NodeDefinition.schemaVersion must be a positive integer (kind: "${def.kind}")`,
      )
    }
    this.defs.set(def.kind, def)
  }

  // Test-only — clears the registry. Not exported from the package barrel.
  _reset(): void {
    this.defs.clear()
  }
}

export const nodeRegistry: NodeRegistry & {
  _register: (def: AnyNodeDefinition) => void
  _reset: () => void
} = new NodeRegistryImpl()

export function registerNode(def: AnyNodeDefinition): void {
  nodeRegistry._register(def)
}

export async function loadPlugin(plugin: Plugin): Promise<void> {
  if (plugin.apiVersion !== HOST_API_VERSION) {
    throw new Error(
      `[registry] plugin "${plugin.id}" requires apiVersion ${plugin.apiVersion}; host supports ${HOST_API_VERSION}`,
    )
  }
  for (const def of plugin.nodes ?? []) {
    registerNode(def)
  }
}
