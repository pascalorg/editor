'use client'

import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type * as THREE from 'three'
import type { Scene } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import useViewer from '../../store/use-viewer'

const EDITOR_LAYER = 1 // same constant used across the editor

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const ExportSystem = () => {
  const { scene } = useThree()
  const setExportScene = useViewer((state) => state.setExportScene)

  useEffect(() => {
    const exportFn = async (format: 'glb' | 'stl' | 'obj' = 'glb') => {
      const date = new Date().toISOString().split('T')[0]
      const filename = `pascal-export-${date}`

      // Clone scene and strip editor-only objects (layer 1 = EDITOR_LAYER)
      const exportRoot = scene.clone(true) as Scene
      const toRemove: THREE.Object3D[] = []
      exportRoot.traverse((obj) => {
        if (obj.layers.isEnabled(EDITOR_LAYER)) {
          toRemove.push(obj)
        }
      })
      for (const obj of toRemove) {
        obj.parent?.remove(obj)
      }

      if (format === 'glb') {
        const exporter = new GLTFExporter()
        const result = await new Promise<ArrayBuffer>((resolve, reject) => {
          exporter.parse(
            exportRoot,
            (output) => resolve(output as ArrayBuffer),
            (err) => reject(err),
            { binary: true },
          )
        })
        downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), `${filename}.glb`)
      } else if (format === 'stl') {
        const exporter = new STLExporter()
        const result = exporter.parse(exportRoot, { binary: true }) as DataView
        downloadBlob(
          new Blob([result.buffer as ArrayBuffer], { type: 'model/stl' }),
          `${filename}.stl`,
        )
      } else if (format === 'obj') {
        const exporter = new OBJExporter()
        const result = exporter.parse(exportRoot)
        downloadBlob(new Blob([result], { type: 'model/obj' }), `${filename}.obj`)
      }
    }

    setExportScene(exportFn)
    return () => setExportScene(null)
  }, [scene, setExportScene])

  return null
}
