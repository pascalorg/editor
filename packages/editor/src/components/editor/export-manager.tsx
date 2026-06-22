'use client'

import { emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import * as WebGPUTextureUtils from 'three/examples/jsm/utils/WebGPUTextureUtils.js'
import { prepareSceneForExport } from '../../lib/glb-export'

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
      // Hide editor affordances that live on the scene layer (selection handles,
      // ceiling/site brackets) and let wall-cutout reveal all walls — the same
      // synchronous capture path thumbnails use. We clone the scene inside the
      // window, so the export snapshots the clean building, then restore.
      emitter.emit('thumbnail:before-capture', undefined)
      let prepared: ReturnType<typeof prepareSceneForExport>
      try {
        prepared = prepareSceneForExport(sceneGroup, useScene.getState().nodes)
      } finally {
        emitter.emit('thumbnail:after-capture', undefined)
      }
      const { scene: exportScene, animations } = prepared

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

      // Default: GLB export with baked identity + door/window animation clips.
      const exporter = new GLTFExporter()
      // Painted finishes use KTX2 (GPU-compressed) maps; GLTFExporter can't read
      // those directly. WebGPUTextureUtils blits each one to RGBA on its own
      // offscreen renderer (passing the live renderer would resize/draw over the
      // editor canvas), letting the exporter embed standard textures.
      exporter.setTextureUtils(WebGPUTextureUtils)

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
          { binary: true, animations },
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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
