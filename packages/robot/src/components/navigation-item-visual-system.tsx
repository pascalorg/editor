'use client'

import {
  type AnyNodeId,
  type BaseNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  Color,
  MathUtils,
  type Material,
  type Mesh,
  type Object3D,
} from 'three'
import type { ItemMoveVisualState } from '../lib/item-move-visuals'
import navigationVisualsStore from '../store/use-navigation-visuals'

const ITEM_DELETE_FADE_OUT_MS = 900
const ITEM_DELETE_VISIBILITY_EPSILON = 0.001

type RuntimeTransformRestore = {
  position: [number, number, number]
  rotationY: number
  visible: boolean
}

function getSceneTransformRestore(id: string, fallback: RuntimeTransformRestore) {
  const node = useScene.getState().nodes[id as AnyNodeId]
  if (!node || !('position' in node) || !Array.isArray(node.position)) {
    return fallback
  }

  const rotation = 'rotation' in node && Array.isArray(node.rotation) ? node.rotation : null
  return {
    position: [...node.position] as [number, number, number],
    rotationY: rotation?.[1] ?? fallback.rotationY,
    visible: 'visible' in node && typeof node.visible === 'boolean' ? node.visible : fallback.visible,
  }
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

type MoveVisualMaterial = Material & {
  color?: Color
  depthWrite?: boolean
  needsUpdate?: boolean
  opacity?: number
  transparent?: boolean
}

type MoveVisualMaterialEntry = {
  originalMaterial: Material | Material[]
  state: ItemMoveVisualState
  visualMaterial: Material | Material[]
}

type RepairMaterialEntry = {
  originalMaterial: Material | Material[]
  visualMaterial: Material | Material[]
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

function getMoveVisualStyle(state: ItemMoveVisualState) {
  switch (state) {
    case 'destination-ghost':
      return { color: '#22c55e', opacity: 0.42, tint: 0.38 }
    case 'destination-preview':
      return { color: '#10b981', opacity: 0.48, tint: 0.34 }
    case 'carried':
      return { color: '#38bdf8', opacity: 0.72, tint: 0.22 }
    default:
      return null
  }
}

function createMoveVisualMaterial(material: Material, state: ItemMoveVisualState): Material {
  const style = getMoveVisualStyle(state)
  const nextMaterial = material.clone() as MoveVisualMaterial

  if (!style) {
    return nextMaterial
  }

  if (nextMaterial.color) {
    nextMaterial.color.lerp(new Color(style.color), style.tint)
  }
  nextMaterial.opacity = (nextMaterial.opacity ?? 1) * style.opacity
  nextMaterial.transparent = true
  nextMaterial.depthWrite = false
  nextMaterial.needsUpdate = true
  return nextMaterial
}

function createMoveVisualMaterials(
  material: Material | Material[],
  state: ItemMoveVisualState,
): Material | Material[] {
  return Array.isArray(material)
    ? material.map((entry) => createMoveVisualMaterial(entry, state))
    : createMoveVisualMaterial(material, state)
}

function restoreMoveVisualMaterials(entries: Map<Mesh, MoveVisualMaterialEntry>) {
  for (const [mesh, entry] of entries.entries()) {
    if (mesh.material === entry.visualMaterial) {
      mesh.material = entry.originalMaterial
    }
    disposeMaterials(entry.visualMaterial)
  }
  entries.clear()
}

function createRepairMaterial(material: Material): Material {
  const nextMaterial = material.clone() as MoveVisualMaterial
  if (nextMaterial.color) {
    nextMaterial.color.lerp(new Color('#52e8ff'), 0.42)
  }
  nextMaterial.opacity = (nextMaterial.opacity ?? 1) * 0.68
  nextMaterial.transparent = true
  nextMaterial.depthWrite = false
  nextMaterial.needsUpdate = true
  return nextMaterial
}

function createRepairMaterials(material: Material | Material[]): Material | Material[] {
  return Array.isArray(material)
    ? material.map((entry) => createRepairMaterial(entry))
    : createRepairMaterial(material)
}

function restoreRepairMaterials(entries: Map<Mesh, RepairMaterialEntry>) {
  for (const [mesh, entry] of entries.entries()) {
    if (mesh.material === entry.visualMaterial) {
      mesh.material = entry.originalMaterial
    }
    disposeMaterials(entry.visualMaterial)
  }
  entries.clear()
}

function syncRepairMaterials(object: Object3D, entries: Map<Mesh, RepairMaterialEntry>) {
  const activeMeshes = new Set<Mesh>()

  object.traverse((child) => {
    if (!isRenderableMesh(child)) {
      return
    }

    activeMeshes.add(child)
    if (entries.has(child)) {
      return
    }

    const entry = {
      originalMaterial: child.material,
      visualMaterial: createRepairMaterials(child.material),
    }
    child.material = entry.visualMaterial
    entries.set(child, entry)
  })

  for (const [mesh, entry] of entries.entries()) {
    if (activeMeshes.has(mesh)) {
      continue
    }

    if (mesh.material === entry.visualMaterial) {
      mesh.material = entry.originalMaterial
    }
    disposeMaterials(entry.visualMaterial)
    entries.delete(mesh)
  }
}

function syncMoveVisualMaterials(
  object: Object3D,
  entries: Map<Mesh, MoveVisualMaterialEntry>,
  state: ItemMoveVisualState,
) {
  const style = getMoveVisualStyle(state)
  if (!style) {
    restoreMoveVisualMaterials(entries)
    return
  }

  const activeMeshes = new Set<Mesh>()

  object.traverse((child) => {
    if (!isRenderableMesh(child)) {
      return
    }

    activeMeshes.add(child)
    let entry = entries.get(child)
    if (entry?.state !== state) {
      if (entry) {
        if (child.material === entry.visualMaterial) {
          child.material = entry.originalMaterial
        }
        disposeMaterials(entry.visualMaterial)
        entries.delete(child)
      }

      entry = {
        originalMaterial: child.material,
        state,
        visualMaterial: createMoveVisualMaterials(child.material, state),
      }
      child.material = entry.visualMaterial
      entries.set(child, entry)
    }
  })

  for (const [mesh, entry] of entries.entries()) {
    if (activeMeshes.has(mesh)) {
      continue
    }

    if (mesh.material === entry.visualMaterial) {
      mesh.material = entry.originalMaterial
    }
    disposeMaterials(entry.visualMaterial)
    entries.delete(mesh)
  }
}

export function NavigationItemVisualSystem() {
  const restoresRef = useRef(new Map<string, RuntimeTransformRestore>())
  const deleteFadeEntriesRef = useRef(new Map<string, Map<Mesh, DeleteFadeEntry>>())
  const moveVisualEntriesRef = useRef(new Map<string, Map<Mesh, MoveVisualMaterialEntry>>())
  const repairEntriesRef = useRef(new Map<string, Map<Mesh, RepairMaterialEntry>>())

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
    for (const id of Object.keys(visualState.itemRepairActivations)) {
      trackedIds.add(id)
    }
    for (const id of liveTransforms.keys()) {
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
        const moveEntries = moveVisualEntriesRef.current.get(id)
        if (moveEntries) {
          restoreMoveVisualMaterials(moveEntries)
          moveVisualEntriesRef.current.delete(id)
        }
        const repairEntries = repairEntriesRef.current.get(id)
        if (repairEntries) {
          restoreRepairMaterials(repairEntries)
          repairEntriesRef.current.delete(id)
        }

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

      const repairActivation = visualState.itemRepairActivations[id as BaseNode['id']] ?? null
      if (repairActivation) {
        let entries = repairEntriesRef.current.get(id)
        if (!entries) {
          entries = new Map<Mesh, RepairMaterialEntry>()
          repairEntriesRef.current.set(id, entries)
        }
        syncRepairMaterials(object, entries)
      } else {
        const repairEntries = repairEntriesRef.current.get(id)
        if (repairEntries) {
          restoreRepairMaterials(repairEntries)
          repairEntriesRef.current.delete(id)
        }
      }

      const moveVisualState = visualState.itemMoveVisualStates[id as BaseNode['id']] ?? null
      if (moveVisualState) {
        let entries = moveVisualEntriesRef.current.get(id)
        if (!entries) {
          entries = new Map<Mesh, MoveVisualMaterialEntry>()
          moveVisualEntriesRef.current.set(id, entries)
        }
        syncMoveVisualMaterials(object, entries, moveVisualState)
        if (entries.size === 0) {
          moveVisualEntriesRef.current.delete(id)
        }
      } else {
        const moveEntries = moveVisualEntriesRef.current.get(id)
        if (moveEntries) {
          restoreMoveVisualMaterials(moveEntries)
          moveVisualEntriesRef.current.delete(id)
        }
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
        const sceneNode = useScene.getState().nodes[id as AnyNodeId]
        if (sceneNode) {
          const targetRestore = getSceneTransformRestore(id, restore)
          object.position.set(
            targetRestore.position[0],
            targetRestore.position[1],
            targetRestore.position[2],
          )
          object.rotation.y = targetRestore.rotationY
          object.visible = targetRestore.visible
          object.updateMatrixWorld(true)
        } else {
          object.visible = false
          object.updateMatrixWorld(true)
        }
      }

      const fadeEntries = deleteFadeEntriesRef.current.get(id)
      if (fadeEntries) {
        restoreFadeMaterials(fadeEntries)
        deleteFadeEntriesRef.current.delete(id)
      }
      const moveEntries = moveVisualEntriesRef.current.get(id)
      if (moveEntries) {
        restoreMoveVisualMaterials(moveEntries)
        moveVisualEntriesRef.current.delete(id)
      }
      const repairEntries = repairEntriesRef.current.get(id)
      if (repairEntries) {
        restoreRepairMaterials(repairEntries)
        repairEntriesRef.current.delete(id)
      }
      restoresRef.current.delete(id)
    }
  }, 3)

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
      for (const entries of moveVisualEntriesRef.current.values()) {
        restoreMoveVisualMaterials(entries)
      }
      for (const entries of repairEntriesRef.current.values()) {
        restoreRepairMaterials(entries)
      }
      restoresRef.current.clear()
      deleteFadeEntriesRef.current.clear()
      moveVisualEntriesRef.current.clear()
      repairEntriesRef.current.clear()
    },
    [],
  )

  return null
}
