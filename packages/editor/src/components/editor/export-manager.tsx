'use client'

import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Mesh, Object3D } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import * as WebGPUTextureUtils from 'three/examples/jsm/utils/WebGPUTextureUtils.js'

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

      const date = new Date().toISOString().split('T')[0]
      const exportScene = prepareSceneForExport(sceneGroup)

      if (format === 'stl') {
        const exporter = new STLExporter()
        const result = exporter.parse(exportScene, { binary: true })
        const blob = new Blob([result], { type: 'model/stl' })
        downloadBlob(blob, `model_${date}.stl`)
        return
      }

      if (format === 'obj') {
        const exporter = new OBJExporter()
        const result = exporter.parse(exportScene)
        const blob = new Blob([result], { type: 'model/obj' })
        downloadBlob(blob, `model_${date}.obj`)
        return
      }

      // Default: GLB export (existing behavior)
      const exporter = new GLTFExporter()

      // Compressed (KTX2/basis) textures must be decompressed during export or
      // three r184's GLTFExporter throws "setTextureUtils() must be called".
      // The app renders with WebGPURenderer, so use the WebGPU texture utils.
      // We intentionally do NOT pass the live renderer: decompress() resizes
      // whatever renderer it's given (and never restores it), which would
      // corrupt the visible canvas. Omitting it lets three spin up and dispose
      // its own throwaway renderer for the blit instead.
      exporter.setTextureUtils({
        decompress: (texture, maxTextureSize) =>
          WebGPUTextureUtils.decompress(texture, maxTextureSize),
      })

      return new Promise<void>((resolve, reject) => {
        exporter.parse(
          exportScene,
          (gltf) => {
            const blob = new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' })
            downloadBlob(blob, `model_${date}.glb`)
            resolve()
          },
          (error) => {
            console.error('Export error:', error)
            reject(error)
          },
          { binary: true },
        )
      })
    }

    setExportScene(exportFn)

    return () => {
      setExportScene(null)
    }
  }, [scene, setExportScene])

  return null
}

function prepareSceneForExport(source: Object3D) {
  const clone = source.clone(true)
  const meshesToRemove: Mesh[] = []

  clone.traverse((object) => {
    if (isMeshWithInvalidGeometry(object)) meshesToRemove.push(object)
  })

  for (const mesh of meshesToRemove) {
    mesh.removeFromParent()
  }

  return clone
}

function isMeshWithInvalidGeometry(object: Object3D): object is Mesh {
  if (!isMesh(object)) return false

  // Three exporters can crash when a Mesh has no readable position attribute.
  const position = object.geometry?.getAttribute('position')
  return !position || position.count === 0
}

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
