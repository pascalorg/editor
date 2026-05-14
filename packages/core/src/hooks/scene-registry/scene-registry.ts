'use client'

import { useLayoutEffect } from 'react'
import type * as THREE from 'three'

const KNOWN_NODE_KINDS = [
  'site',
  'building',
  'ceiling',
  'column',
  'elevator',
  'level',
  'wall',
  'fence',
  'item',
  'slab',
  'spawn',
  'zone',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'scan',
  'guide',
  'window',
  'door',
] as const

type KnownNodeKind = (typeof KNOWN_NODE_KINDS)[number]
// Allow registry-registered (plugin) kinds while keeping autocomplete for built-ins.
type NodeKind = KnownNodeKind | (string & {})

type ByTypeShape = Record<KnownNodeKind, Set<string>> & Record<string, Set<string>>

const byTypeStore = new Map<string, Set<string>>(
  KNOWN_NODE_KINDS.map((k) => [k, new Set<string>()]),
)

// Auto-creates a Set the first time an unknown kind is accessed. This is what
// lets registry-registered (and future plugin-contributed) kinds participate
// in `byType` without being hardcoded here.
const byTypeProxy = new Proxy({} as ByTypeShape, {
  get(_target, key) {
    if (typeof key !== 'string') return undefined
    let set = byTypeStore.get(key)
    if (!set) {
      set = new Set<string>()
      byTypeStore.set(key, set)
    }
    return set
  },
  ownKeys() {
    return Array.from(byTypeStore.keys())
  },
  has(_target, key) {
    return typeof key === 'string' && byTypeStore.has(key)
  },
  getOwnPropertyDescriptor(_target, key) {
    if (typeof key !== 'string') return undefined
    const set = byTypeStore.get(key)
    if (!set) return undefined
    return { configurable: true, enumerable: true, value: set, writable: false }
  },
})

export const sceneRegistry = {
  // Master lookup: ID -> Object3D
  nodes: new Map<string, THREE.Object3D>(),

  // Categorized lookups: Kind -> Set of IDs.
  // Backed by a Proxy so registry-registered kinds get a Set on first touch,
  // while built-in kinds remain present from module init for fast paths.
  byType: byTypeProxy,

  /** Remove all entries. Call when unloading a scene to prevent stale 3D refs. */
  clear() {
    this.nodes.clear()
    for (const set of byTypeStore.values()) {
      set.clear()
    }
  },
}

export function useRegistry(id: string, type: NodeKind, ref: React.RefObject<THREE.Object3D>) {
  useLayoutEffect(() => {
    const obj = ref.current
    if (!obj) return

    // 1. Add to master map
    sceneRegistry.nodes.set(id, obj)

    // 2. Add to type-specific set — Proxy auto-creates on first access so the
    // assertion is safe; TS just can't see through the Proxy.
    sceneRegistry.byType[type]!.add(id)

    // 4. Cleanup when component unmounts
    return () => {
      sceneRegistry.nodes.delete(id)
      sceneRegistry.byType[type]!.delete(id)
    }
  }, [id, type, ref])
}
