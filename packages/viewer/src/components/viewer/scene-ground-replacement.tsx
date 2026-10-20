'use client'

import { useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo } from 'react'
import type { Scene } from 'three'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

type GroundState = { owners: number }
const sceneGrounds = new WeakMap<Scene, StoreApi<GroundState>>()

function groundStore(scene: Scene): StoreApi<GroundState> {
  let store = sceneGrounds.get(scene)
  if (!store) {
    store = createStore<GroundState>(() => ({ owners: 0 }))
    sceneGrounds.set(scene, store)
  }
  return store
}

/** Whether modeled exterior ground replaces this scene's fallback horizon disc. */
export function useSceneGroundReplacement(): boolean {
  const scene = useThree((state) => state.scene)
  const store = useMemo(() => groundStore(scene), [scene])
  return useStore(store, (state) => state.owners > 0)
}

/**
 * The same claim from outside React (a map layer that hangs its own meshes on
 * the scene): returns the release. The last release restores the fallback.
 */
export function claimSceneGround(scene: Scene): () => void {
  const store = groundStore(scene)
  store.setState((state) => ({ owners: state.owners + 1 }))
  let released = false
  return () => {
    if (released) return
    released = true
    store.setState((state) => ({ owners: Math.max(0, state.owners - 1) }))
  }
}

/** Mount alongside replacement ground. The last release restores the fallback. */
export function SceneGroundReplacement() {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const store = useMemo(() => groundStore(scene), [scene])
  useLayoutEffect(() => {
    store.setState((state) => ({ owners: state.owners + 1 }))
    invalidate()
    return () => {
      store.setState((state) => ({ owners: state.owners - 1 }))
      invalidate()
    }
  }, [invalidate, store])
  return null
}
