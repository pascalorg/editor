'use client'

import {
  type AnyNode,
  type AnyNodeId,
  getStaticLiveDataValue,
  isLiveDataBindingConfig,
  type LiveDataBindingConfig,
  resolveBindingColor,
  resolveBindingPositionYOffset,
  resolveBindingRotationYOffset,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useEffect, useRef } from 'react'
import { Color, type Material, type Mesh, type Object3D } from 'three'

type TransformableNode = AnyNode & {
  position?: [number, number, number]
  rotation?: [number, number, number] | number
}

type AppliedSnapshot = {
  materialColors: { material: Material & { color?: Color }; color: Color }[]
}

function getBinding(node: AnyNode): LiveDataBindingConfig | null {
  const metadata =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : null
  const binding = metadata?.liveDataBinding
  if (!isLiveDataBindingConfig(binding)) return null
  return binding.enabled === false ? null : binding
}

function asRotationTuple(rotation: TransformableNode['rotation']): [number, number, number] {
  if (typeof rotation === 'number') return [0, rotation, 0]
  return rotation ?? [0, 0, 0]
}

function collectColorMaterials(object: Object3D) {
  const materials: (Material & { color?: Color })[] = []
  object.traverse((child) => {
    const mesh = child as Mesh
    const material = mesh.material
    if (Array.isArray(material)) {
      for (const item of material) {
        if ('color' in item && item.color instanceof Color)
          materials.push(item as Material & { color: Color })
      }
    } else if (material && 'color' in material && material.color instanceof Color) {
      materials.push(material as Material & { color: Color })
    }
  })
  return materials
}

function restoreSnapshot(snapshot: AppliedSnapshot | undefined) {
  if (!snapshot) return
  for (const entry of snapshot.materialColors) {
    entry.material.color?.copy(entry.color)
    entry.material.needsUpdate = true
  }
}

function applyBinding(
  node: TransformableNode,
  binding: LiveDataBindingConfig,
  snapshot: AppliedSnapshot,
) {
  const object = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!object) return

  const position = node.position ?? [0, 0, 0]
  const rotation = asRotationTuple(node.rotation)
  object.position.set(position[0], position[1], position[2])
  object.rotation.set(rotation[0], rotation[1], rotation[2])

  const value = getStaticLiveDataValue(binding.dataKey)

  if (binding.effect === 'position-y') {
    restoreSnapshot(snapshot)
    snapshot.materialColors = []
    object.position.y = position[1] + resolveBindingPositionYOffset(value)
    return
  }

  if (binding.effect === 'rotation-y') {
    restoreSnapshot(snapshot)
    snapshot.materialColors = []
    object.rotation.y = rotation[1] + resolveBindingRotationYOffset(value)
    return
  }

  const color = resolveBindingColor(value)
  if (!color) return

  if (snapshot.materialColors.length === 0) {
    snapshot.materialColors = collectColorMaterials(object).map((material) => ({
      material,
      color: material.color!.clone(),
    }))
  }

  for (const entry of snapshot.materialColors) {
    entry.material.color?.set(color)
    entry.material.needsUpdate = true
  }
}

export function LiveDataBindingRuntime() {
  const nodes = useScene((state) => state.nodes)
  const appliedRef = useRef(new Map<string, AppliedSnapshot>())

  useEffect(() => {
    const activeNodeIds = new Set<string>()

    for (const node of Object.values(nodes)) {
      const binding = getBinding(node)
      if (!binding) continue
      activeNodeIds.add(node.id)
      const snapshot = appliedRef.current.get(node.id) ?? { materialColors: [] }
      appliedRef.current.set(node.id, snapshot)
      applyBinding(node as TransformableNode, binding, snapshot)
    }

    for (const [nodeId, snapshot] of appliedRef.current) {
      if (activeNodeIds.has(nodeId)) continue
      restoreSnapshot(snapshot)
      appliedRef.current.delete(nodeId)
    }
  }, [nodes])

  useEffect(() => {
    return () => {
      for (const snapshot of appliedRef.current.values()) restoreSnapshot(snapshot)
      appliedRef.current.clear()
    }
  }, [])

  return null
}
