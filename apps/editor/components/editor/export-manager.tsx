'use client'

import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

export function ExportManager() {
  const scene = useThree((state) => state.scene)
  const setExportScene = useViewer((state) => state.setExportScene)

  useEffect(() => {
    const exportFn = async () => {
      // Find the scene renderer group by name
      const sceneGroup = scene.getObjectByName('scene-renderer')
      if (!sceneGroup) {
        console.error('scene-renderer group not found')
        return
      }

      const exporter = new GLTFExporter()
      const date = new Date().toISOString().split('T')[0]

      return new Promise<void>((resolve, reject) => {
        exporter.parse(
          sceneGroup,
          (gltf) => {
            const blob = new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `model_${date}.glb`
            link.click()
            URL.revokeObjectURL(url)
            resolve()
          },
          (error) => {
            console.error('Export error:', error)
            reject(error)
          },
          { binary: true }
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
