'use client'

import { sceneRegistry, useScene, type AnyNodeId, type ItemNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  Texture,
  type Material as MaterialType,
  type Mesh,
  type Object3D,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  PASCAL_TRUCK_ASSET,
  PASCAL_TRUCK_ITEM_NODE_ID,
} from '../lib/pascal-truck'

type MaterialInput = MaterialType | MaterialType[]

type TruckMaterialSource = {
  byMeshName: Map<string, MaterialInput>
  fallback: MaterialInput | null
  textures: Set<Texture>
  templates: Set<MaterialType>
}

type AppliedTruckMaterial = {
  mesh: Mesh
  originalMaterial: MaterialInput
  texturedMaterial: MaterialInput
}

const MATERIAL_TEXTURE_SLOTS = [
  'alphaMap',
  'aoMap',
  'bumpMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'lightMap',
  'map',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularColorMap',
  'specularIntensityMap',
  'thicknessMap',
  'transmissionMap',
] as const

function isRenderableMesh(object: Object3D): object is Mesh {
  return Boolean((object as Mesh).isMesh && (object as Mesh).material)
}

function asMaterialArray(material: MaterialInput): MaterialType[] {
  return Array.isArray(material) ? material : [material]
}

function cloneMaterialInput(material: MaterialInput): MaterialInput {
  return Array.isArray(material)
    ? material.map((entry) => entry.clone())
    : material.clone()
}

function disposeMaterialInput(material: MaterialInput) {
  for (const entry of asMaterialArray(material)) {
    entry.dispose()
  }
}

function collectMaterialTextures(material: MaterialInput, textures: Set<Texture>) {
  for (const entry of asMaterialArray(material)) {
    const materialRecord = entry as MaterialType &
      Partial<Record<(typeof MATERIAL_TEXTURE_SLOTS)[number], unknown>>
    for (const slot of MATERIAL_TEXTURE_SLOTS) {
      const texture = materialRecord[slot]
      if (texture instanceof Texture) {
        textures.add(texture)
      }
    }
  }
}

function buildTruckMaterialSource(root: Object3D): TruckMaterialSource | null {
  const byMeshName = new Map<string, MaterialInput>()
  const textures = new Set<Texture>()
  const templates = new Set<MaterialType>()
  let fallback: MaterialInput | null = null

  root.traverse((child) => {
    if (!isRenderableMesh(child)) {
      return
    }

    const template = cloneMaterialInput(child.material)
    for (const material of asMaterialArray(template)) {
      templates.add(material)
      material.needsUpdate = true
    }
    collectMaterialTextures(template, textures)

    if (child.name) {
      byMeshName.set(child.name, template)
    }
    fallback ??= template
  })

  return fallback ? { byMeshName, fallback, textures, templates } : null
}

function disposeTruckMaterialSource(source: TruckMaterialSource | null) {
  if (!source) {
    return
  }

  for (const material of source.templates) {
    material.dispose()
  }
  for (const texture of source.textures) {
    texture.dispose()
  }
  source.byMeshName.clear()
  source.templates.clear()
  source.textures.clear()
}

function disposeSourceSceneGeometry(root: Object3D) {
  root.traverse((child) => {
    if (isRenderableMesh(child)) {
      child.geometry.dispose()
    }
  })
}

function getTruckAssetUrl() {
  const sceneNode = useScene.getState().nodes[PASCAL_TRUCK_ITEM_NODE_ID as AnyNodeId]
  const src =
    sceneNode?.type === 'item'
      ? ((sceneNode as ItemNode).asset.src ?? PASCAL_TRUCK_ASSET.src)
      : PASCAL_TRUCK_ASSET.src

  if (typeof window === 'undefined') {
    return src
  }

  return new URL(src, window.location.origin).toString()
}

function restoreAppliedMaterial(entry: AppliedTruckMaterial) {
  if (entry.mesh.material === entry.texturedMaterial) {
    entry.mesh.material = entry.originalMaterial
  }
  disposeMaterialInput(entry.texturedMaterial)
}

function disposeAppliedMaterials(appliedMaterials: Map<string, AppliedTruckMaterial>) {
  for (const entry of appliedMaterials.values()) {
    restoreAppliedMaterial(entry)
  }
  appliedMaterials.clear()
}

export function NavigationPascalTruckMaterialSystem() {
  const materialSourceRef = useRef<TruckMaterialSource | null>(null)
  const appliedMaterialsRef = useRef(new Map<string, AppliedTruckMaterial>())

  useEffect(() => {
    let cancelled = false
    const loader = new GLTFLoader()

    void loader
      .loadAsync(getTruckAssetUrl())
      .then((gltf) => {
        const source = buildTruckMaterialSource(gltf.scene)
        disposeSourceSceneGeometry(gltf.scene)

        if (cancelled) {
          disposeTruckMaterialSource(source)
          return
        }

        materialSourceRef.current = source
      })
      .catch((error) => {
        console.warn('[robot] Failed to load Pascal truck materials', error)
      })

    return () => {
      cancelled = true
      disposeAppliedMaterials(appliedMaterialsRef.current)
      disposeTruckMaterialSource(materialSourceRef.current)
      materialSourceRef.current = null
    }
  }, [])

  useFrame(() => {
    const source = materialSourceRef.current
    const truckObject = sceneRegistry.nodes.get(PASCAL_TRUCK_ITEM_NODE_ID)
    const activeMeshIds = new Set<string>()

    if (source && truckObject) {
      truckObject.traverse((child) => {
        if (!isRenderableMesh(child)) {
          return
        }

        activeMeshIds.add(child.uuid)
        const currentEntry = appliedMaterialsRef.current.get(child.uuid)
        if (currentEntry?.mesh === child && child.material === currentEntry.texturedMaterial) {
          return
        }

        if (currentEntry) {
          restoreAppliedMaterial(currentEntry)
          appliedMaterialsRef.current.delete(child.uuid)
        }

        const sourceMaterial =
          (child.name ? source.byMeshName.get(child.name) : null) ?? source.fallback
        if (!sourceMaterial) {
          return
        }

        const texturedMaterial = cloneMaterialInput(sourceMaterial)
        for (const material of asMaterialArray(texturedMaterial)) {
          material.needsUpdate = true
        }

        appliedMaterialsRef.current.set(child.uuid, {
          mesh: child,
          originalMaterial: child.material,
          texturedMaterial,
        })
        child.material = texturedMaterial
      })
    }

    for (const [meshId, entry] of appliedMaterialsRef.current.entries()) {
      if (activeMeshIds.has(meshId)) {
        continue
      }

      restoreAppliedMaterial(entry)
      appliedMaterialsRef.current.delete(meshId)
    }
  }, 4)

  return null
}
