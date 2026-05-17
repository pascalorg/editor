'use client'

import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Object3D } from 'three'
import { Mesh } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

/**
 * Checks whether an object has valid exportable geometry.
 * Returns true for Mesh objects with non-disposed geometry that has position attributes.
 */
function hasValidGeometry(obj: Object3D): boolean {
  if (!(obj instanceof Mesh)) return false
  const geom = obj.geometry
  if (!geom) return false
  // Check geometry hasn't been disposed (disposed geometries have null attributes)
  if (!geom.attributes || !geom.attributes.position) return false
  if (geom.attributes.position.count === 0) return false
  return true
}

/**
 * Deep-clones a scene group and removes objects that would crash exporters.
 * Keeps only Mesh objects with valid geometry and materials.
 */
function prepareSceneForExport(source: Object3D): Object3D {
  const clone = source.clone(true)

  // Collect objects to remove (traverse then remove to avoid mutation during iteration)
  const toRemove: Object3D[] = []

  clone.traverse((child) => {
    // Skip the root group itself
    if (child === clone) return
    // Keep groups (they're structural containers) but mark leaf nodes without geometry
    if (child.children.length === 0 && !hasValidGeometry(child)) {
      toRemove.push(child)
    }
  })

  // Remove invalid objects
  for (const obj of toRemove) {
    obj.removeFromParent()
  }

  // Second pass: remove now-empty groups (bottom-up)
  let changed = true
  while (changed) {
    changed = false
    clone.traverse((child) => {
      if (child === clone) return
      if (child.children.length === 0 && !hasValidGeometry(child)) {
        child.removeFromParent()
        changed = true
      }
    })
  }

  return clone
}

export function ExportManager() {
  const scene = useThree((state) => state.scene)
  const setExportScene = useViewer((state) => state.setExportScene)

  useEffect(() => {
    const exportFn = async (format: 'glb' | 'stl' | 'obj' = 'glb') => {
      // Find the scene renderer group by name
      const sceneGroup = scene.getObjectByName('scene-renderer')
      if (!sceneGroup) {
        console.error('scene-renderer group not found')
        return
      }

      const exportScene = prepareSceneForExport(sceneGroup)
      const date = new Date().toISOString().split('T')[0]

      if (format === 'stl') {
        try {
          const exporter = new STLExporter()
          const result = exporter.parse(exportScene, { binary: true })
          const blob = new Blob([result], { type: 'model/stl' })
          downloadBlob(blob, `model_${date}.stl`)
        } catch (error) {
          console.error('STL export error:', error)
        }
        return
      }

      if (format === 'obj') {
        try {
          const exporter = new OBJExporter()
          const result = exporter.parse(exportScene)
          const blob = new Blob([result], { type: 'model/obj' })
          downloadBlob(blob, `model_${date}.obj`)
        } catch (error) {
          console.error('OBJ export error:', error)
        }
        return
      }

      // Default: GLB export
      try {
        const exporter = new GLTFExporter()

        return new Promise<void>((resolve, reject) => {
          exporter.parse(
            exportScene,
            (gltf) => {
              const blob = new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' })
              downloadBlob(blob, `model_${date}.glb`)
              resolve()
            },
            (error) => {
              console.error('GLTF export error:', error)
              reject(error)
            },
            { binary: true },
          )
        })
      } catch (error) {
        console.error('GLTF export error:', error)
      }
    }

    setExportScene(exportFn)

    return () => {
      setExportScene(null)
    }
  }, [scene, setExportScene])

  return null
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
