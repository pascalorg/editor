'use client'

import { useLayoutEffect } from 'react'
import type * as THREE from 'three'

// `byType` is a Proxy-backed Map keyed by kind. Sets are created lazily on
// first access, so any kind (built-in or plugin-contributed) participates
// without needing a hardcoded seed list. The previous `KNOWN_NODE_KINDS`
// array was a pre-seed for autocomplete; with every kind now flowing
// through `nodeRegistry`, the seed is redundant.
//
// The type expresses that *any* string key returns a `Set<string>` — the
// Proxy auto-creates on first access so there's no `undefined` branch at
// runtime. Without this shape, `noUncheckedIndexedAccess` would force
// every caller to defend against an impossible undefined.
type ByTypeMap = { [kind: string]: Set<string> }
const byTypeStore = new Map<string, Set<string>>()

const byTypeProxy = new Proxy({} as ByTypeMap, {
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

  // Categorized lookups: Kind -> Set of IDs. Backed by a Proxy so any kind
  // gets a Set on first touch — no hardcoded list.
  byType: byTypeProxy,

  /** Remove all entries. Call when unloading a scene to prevent stale 3D refs. */
  clear() {
    this.nodes.clear()
    for (const set of byTypeStore.values()) {
      set.clear()
    }
  },
}

export function useRegistry(id: string, type: string, ref: React.RefObject<THREE.Object3D>) {
  useLayoutEffect(() => {
    const obj = ref.current
    if (!obj) return

    // 1. Add to master map
    sceneRegistry.nodes.set(id, obj)

    // 2. Add to type-specific set — Proxy auto-creates on first access.
    sceneRegistry.byType[type]?.add(id)

    // 3. Cleanup when component unmounts
    return () => {
      sceneRegistry.nodes.delete(id)
      sceneRegistry.byType[type]?.delete(id)
    }
  }, [id, type, ref])
}
