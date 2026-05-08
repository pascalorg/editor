'use client'

import { type BaseNode, sceneRegistry, useLiveTransforms } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, type Material, type Mesh, type Object3D } from 'three'
import navigationVisualsStore from '../store/use-navigation-visuals'

const ITEM_DELETE_FADE_OUT_MS = 900
const ITEM_DELETE_VISIBILITY_EPSILON = 0.001

type RuntimeTransformRestore = {
  position: [number, number, number]
  rotationY: number
  visible: boolean
}

type FadeMaterial = Material & {
  depthWrite?: boolean
  needsUpdate?: boolean
  opacity?: number
  transparent?: boolean
  userData: Record<string, unknown> & {
    navigationDeleteBaseOpacity?: number
  }
}

type DeleteFadeEntry = {
  fadeMaterial: Material | Material[]
  originalMaterial: Material | Material[]
}

function isRenderableMesh(object: Object3D): object is Mesh {
  return Boolean((object as Mesh).isMesh && (object as Mesh).material)
}

function createFadeMaterial(material: Material): Material {
  const nextMaterial = material.clone() as FadeMaterial
  nextMaterial.userData = {
    ...nextMaterial.userData,
    navigationDeleteBaseOpacity: nextMaterial.opacity ?? 1,
  }
  nextMaterial.transparent = true
  nextMaterial.depthWrite = false
  nextMaterial.needsUpdate = true
  return nextMaterial
}

function createFadeMaterials(material: Material | Material[]): Material | Material[] {
  return Array.isArray(material)
    ? material.map((entry) => createFadeMaterial(entry))
    : createFadeMaterial(material)
}

function disposeMaterials(material: Material | Material[]) {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose())
    return
  }

  material.dispose()
}

function applyFadeOpacity(material: Material | Material[], fadeAlpha: number) {
  const apply = (entry: Material) => {
    const fadeMaterial = entry as FadeMaterial
    const baseOpacity =
      fadeMaterial.userData.navigationDeleteBaseOpacity ?? fadeMaterial.opacity ?? 1
    fadeMaterial.opacity = baseOpacity * fadeAlpha
    fadeMaterial.transparent = fadeAlpha < 0.999 || baseOpacity < 0.999
    fadeMaterial.depthWrite = fadeAlpha >= 0.999
    fadeMaterial.needsUpdate = true
  }

  if (Array.isArray(material)) {
    material.forEach(apply)
    return
  }

  apply(material)
}

function restoreFadeMaterials(entries: Map<Mesh, DeleteFadeEntry>) {
  for (const [mesh, entry] of entries.entries()) {
    if (mesh.material === entry.fadeMaterial) {
      mesh.material = entry.originalMaterial
    }
    disposeMaterials(entry.fadeMaterial)
  }
  entries.clear()
}

function syncDeleteFadeMaterials(
  object: Object3D,
  entries: Map<Mesh, DeleteFadeEntry>,
  fadeAlpha: number,
) {
  const activeMeshes = new Set<Mesh>()

  object.traverse((child) => {
    if (!isRenderableMesh(child)) {
      return
    }

    activeMeshes.add(child)
    let entry = entries.get(child)
    if (!entry) {
      entry = {
        fadeMaterial: createFadeMaterials(child.material),
        originalMaterial: child.material,
      }
      child.material = entry.fadeMaterial
      entries.set(child, entry)
    }

    applyFadeOpacity(entry.fadeMaterial, fadeAlpha)
  })

  for (const [mesh, entry] of entries.entries()) {
    if (activeMeshes.has(mesh)) {
      continue
    }

    if (mesh.material === entry.fadeMaterial) {
      mesh.material = entry.originalMaterial
    }
    disposeMaterials(entry.fadeMaterial)
    entries.delete(mesh)
  }
}

export function NavigationItemVisualSystem() {
  const restoresRef = useRef(new Map<string, RuntimeTransformRestore>())
  const deleteFadeEntriesRef = useRef(new Map<string, Map<Mesh, DeleteFadeEntry>>())

  useFrame(() => {
    const visualState = navigationVisualsStore.getState()
    const liveTransforms = useLiveTransforms.getState().transforms
    const trackedIds = new Set<string>()

    for (const id of Object.keys(visualState.nodeVisibilityOverrides)) {
      trackedIds.add(id)
    }
    for (const id of Object.keys(visualState.itemMoveVisualStates)) {
      trackedIds.add(id)
    }
    for (const id of Object.keys(visualState.itemDeleteActivations)) {
      trackedIds.add(id)
    }
    for (const id of Object.keys(visualState.taskPreviewNodeIds)) {
      trackedIds.add(id)
    }
    if (visualState.itemMovePreview) {
      trackedIds.add(visualState.itemMovePreview.id)
      trackedIds.add(visualState.itemMovePreview.sourceItemId)
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()

    for (const id of trackedIds) {
      const object = sceneRegistry.nodes.get(id)
      if (!object) {
        continue
      }

      if (!restoresRef.current.has(id)) {
        restoresRef.current.set(id, {
          position: [object.position.x, object.position.y, object.position.z],
          rotationY: object.rotation.y,
          visible: object.visible,
        })
      }

      const transform = liveTransforms.get(id)
      if (transform) {
        object.position.set(transform.position[0], transform.position[1], transform.position[2])
        object.rotation.y = transform.rotation
        object.updateMatrixWorld(true)
      }

      const activation = visualState.itemDeleteActivations[id as BaseNode['id']] ?? null
      const fadeStartedAtMs = activation?.fadeStartedAtMs ?? null
      if (fadeStartedAtMs !== null) {
        const fadeProgress = MathUtils.clamp(
          (now - fadeStartedAtMs) / ITEM_DELETE_FADE_OUT_MS,
          0,
          1,
        )
        const fadeAlpha = 1 - MathUtils.smootherstep(fadeProgress, 0, 1)
        let entries = deleteFadeEntriesRef.current.get(id)
        if (!entries) {
          entries = new Map<Mesh, DeleteFadeEntry>()
          deleteFadeEntriesRef.current.set(id, entries)
        }
        syncDeleteFadeMaterials(object, entries, fadeAlpha)
        object.visible = fadeAlpha > ITEM_DELETE_VISIBILITY_EPSILON
        continue
      }

      const fadeEntries = deleteFadeEntriesRef.current.get(id)
      if (fadeEntries) {
        restoreFadeMaterials(fadeEntries)
        deleteFadeEntriesRef.current.delete(id)
      }

      const visibilityOverride = visualState.nodeVisibilityOverrides[id as BaseNode['id']]
      if (visibilityOverride !== undefined) {
        object.visible = visibilityOverride
      } else {
        object.visible = restoresRef.current.get(id)?.visible ?? object.visible
      }
    }

    for (const [id, restore] of restoresRef.current.entries()) {
      if (trackedIds.has(id)) {
        continue
      }

      const object = sceneRegistry.nodes.get(id)
      if (object) {
        object.position.set(restore.position[0], restore.position[1], restore.position[2])
        object.rotation.y = restore.rotationY
        object.visible = restore.visible
        object.updateMatrixWorld(true)
      }

      const fadeEntries = deleteFadeEntriesRef.current.get(id)
      if (fadeEntries) {
        restoreFadeMaterials(fadeEntries)
        deleteFadeEntriesRef.current.delete(id)
      }
      restoresRef.current.delete(id)
    }
  })

  useEffect(
    () => () => {
      for (const [id, restore] of restoresRef.current.entries()) {
        const object = sceneRegistry.nodes.get(id)
        if (!object) {
          continue
        }

        object.position.set(restore.position[0], restore.position[1], restore.position[2])
        object.rotation.y = restore.rotationY
        object.visible = restore.visible
        object.updateMatrixWorld(true)
      }

      for (const entries of deleteFadeEntriesRef.current.values()) {
        restoreFadeMaterials(entries)
      }
      restoresRef.current.clear()
      deleteFadeEntriesRef.current.clear()
    },
    [],
  )

  return null
}
